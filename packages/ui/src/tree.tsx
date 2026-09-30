export interface TreeNode {
  id: string;
  parent_id: string | null;
  title: string;
  depth: number;
  used: boolean;
  author: string;
}

/** FE-4: layered scene tree. Columns are depth; branches used in a published Cut are highlighted. */
export function TreeView({
  nodes,
  selected,
  onSelect,
}: {
  nodes: TreeNode[];
  selected?: string;
  onSelect: (n: TreeNode) => void;
}) {
  const col = 160;
  const row = 44;
  const byDepth = new Map<number, TreeNode[]>();
  for (const n of nodes) byDepth.set(n.depth, [...(byDepth.get(n.depth) ?? []), n]);
  const pos = new Map<string, { x: number; y: number }>();
  for (const [d, list] of byDepth)
    list.forEach((n, i) => pos.set(n.id, { x: 20 + d * col, y: 20 + i * row }));
  const width = 40 + (Math.max(0, ...nodes.map((n) => n.depth)) + 1) * col;
  const height = 40 + Math.max(1, ...[...byDepth.values()].map((l) => l.length)) * row;
  return (
    <svg className="tree" width={width} height={height} role="img" aria-label="scene tree">
      {nodes.map((n) => {
        const p = pos.get(n.id);
        const q = n.parent_id ? pos.get(n.parent_id) : undefined;
        return p && q ? (
          <path
            key={`e${n.id}`}
            d={`M${q.x + 120} ${q.y + 14} C${q.x + 140} ${q.y + 14} ${p.x - 20} ${p.y + 14} ${p.x} ${p.y + 14}`}
            className={n.used ? "edge used" : "edge"}
          />
        ) : null;
      })}
      {nodes.map((n) => {
        const p = pos.get(n.id);
        if (!p) return null;
        return (
          <g
            key={n.id}
            transform={`translate(${p.x} ${p.y})`}
            onClick={() => onSelect(n)}
            className={`node${n.used ? " used" : ""}${selected === n.id ? " sel" : ""}`}
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onSelect(n)}
          >
            <rect width="120" height="28" rx="6" />
            <text x="8" y="18">
              {n.title.length > 16 ? `${n.title.slice(0, 15)}…` : n.title}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
