import { legendGradient } from "../lib/heatmap-render";

/** Count scale, not just color: the bar is labelled with click counts. */
export default function HeatmapLegend({ max }: { max: number }) {
  const ticks = [0, Math.round(max / 2), max];
  return (
    <figure className="ph-legend" aria-label={`Color scale from 0 to ${max} clicks per area`}>
      <div className="ph-legend-bar" style={{ background: legendGradient() }} aria-hidden="true" />
      <figcaption className="ph-legend-ticks">
        {ticks.map((tick, i) => (
          <span key={i}>{tick.toLocaleString("en-US")}</span>
        ))}
        <span className="ph-legend-unit">clicks per area</span>
      </figcaption>
    </figure>
  );
}
