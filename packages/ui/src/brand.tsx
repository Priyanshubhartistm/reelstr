import type { ReactNode } from "react";

/** The one way back: a pill that always names where it goes. Same look on every page, light or dark. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="back" href={href}>
      <span aria-hidden="true">←</span>
      {children}
    </a>
  );
}

/** The mark: the brand icon (a play bubble on a pine tile). */
export function BrandMark() {
  return <img className="brand-mark" src="/icon-192.png" width="32" height="32" alt="Reelstr" />;
}

/**
 * Flat decoration for hero panels: three vertical frames, the same ink strokes as everything else.
 * With `animate`, the middle frame drops in and lands, two more slide out of it (a scene forking), and
 * the play triangle pulses once. Each frame sits in its own <g> so CSS can move it without fighting the
 * rotation that is part of the drawing.
 */
export function FilmArt({ animate = false }: { animate?: boolean }) {
  return (
    <svg
      className={`film-art${animate ? " animate" : ""}`}
      viewBox="0 0 220 200"
      aria-hidden="true"
    >
      <g stroke="var(--ink)" strokeWidth="3" strokeLinejoin="round">
        <g className="fa fa-left">
          <rect
            x="10"
            y="40"
            width="82"
            height="146"
            rx="14"
            fill="var(--accent)"
            transform="rotate(-9 51 113)"
          />
        </g>
        <g className="fa fa-right">
          <rect
            x="128"
            y="34"
            width="82"
            height="146"
            rx="14"
            fill="var(--secondary)"
            transform="rotate(8 169 107)"
          />
        </g>
        <g className="fa fa-mid">
          <rect x="66" y="10" width="88" height="160" rx="15" fill="var(--primary)" />
          <path className="fa fa-play" d="M96 62 128 90 96 118z" fill="var(--card)" />
        </g>
      </g>
    </svg>
  );
}

export function Wordmark() {
  return (
    <>
      <BrandMark />
      <span>
        reel<b>str</b>
      </span>
    </>
  );
}
