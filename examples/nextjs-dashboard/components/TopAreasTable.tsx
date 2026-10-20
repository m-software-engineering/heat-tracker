import type { TopArea } from "../lib/top-areas";

type Props = { areas: TopArea[]; visible: boolean; caption: string };

/** Text alternative to the heatmap; always in the accessibility tree, visible with the Table toggle. */
export default function TopAreasTable({ areas, visible, caption }: Props) {
  return (
    <table className={visible ? "ph-table" : "ph-table sr-only"} data-testid="top-areas">
      <caption>Top clicked areas · {caption}</caption>
      <thead>
        <tr>
          <th scope="col">Area</th>
          <th scope="col">Clicks</th>
          <th scope="col">% of total</th>
        </tr>
      </thead>
      <tbody>
        {areas.length === 0 ? (
          <tr>
            <td colSpan={3}>No clicks in this period.</td>
          </tr>
        ) : (
          areas.map((area) => (
            <tr key={area.label}>
              <th scope="row">{area.label}</th>
              <td>{area.clicks.toLocaleString("en-US")}</td>
              <td>{area.percent}%</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
