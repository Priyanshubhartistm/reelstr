import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { LIVE_FORKS, SCENES, STYLE, WREN } from "../src/story";

/** Regenerate docs/SHOWCASE.md from the story file:  bun demo/tools/showcase-doc.ts */
const scene = (
  n: number,
  s: (typeof SCENES)[number],
) => `### ${String(n).padStart(2, "0")}. ${s.title}
*${s.role}.* Save as \`${s.file}.mp4\`.

\`\`\`
${STYLE} ${s.prompt}
\`\`\`
Sound: ${s.audio}
`;
const fork = (
  n: number,
  s: (typeof LIVE_FORKS)[number],
) => `### ${String(n).padStart(2, "0")}. ${s.title}
Save as \`${s.file}.mp4\`. Keep it aside: you publish this one **live** while recording.

\`\`\`
${STYLE} ${s.prompt}
\`\`\`
Sound: ${s.audio}
`;

const doc = `# Showcase kit

What you need to record a convincing demo: the clips to make, how to load them, and a script for the recording. Everything here is generated from \`demo/src/story.ts\`, which is also what the seed script uses, so the prompts below are the same text that ends up on each scene.

## What you are making

A mystery called **The Last Signal**: a radio tower wakes at night and a girl, Wren, follows the signal. The story **branches** after the first scene (she climbs the tower, or goes underground), which is the point of the product: anyone can fork a scene.

${SCENES.slice(0, 5).length} clips are required, a sixth is optional, and two are for forking live while you record.

\`\`\`
01 The Signal
 ├─ 02 Into the Tower ── 04 The Broadcast
 ├─ 03 Down Below ────── 05 Static
 └─ 06 Dawn Over the Tower   (optional)
        live while recording:  07 Reply (from 04),  08 The Hatch (from 03)
\`\`\`

## Specs for every clip

- **Vertical 9:16**, 720p is plenty, **8 seconds** (Veo 3.1 makes 4, 6 or 8; the seed trims to whatever you give it).
- **With audio.** Veo generates sound; the prompts say what it should be.
- **MP4** (mov, webm and m4v also work). Under 200 MB, which is not a concern at this length.
- **No text or logos in the picture.** The app adds its own captions and credits.

## Making them look like one film

- Every prompt starts with the same **style line** (included below). Do not shorten it.
- Wren is described **word for word the same** in every clip she is in. The model has no memory between clips, so the repeated description is what keeps her recognisable:
  > ${WREN}
- Make 2 or 3 takes of each and keep the best. Reuse the strongest frame as an image reference if your tool supports it.
- If a clip comes out wrong, change one thing in the prompt, not everything.
- Veo may refuse prompts about children in danger. These prompts keep Wren safe, curious and in control on purpose.

## Prompts

${SCENES.map((s, i) => scene(i + 1, s)).join("\n")}
## Two more, for forking live

${LIVE_FORKS.map((s, i) => fork(i + 7, s)).join("\n")}
## Loading them into the demo

Put the files in one folder, named as above (the number prefix is what matters).

**On your machine** (a fresh local stack, testnet mode, about three minutes):

\`\`\`sh
bun demo/src/index.ts --clips ~/clips --model veo-3.1
\`\`\`

\`--model <name>\` records the model that made the clips, as a **closed-weight** model, in each scene's manifest. Leave it off to record nothing. With your own clips the demo "Source Verified" scene is left out; add \`--verified-demo\` to keep it.

**On the live site:** the VM already holds the placeholder story. Ask for a **reset and reseed** with your clips; it is a short job because nothing else lives in that stack.

**By hand, in the app:** Stories, open a story, "Add the first scene" (or fork), upload. Slower, and it is exactly what you will show when you fork live.

## The recording, about 2 minutes 30

Use a fresh browser profile so the first-run screens appear. 1280 px wide records well; the app is also made for phones if you want a vertical cut.

| Time | You do | You say |
| --- | --- | --- |
| 0:00 | Open the landing page. Let the hero animate, scroll slowly through "How it works", then click **Launch the app**. | "Stories anyone can fork, and episodes that pay everyone who made them." |
| 0:20 | **Generate a key**, press **Copy key**, tick "I saved my key", Continue. | "No account, no email: a key, like a wallet." |
| 0:30 | On Watch, point at the four-step guide, click **Get test sats** and press the faucet (500). | "This is a testnet: test sats from a faucet, no real money." |
| 0:45 | Open **The Last Signal**, play episode 1 (free). | "The first episode is free. Notice there is no seam between scenes." |
| 1:05 | Go back, open episode 2: the paywall. **Unlock for 21 sats.** Scroll to **Credits and split**. | "21 sats, and the split is public: each creator is paid for the seconds of their scene that made the cut." |
| 1:30 | **Stories** tab: open the tree, click a scene, **Fork / continue from here**, upload \`07-reply.mp4\`, publish. The tree grows. | "Anyone can continue any scene. The original creator is credited automatically." |
| 1:55 | **Curator desk**: choose the story, add scenes, drag to order, trim, point at the live split, publish. | "A curator cuts a branch into an episode and sets the price. The split is computed from seconds used." |
| 2:20 | Back to the landing page ("Watch one, or make one."). | "It is open source and runs on Nostr." |

**Say it plainly, because it is what makes the demo credible:** the sats are test sats; the clips were made with Veo, a closed model, so they are not re-renderable and do not get a "Source Verified" badge; the protocol and the payments are real and tested against real software. Skip the **Agents** page unless you have a real video key: until then the bot returns a placeholder clip.

## Before you press record

- [ ] The clips load and play (open one in the app first).
- [ ] The faucet works (the wallet shows 500 after one click).
- [ ] You forked once beforehand so you know how long publishing takes (about 15 seconds).
- [ ] The curator desk episode renders in advance if you want to skip the wait on camera (rendering takes 10 to 40 seconds on the VM).
- [ ] Notifications off, a clean browser profile, zoom at 100%.
`;
writeFileSync(join(import.meta.dir, "..", "..", "docs", "SHOWCASE.md"), doc);
console.log("wrote docs/SHOWCASE.md");
