import Hls from "hls.js";
import { useEffect, useRef } from "react";

/** FE-7: vertical HLS player. Native HLS on Safari; hls.js (MSE / ManagedMediaSource) elsewhere. */
export function HlsPlayer({
  src,
  startAt = 0,
  onEnded,
  onProgress,
  autoPlay = true,
  keyHeaders,
  captions = [],
}: {
  src: string;
  startAt?: number;
  onEnded?: () => void;
  onProgress?: (t: number, duration: number) => void;
  autoPlay?: boolean;
  /** headers for the AES key request (unlock token) */
  keyHeaders?: Record<string, string>;
  /** WebVTT captions (NIP-71 text-track); required for curated episodes from R2 */
  captions?: { src: string; lang: string; label: string }[];
}) {
  const ref = useRef<HTMLVideoElement>(null);
  // The parent recomputes startAt and keyHeaders on every render. Reading them through refs keeps a
  // re-render (rating, typing, a progress save) from tearing the player down and restarting it.
  const live = useRef({ startAt, autoPlay, keyHeaders });
  live.current = { startAt, autoPlay, keyHeaders };
  const keySig = JSON.stringify(keyHeaders ?? null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `keySig` stands for keyHeaders' content; the rest is read from `live`
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let hls: Hls | undefined;
    const start = () => {
      if (live.current.startAt > 0) v.currentTime = live.current.startAt;
      if (live.current.autoPlay) void v.play().catch(() => {});
    };
    if (Hls.isSupported()) {
      hls = new Hls({
        startPosition: live.current.startAt,
        xhrSetup: (xhr, url) => {
          const h = live.current.keyHeaders;
          if (h && /\/keys?\//.test(url))
            for (const [k, val] of Object.entries(h)) xhr.setRequestHeader(k, val);
        },
      });
      hls.loadSource(src);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, start);
    } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
      v.src = src;
      v.addEventListener("loadedmetadata", start, { once: true });
    }
    return () => hls?.destroy();
  }, [src, keySig]);
  return (
    // biome-ignore lint/a11y/useMediaCaption: captions are rendered from the `captions` prop below
    <video
      ref={ref}
      className="player"
      playsInline
      controls
      // captions are fetched in CORS mode: without this a <track> on another origin (Blossom) never loads
      crossOrigin="anonymous"
      onEnded={onEnded}
      onTimeUpdate={(e) => onProgress?.(e.currentTarget.currentTime, e.currentTarget.duration)}
    >
      {captions.map((c, i) => (
        <track
          key={c.src}
          kind="captions"
          src={c.src}
          srcLang={c.lang}
          label={c.label}
          default={i === 0}
        />
      ))}
    </video>
  );
}
