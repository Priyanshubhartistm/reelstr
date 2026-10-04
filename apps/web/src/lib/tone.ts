/** A stable colour class for an item (series or story), so the same one always looks like itself. */
export const tone = (coord: string): string => {
  let h = 0;
  for (const ch of coord) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `tone-${h % 4}`;
};
