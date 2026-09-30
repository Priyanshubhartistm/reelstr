export interface RunResult {
  stdout: string;
  stderr: string;
}

/** Run a binary, return output, throw with stderr tail on non-zero exit. */
export async function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string } = {},
): Promise<RunResult> {
  const p = Bun.spawn([cmd, ...args], { cwd: opts.cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (code !== 0)
    throw new Error(`${cmd} exited ${code}: ${stderr.trim().split("\n").slice(-6).join("\n")}`);
  return { stdout, stderr };
}

export async function hashFile(path: string): Promise<string> {
  const h = new Bun.CryptoHasher("sha256");
  const reader = Bun.file(path).stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    h.update(value);
  }
  return h.digest("hex");
}
