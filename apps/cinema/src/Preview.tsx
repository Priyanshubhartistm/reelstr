import { useEffect, useRef, useState } from "react";

export interface Clip {
  src: string;
  inSec: number;
  outSec: number;
}

/**
 * FE-5: back-to-back preview with two video elements. The next clip is preloaded and seeked to
 * its in-point while the current one plays, then swapped at the out-point. This approximates the
 * server render (which is the source of truth for gapless playback); it is not frame exact.
 */
export function TimelinePreview({ clips }: { clips: Clip[] }) {
  const a = useRef<HTMLVideoElement>(null);
  const b = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState<0 | 1>(0);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const els = () => [a.current, b.current] as const;

  // load clip `i` into element `slot` and park it at its in-point
  const load = (slot: 0 | 1, i: number) => {
    const v = els()[slot];
    const c = clips[i];
    if (!v || !c) return;
    if (v.dataset.src !== c.src) {
      v.src = c.src;
      v.dataset.src = c.src;
    }
    const seek = () => {
      v.currentTime = c.inSec;
    };
    if (v.readyState >= 1) seek();
    else v.addEventListener("loadedmetadata", seek, { once: true });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the timeline changes
  useEffect(() => {
    setIdx(0);
    setActive(0);
    setPlaying(false);
    for (const v of els()) v?.pause();
    load(0, 0);
    load(1, 1);
  }, [clips.map((c) => `${c.src}${c.inSec}${c.outSec}`).join("|")]);

  const tick = () => {
    const v = els()[active];
    const c = clips[idx];
    if (!v || !c || v.currentTime < c.outSec - 0.04) return;
    const other = (active ^ 1) as 0 | 1;
    const nv = els()[other];
    if (idx + 1 >= clips.length) {
      v.pause();
      setPlaying(false);
      return;
    }
    void nv?.play();
    v.pause();
    setActive(other);
    setIdx(idx + 1);
    load(active, idx + 2);
  };

  const toggle = () => {
    const v = els()[active];
    if (!v) return;
    if (playing) {
      v.pause();
      setPlaying(false);
    } else {
      void v.play();
      setPlaying(true);
    }
  };

  if (clips.length === 0) return null;
  const style = (s: 0 | 1) => ({
    display: active === s ? "block" : "none",
    width: "100%",
    aspectRatio: "9/16",
    background: "#000",
    borderRadius: 12,
  });
  return (
    <div style={{ maxWidth: 260 }}>
      {/* biome-ignore lint/a11y/useMediaCaption: editing preview of uncaptioned raw scenes */}
      <video ref={a} playsInline muted={false} style={style(0)} onTimeUpdate={tick} />
      {/* biome-ignore lint/a11y/useMediaCaption: editing preview of uncaptioned raw scenes */}
      <video ref={b} playsInline muted={false} style={style(1)} onTimeUpdate={tick} />
      <p>
        <button type="button" className="ghost" onClick={toggle}>
          {playing ? "Pause" : "Preview"}
        </button>{" "}
        <span className="muted">
          clip {idx + 1}/{clips.length}
        </span>
      </p>
    </div>
  );
}
