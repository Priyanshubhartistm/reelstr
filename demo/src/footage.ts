import { run } from "@reelstr/media";

const FONT = "/usr/share/fonts/dejavu-sans-fonts/DejaVuSans-Bold.ttf";
const esc = (s: string) => s.replace(/[:\\']/g, (c) => `\\${c}`);

/**
 * A titled, slowly drifting 12 s portrait scene with its own colours and tone. Stands in for
 * model output so a demo without a GPU or API key still looks like a story.
 */
export async function makeScene(
  path: string,
  o: { title: string; caption: string; c0: string; c1: string; freq: number; sec?: number },
) {
  const sec = o.sec ?? 12;
  const text = (t: string, y: string, size: number, from: number) =>
    `drawtext=fontfile=${FONT}:text='${esc(t)}':fontsize=${size}:fontcolor=white:x=(w-text_w)/2:y=${y}:alpha='min(1,max(0,(t-${from})/0.8))':shadowcolor=black@0.6:shadowx=2:shadowy=2`;
  await run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `gradients=size=360x640:rate=30:duration=${sec}:c0=${o.c0}:c1=${o.c1}:speed=0.03:type=radial`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${o.freq}:duration=${sec}:sample_rate=44100`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${Math.round(o.freq * 1.5)}:duration=${sec}:sample_rate=44100`,
    "-filter_complex",
    `[0:v]${text(o.title, "h*0.38", 34, 0.3)},${text(o.caption, "h*0.48", 20, 1.5)}[v];[1:a][2:a]amix=inputs=2,volume=0.1,afade=t=in:d=0.5[a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    path,
  ]);
  return path;
}
