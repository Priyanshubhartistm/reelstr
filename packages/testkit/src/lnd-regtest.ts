import { join } from "node:path";
import { freePort, tempDir } from "./index";

const sh = async (args: string[], quiet = false) => {
  const p = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (code !== 0 && !quiet)
    throw new Error(`${args.slice(0, 4).join(" ")} failed: ${err.trim().slice(-300)}`);
  return { out: out.trim(), err, code };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BITCOIND = "docker.io/polarlightning/bitcoind:27.0";
const LND = "docker.io/polarlightning/lnd:0.18.3-beta";

/**
 * A private Bitcoin regtest chain with two real LND nodes and one funded channel between them.
 * `alice` is the node under test (the service); `bob` plays the viewer. Needs podman or docker
 * (`CONTAINER_CLI`) and the two images above. Real Lightning software, no real money.
 */
export async function startLndRegtest() {
  const cli = process.env.CONTAINER_CLI ?? "podman";
  const id = Math.random().toString(36).slice(2, 8);
  const net = `reelstr-ln-${id}`;
  const names: string[] = [];
  await sh([cli, "network", "create", net]);
  const run = async (name: string, image: string, args: string[], publish?: [number, number]) => {
    names.push(name);
    await sh([
      cli,
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "--network",
      net,
      "--network-alias",
      name.replace(`-${id}`, ""),
      ...(publish ? ["-p", `127.0.0.1:${publish[0]}:${publish[1]}`] : []),
      image,
      ...args,
    ]);
  };
  const stop = async () => {
    for (const n of names) await sh([cli, "rm", "-f", n], true);
    await sh([cli, "network", "rm", net], true);
  };
  try {
    await run(`bitcoind-${id}`, BITCOIND, [
      "-regtest=1",
      "-server=1",
      "-rpcuser=u",
      "-rpcpassword=p",
      "-rpcallowip=0.0.0.0/0",
      "-rpcbind=0.0.0.0",
      "-fallbackfee=0.0002",
      "-txindex=1",
      "-zmqpubrawblock=tcp://0.0.0.0:28334",
      "-zmqpubrawtx=tcp://0.0.0.0:28335",
    ]);
    const btc = (...a: string[]) =>
      sh([
        cli,
        "exec",
        `bitcoind-${id}`,
        "bitcoin-cli",
        "-regtest",
        "-rpcuser=u",
        "-rpcpassword=p",
        ...a,
      ]);
    for (let i = 0; ; i++) {
      if (
        await btc("getblockcount").then(
          () => true,
          () => false,
        )
      )
        break;
      if (i > 60) throw new Error("bitcoind never became ready");
      await sleep(500);
    }
    await btc("createwallet", "w").catch(() => {});
    const addr = (await btc("-rpcwallet=w", "getnewaddress")).out;
    await btc("-rpcwallet=w", "generatetoaddress", "101", addr);

    const rest = { alice: freePort(), bob: freePort() };
    const node = async (who: "alice" | "bob") => {
      await run(
        `${who}-${id}`,
        LND,
        [
          "--bitcoin.regtest",
          "--bitcoin.node=bitcoind",
          `--bitcoind.rpchost=bitcoind`,
          "--bitcoind.rpcuser=u",
          "--bitcoind.rpcpass=p",
          "--bitcoind.zmqpubrawblock=tcp://bitcoind:28334",
          "--bitcoind.zmqpubrawtx=tcp://bitcoind:28335",
          "--noseedbackup",
          "--restlisten=0.0.0.0:8080",
          "--rpclisten=0.0.0.0:10009",
          "--listen=0.0.0.0:9735",
          `--alias=${who}`,
          "--tlsextradomain=localhost",
          "--maxpendingchannels=5",
        ],
        [rest[who], 8080],
      );
    };
    await Promise.all([node("alice"), node("bob")]);
    const lncli = (who: string, ...a: string[]) =>
      sh([
        cli,
        "exec",
        `${who}-${id}`,
        "lncli",
        "--network=regtest",
        "--lnddir=/home/lnd/.lnd",
        ...a,
      ]);
    const ready = async (who: string) => {
      for (let i = 0; i < 120; i++) {
        const r = await sh(
          [
            cli,
            "exec",
            `${who}-${id}`,
            "lncli",
            "--network=regtest",
            "--lnddir=/home/lnd/.lnd",
            "getinfo",
          ],
          true,
        );
        if (r.code === 0 && JSON.parse(r.out).synced_to_chain)
          return JSON.parse(r.out) as { identity_pubkey: string };
        await sleep(500);
      }
      throw new Error(`${who} lnd never became ready`);
    };
    const [ia, ib] = await Promise.all([ready("alice"), ready("bob")]);
    const mine = async (n: number) => {
      await btc("-rpcwallet=w", "generatetoaddress", String(n), addr);
    };
    // fund bob on-chain, open bob -> alice with some pushed to alice so alice can pay out too
    const bobAddr = JSON.parse((await lncli("bob", "newaddress", "p2wkh")).out).address as string;
    await btc("-rpcwallet=w", "sendtoaddress", bobAddr, "1");
    await mine(6);
    for (let i = 0; i < 60; i++) {
      const b = JSON.parse((await lncli("bob", "walletbalance")).out);
      if (Number(b.confirmed_balance) > 0) break;
      await sleep(500);
    }
    await lncli("bob", "connect", `${ia.identity_pubkey}@alice:9735`).catch(() => {});
    await lncli(
      "bob",
      "openchannel",
      `--node_key=${ia.identity_pubkey}`,
      "--local_amt=1000000",
      "--push_amt=400000",
    );
    await mine(6);
    for (let i = 0; i < 120; i++) {
      const c = JSON.parse((await lncli("alice", "listchannels")).out).channels as {
        active: boolean;
      }[];
      if (c.length && c[0]?.active) break;
      await sleep(500);
    }
    // a channel is routable once it is announced and both sides have published a fee policy
    await mine(6);
    const routable = async (who: string) => {
      const g = JSON.parse((await lncli(who, "describegraph")).out) as {
        edges: { node1_policy: unknown; node2_policy: unknown }[];
      };
      return g.edges.length === 1 && !!g.edges[0]?.node1_policy && !!g.edges[0]?.node2_policy;
    };
    for (let i = 0; !((await routable("alice")) && (await routable("bob"))); i++) {
      if (i > 120) throw new Error("the channel never became routable");
      await sleep(500);
    }
    const macaroon = async (who: string) => {
      const dest = join(tempDir("reelstr-mac-"), `${who}.macaroon`);
      await sh([
        cli,
        "cp",
        `${who}-${id}:/home/lnd/.lnd/data/chain/bitcoin/regtest/admin.macaroon`,
        dest,
      ]);
      return Buffer.from(await Bun.file(dest).arrayBuffer()).toString("hex");
    };
    return {
      alice: {
        pubkey: ia.identity_pubkey,
        cli: (...a: string[]) => lncli("alice", ...a),
        macaroon: await macaroon("alice"),
        restPort: rest.alice,
      },
      bob: {
        pubkey: ib.identity_pubkey,
        cli: (...a: string[]) => lncli("bob", ...a),
        macaroon: await macaroon("bob"),
        restPort: rest.bob,
      },
      mine,
      stop,
      cli,
      id,
    };
  } catch (e) {
    await stop();
    throw e;
  }
}
