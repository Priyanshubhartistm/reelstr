/**
 * "The Last Signal": the demo story. One place for the scene list, so the seed, the placeholder footage
 * and the prompts handed to whoever makes the real clips (docs/SHOWCASE.md is generated from this) agree.
 */

/** Set in front of every prompt so the clips look like one film. */
export const STYLE =
  "Vertical 9:16 cinematic mystery. Handheld camera, heavy rain and mist, teal and amber colour grade, 35mm film grain, shallow depth of field. No text, no subtitles, no logos, no watermark.";

/** Said once, repeated word for word in every prompt where she appears: the model has no memory between clips. */
export const WREN =
  "WREN, a 16-year-old girl with short dark hair, a yellow rain jacket, a small grey backpack, tired but determined";

export interface SceneDef {
  /** file prefix: 01-the-signal.mp4 */
  file: string;
  title: string;
  /** one line on the placeholder footage */
  caption: string;
  /** where it sits in the tree */
  role: string;
  /** the full prompt (without the style line) */
  prompt: string;
  /** what the clip should sound like */
  audio: string;
}

export const SCENES: SceneDef[] = [
  {
    file: "01-the-signal",
    title: "The Signal",
    caption: "3 a.m. A tower hums to life",
    role: "root of the story",
    prompt:
      "Night. An abandoned radio tower on a hill above a dead town, heavy rain. Slow push-in toward the tower. A single red aircraft light at the very top flickers twice, then glows steady. No people.",
    audio: "Low electrical hum that slowly rises, faint radio static underneath, rain.",
  },
  {
    file: "02-into-the-tower",
    title: "Into the Tower",
    caption: "Wren climbs toward the voice",
    role: "branch A, continues scene 1",
    prompt: `${WREN}, climbs a rusted spiral staircase inside the tower, a flashlight beam sweeping the walls, her breath visible in the cold. Water drips from the beams. The camera follows from below, handheld. She stops and looks up at a faint red glow above her.`,
    audio:
      "Boots ringing on metal steps, dripping water, the same low hum as before getting closer.",
  },
  {
    file: "03-down-below",
    title: "Down Below",
    caption: "Another way: under the tower",
    role: "branch B, also continues scene 1",
    prompt: `${WREN}, crouches through a small service hatch at the foot of the tower, then walks down a long concrete tunnel lit by one flickering green emergency light, puddles on the floor. The camera tracks slowly behind her.`,
    audio:
      "Distant dripping, a flickering electrical buzz, the tower's low hum faint and far away.",
  },
  {
    file: "04-the-broadcast",
    title: "The Broadcast",
    caption: "The Voice says her name",
    role: "continues branch A",
    prompt: `A dark control room at the top of the tower, rain streaking the window behind. A vintage chrome microphone on a desk glows faintly red. ${WREN}, steps into frame and reaches toward it. From the old speakers a distorted, whispering voice says her name: "Wren." Close-up on her face as she freezes.`,
    audio: 'Static that parts to reveal a whispering, distorted voice saying "Wren."',
  },
  {
    file: "05-static",
    title: "Static",
    caption: "Every channel says the same thing",
    role: "continues branch B",
    prompt: `${WREN}, enters a circular room lined with old CRT monitors and speakers. Every screen shows white noise. One screen flickers and shows a grainy silhouette of her seen from behind. She freezes. Slow push-in on her face.`,
    audio: "A wall of white noise that thins out for a moment into a faint, repeating whisper.",
  },
  {
    file: "06-dawn-over-the-tower",
    title: "Dawn Over the Tower",
    caption: "Mist, then a signal",
    role: "optional: a bird's-eye epilogue (also the scene used to show Source Verified when the mock model is on)",
    prompt:
      "Aerial drone shot at dawn: the radio tower rising out of thick mist above an empty town, first orange light on the horizon, the red light at the top slowly fading out. Slow push-in.",
    audio: "Quiet wind, the first birdsong, the hum fading to silence.",
  },
];

/** Scenes to keep aside and publish live while recording the demo (forking in front of the audience). */
export const LIVE_FORKS: { file: string; title: string; prompt: string; audio: string }[] = [
  {
    file: "07-reply",
    title: "Reply",
    prompt: `${WREN}, holds the glowing microphone close and whispers into it. The control room lights flicker with each word. Close-up, shallow focus.`,
    audio: 'She whispers "Who is there?"; the speakers answer with a burst of static.',
  },
  {
    file: "08-the-hatch",
    title: "The Hatch",
    prompt: `${WREN}, kneels at the end of the tunnel and pulls open a heavy steel hatch in the floor. Warm amber light spills up onto her face. Camera tilts down over her shoulder to show a ladder descending into the light.`,
    audio: "A heavy metallic groan of the hatch opening, then a warm low tone rising.",
  },
];
