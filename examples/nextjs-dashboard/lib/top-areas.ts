import type { RenderPoint } from "./heatmap-render";

export type TopArea = { label: string; clicks: number; percent: number };

/**
 * Groups points into a 4 × n grid of quarter-viewport cells and returns the busiest ones. This is
 * the text alternative to the heatmap (screen readers and the "Table" toggle).
 */
export const topAreas = (points: RenderPoint[], viewport: { w: number; h: number }, limit = 10): TopArea[] => {
  const cellW = viewport.w / 4;
  const cellH = viewport.h / 4;
  const cells = new Map<string, { row: number; col: number; clicks: number }>();
  let total = 0;
  for (const p of points) {
    const col = Math.min(3, Math.max(0, Math.floor(p.x / cellW)));
    const row = Math.max(0, Math.floor(p.y / cellH));
    const key = `${row}:${col}`;
    const cell = cells.get(key) ?? { row, col, clicks: 0 };
    cell.clicks += p.value;
    cells.set(key, cell);
    total += p.value;
  }
  const side = ["left", "center-left", "center-right", "right"];
  return [...cells.values()]
    .sort((a, b) => b.clicks - a.clicks || a.row - b.row || a.col - b.col)
    .slice(0, limit)
    .map((cell) => ({
      label: `Row ${cell.row + 1}, ${side[cell.col]} (x ${Math.round(cell.col * cellW)}–${Math.round(
        (cell.col + 1) * cellW
      )} px, y ${Math.round(cell.row * cellH)}–${Math.round((cell.row + 1) * cellH)} px)`,
      clicks: cell.clicks,
      percent: total === 0 ? 0 : Math.round((cell.clicks / total) * 1000) / 10
    }));
};
