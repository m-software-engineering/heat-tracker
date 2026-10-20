"use client";

import { Fragment } from "react";
import { PERIOD_DAYS, type ViewState, type ViewportClass, type ViewportOption } from "../lib/view-state";

type Props = {
  state: ViewState;
  activeViewport: ViewportClass;
  /** null until the first response arrives. */
  options: ViewportOption[] | null;
  onChange: (next: Partial<ViewState>) => void;
};

const EMPTY_REASON = "No events for this viewport in this period";

const LABELS: Record<ViewportClass, string> = { desktop: "Desktop", tablet: "Tablet", mobile: "Mobile" };

export default function HeatmapControls({ state, activeViewport, options, onChange }: Props) {
  return (
    <div className="ph-toolbar">
      <fieldset className="ph-radios">
        <legend>Viewport</legend>
        {(options ?? []).map(({ viewport, bucket, count }) => {
          const empty = count === 0;
          return (
            <Fragment key={viewport}>
              <label
                className={empty ? "ph-target disabled" : "ph-target"}
                title={empty ? EMPTY_REASON : `${bucket} px`}
              >
                <input
                  type="radio"
                  name="heatmap-viewport"
                  value={viewport}
                  checked={activeViewport === viewport}
                  disabled={empty}
                  aria-describedby={empty ? `heatmap-viewport-${viewport}-reason` : undefined}
                  onChange={() => onChange({ viewport })}
                />
                {LABELS[viewport]} · {count.toLocaleString("en-US")}
              </label>
              {/* title alone is not exposed reliably to assistive technology. */}
              {empty && (
                <span id={`heatmap-viewport-${viewport}-reason`} className="sr-only">
                  {EMPTY_REASON}
                </span>
              )}
            </Fragment>
          );
        })}
      </fieldset>
      <label className="ph-target">
        Opacity <span aria-hidden="true">([ / ])</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={state.opacity}
          aria-valuetext={`${state.opacity}%`}
          onChange={(e) => onChange({ opacity: Number(e.target.value) })}
        />
        <output>{state.opacity}%</output>
      </label>
      <button
        type="button"
        className="ph-target"
        aria-pressed={state.showHeatmap}
        aria-keyshortcuts="H"
        onClick={() => onChange({ showHeatmap: !state.showHeatmap })}
      >
        Heatmap (H)
      </button>
      <button
        type="button"
        className="ph-target"
        aria-pressed={state.view === "table"}
        onClick={() => onChange({ view: state.view === "table" ? "map" : "table" })}
      >
        Table
      </button>
      <label className="ph-target">
        Period
        <select value={state.days} onChange={(e) => onChange({ days: Number(e.target.value) })}>
          {PERIOD_DAYS.map((days) => (
            <option key={days} value={days}>
              Last {days} {days === 1 ? "day" : "days"}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
