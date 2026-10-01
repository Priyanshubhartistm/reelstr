import { useCallback, useEffect, useRef, useState } from "react";

export interface Clip {
  src: string;
  inSec: number;
  outSec: number;
  /** other servers holding the same blob, tried if `src` fails */
  fallbacks?: string[];
}

export const clipsDuration = (clips: Clip[]) => clips.reduce((a, c) => a + (c.outSec - c.inSec), 0);

/** Which clip and offset a timeline position falls in. */
export function locate(clips: Clip[], t: number): { idx: number; at: number } {
  let left = Math.max(0, t);
  for (const [idx, c] of clips.entries()) {
    const len = c.outSec - c.inSec;
    if (left < len || idx === clips.length - 1) return { idx, at: c.inSec + Math.min(left, len) };
    left -= len;
  }
  return { idx: 0, at: clips[0]?.inSec ?? 0 };
}

/**
 * Plays scenes back to back with two <video> elements: while one plays, the other is loaded and
 * parked at the next scene's in-point; at the out-point they swap. This is the FALLBACK for an
 * episode with no rendered HLS (BE-3). It is not gapless like a single continuous encode: the swap
 * costs a play() start-up and the audio is not crossfaded. Measured in Chrome: worst gap at a join is
 * 100 to 150 ms (3 to 4 frames), against one frame for the render. Warming the next decoder and starting
 * it early were both tried and did not help (the first made it worse). Prefer the server render.
 */
export function SceneSequencePlayer({
  clips,
  startAt = 0,
  autoPlay = true,
  controls = true,
  onProgress,
  onEnded,
  maxWidth,
}: {
  clips: Clip[];
  startAt?: number;
  autoPlay?: boolean;
  controls?: boolean;
  onProgress?: (t: number, total: number) => void;
  onEnded?: () => void;
  maxWidth?: number;
}) {
  const e0 = useRef<HTMLVideoElement>(null);
  const e1 = useRef<HTMLVideoElement>(null);
  const els = [e0, e1] as const;
  const state = useRef({ active: 0 as 0 | 1, idx: 0, playing: false, done: false });
  const [ui, setUi] = useState({ playing: false, idx: 0 });
  const total = clipsDuration(clips);
  const key = clips.map((c) => `${c.src}|${c.inSec}|${c.outSec}`).join(",");

  const park = useCallback(
    (slot: 0 | 1, i: number, at?: number) => {
      const v = els[slot].current;
      const c = clips[i];
      if (!v || !c) return;
      if (v.dataset.src !== c.src) {
        v.dataset.src = c.src;
        v.src = c.src;
        v.preload = "auto";
        v.onerror = () => {
          const next = c.fallbacks?.shift();
          if (next) {
            v.dataset.src = next;
            v.src = next;
          }
        };
      }
      const seek = () => {
        v.currentTime = at ?? c.inSec;
      };
      if (v.readyState >= 1) seek();
      else v.addEventListener("loadedmetadata", seek, { once: true });
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: clips identity is tracked by `key`
    [key],
  );

  const swap = useCallback(() => {
    const s = state.current;
    if (s.idx + 1 >= clips.length) {
      s.done = true;
      s.playing = false;
      els[s.active].current?.pause();
      setUi((u) => ({ ...u, playing: false }));
      onEnded?.();
      return;
    }
    const cur = els[s.active].current;
    const nxt = els[(s.active ^ 1) as 0 | 1].current;
    void nxt?.play();
    cur?.pause();
    s.active = (s.active ^ 1) as 0 | 1;
    s.idx += 1;
    setUi((u) => ({ ...u, idx: s.idx }));
    park((s.active ^ 1) as 0 | 1, s.idx + 1); // ready the one after
  }, [clips.length, onEnded, park]);

  // per-frame loop: swap exactly at the out-point (one frame of slack), report progress
  // biome-ignore lint/correctness/useExhaustiveDependencies: restarts when the clip list changes
  useEffect(() => {
    let stop = false;
    let raf = 0;
    const loop = () => {
      if (stop) return;
      const s = state.current;
      const v = els[s.active].current;
      const c = clips[s.idx];
      if (v && c && s.playing) {
        if (v.currentTime >= c.outSec - 1 / 60) swap();
        else {
          let before = 0;
          for (let k = 0; k < s.idx; k++)
            before += (clips[k] as Clip).outSec - (clips[k] as Clip).inSec;
          onProgress?.(before + Math.max(0, v.currentTime - c.inSec), total);
        }
      }
      const el = els[state.current.active].current as
        | (HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number })
        | null;
      if (el?.requestVideoFrameCallback) el.requestVideoFrameCallback(loop);
      else raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
    };
  }, [key, swap]);

  // (re)load when the clip list changes, honouring startAt
  // biome-ignore lint/correctness/useExhaustiveDependencies: key covers clips
  useEffect(() => {
    const s = state.current;
    for (const r of els) r.current?.pause();
    const { idx, at } = locate(clips, startAt);
    s.idx = idx;
    s.active = 0;
    s.done = false;
    s.playing = false;
    setUi({ playing: false, idx });
    park(0, idx, at);
    park(1, idx + 1);
    if (autoPlay && clips.length) {
      const v = els[0].current;
      const go = () => {
        void v
          ?.play()
          .then(() => {
            s.playing = true;
            setUi((u) => ({ ...u, playing: true }));
          })
          .catch(() => {});
      };
      if (v && v.readyState >= 2) go();
      else v?.addEventListener("canplay", go, { once: true });
    }
  }, [key, startAt, autoPlay]);

  const toggle = () => {
    const s = state.current;
    const v = els[s.active].current;
    if (!v) return;
    if (s.playing) {
      v.pause();
      s.playing = false;
    } else {
      if (s.done) {
        s.done = false;
        s.idx = 0;
        s.active = 0;
        park(0, 0);
        park(1, 1);
      }
      void (els[s.active].current as HTMLVideoElement).play();
      s.playing = true;
    }
    setUi((u) => ({ ...u, playing: s.playing }));
  };

  if (clips.length === 0) return null;
  const style = (slot: 0 | 1) => ({
    display: ui.idx !== undefined && state.current.active === slot ? "block" : "none",
    width: "100%",
    aspectRatio: "9/16",
    background: "#000",
    borderRadius: 12,
    objectFit: "contain" as const,
  });
  return (
    <div style={{ maxWidth: maxWidth ?? "100%" }} data-testid="scene-sequence">
      {/* biome-ignore lint/a11y/useMediaCaption: raw scenes have no transcript; the rendered episode carries captions */}
      <video ref={els[0]} className="player" playsInline crossOrigin="anonymous" style={style(0)} />
      {/* biome-ignore lint/a11y/useMediaCaption: raw scenes have no transcript; the rendered episode carries captions */}
      <video ref={els[1]} className="player" playsInline crossOrigin="anonymous" style={style(1)} />
      {controls && (
        <p>
          <button type="button" className="ghost" onClick={toggle}>
            {ui.playing ? "Pause" : "Play"}
          </button>{" "}
          <span className="muted">
            scene {ui.idx + 1}/{clips.length}
          </span>
        </p>
      )}
    </div>
  );
}
