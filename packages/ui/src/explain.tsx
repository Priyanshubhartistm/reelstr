import type { ReactNode } from "react";

/** Plain-words box at the top of a page: what this is, what to do here. */
export function Explain({
  title,
  children,
  steps,
}: {
  title: string;
  children: ReactNode;
  steps?: ReactNode[];
}) {
  return (
    <aside className="card card-soft explain">
      <div className="label">{title}</div>
      <p style={{ margin: "0.3rem 0 0" }}>{children}</p>
      {steps && (
        <ol className="guide">
          {steps.map((s, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static list
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </aside>
  );
}
