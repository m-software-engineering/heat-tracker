"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HeatError } from "@m-software-engineering/heat-errors";
import { fetchHeatmap, type HeatmapResponse } from "../lib/api";
import { isInconclusive, type FrameVerdict } from "../lib/frame-policy";
import { renderHeatmap } from "../lib/heatmap-render";
import { topAreas } from "../lib/top-areas";
import {
  DEFAULT_VIEW,
  readViewState,
  viewportClassOf,
  viewportOptions,
  writeViewState,
  type BucketCount,
  type ViewState
} from "../lib/view-state";
import { HANDSHAKE_TIMEOUT_MS } from "../lib/frame-handshake";
import { useFrameHandshake } from "../lib/use-frame-handshake";
import FrameBlockedNotice from "./FrameBlockedNotice";
import FrameCheckFailedNotice from "./FrameCheckFailedNotice";
import { FrameNoResponseNotice, FrameRedirectedNotice } from "./FrameHandshakeNotice";
import HeatmapControls from "./HeatmapControls";
import HeatmapLegend from "./HeatmapLegend";
import SiteNotAllowedNotice from "./SiteNotAllowedNotice";
import TopAreasTable from "./TopAreasTable";

type Props = {
  collectorUrl: string;
  projectId: string;
  /** Origin of the tracked site, e.g. https://example.com. Empty = no frame (blank-canvas heatmap). */
  siteOrigin: string;
  path: string;
  /** Server route that reads the site's framing headers (see app/api/frame-check). */
  frameCheckUrl?: string;
  /** How long the framed page may take to send its SDK handshake before "didn't respond" is shown. */
  handshakeTimeoutMs?: number;
};

type CheckResponse = FrameVerdict & { allowedOrigins?: string[] };

const DAY_MS = 86_400_000;
const FRAME_CHECK_BUDGET_MS = 3_000;

const useViewState = () => {
  const [state, setState] = useState<ViewState>(() =>
    typeof window === "undefined" ? DEFAULT_VIEW : readViewState(new URLSearchParams(window.location.search))
  );
  const update = useCallback((patch: Partial<ViewState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      const params = writeViewState(new URLSearchParams(window.location.search), next);
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
      return next;
    });
  }, []);
  return [state, update] as const;
};

const useFrameVerdict = (pageUrl: string, frameCheckUrl: string) => {
  const [verdict, setVerdict] = useState<CheckResponse | null>(null);
  useEffect(() => {
    setVerdict(null);
    if (!pageUrl) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FRAME_CHECK_BUDGET_MS);
    const query = new URLSearchParams({ url: pageUrl, origin: window.location.origin });
    let active = true;
    fetch(`${frameCheckUrl}?${query}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`frame check returned ${res.status}`))))
      .then((body: CheckResponse) => active && setVerdict(body))
      // The dashboard's own route gave no answer (client budget, error): fail closed and do not load the page.
      // A slow or unreachable site is reported by the route itself as inconclusive (fail open).
      .catch((err: Error) => {
        if (!active) return;
        const detail = controller.signal.aborted ? "frame check timed out" : err.message || "frame check failed";
        setVerdict({ verified: false, blocked: false, reason: "check-failed", detail });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      controller.abort();
    };
  }, [pageUrl, frameCheckUrl]);
  return verdict;
};

export default function PageHeatmap({
  collectorUrl,
  projectId,
  siteOrigin,
  path,
  frameCheckUrl = "/api/frame-check",
  handshakeTimeoutMs = HANDSHAKE_TIMEOUT_MS
}: Props) {
  const [state, update] = useViewState();
  const [data, setData] = useState<HeatmapResponse | null>(null);
  const [error, setError] = useState<HeatError | null>(null);
  const [rendered, setRendered] = useState(false);
  const [scale, setScale] = useState(1);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const pageUrl = siteOrigin ? new URL(path, siteOrigin).toString() : "";
  const verdict = useFrameVerdict(pageUrl, frameCheckUrl);
  const inconclusive = verdict !== null && isInconclusive(verdict);
  const notAllowed = verdict?.verified === false && verdict.reason === "not-allowed";
  const refused = verdict?.verified === false && !inconclusive && !notAllowed;
  // The server read X-Frame-Options or CSP frame-ancestors and they forbid framing: blocked right away, no frame.
  const blocked = verdict?.verified === true && verdict.blocked;
  // Otherwise (allowed or inconclusive) the page is framed and only the SDK handshake proves it is showing
  // (the iframe's load event fires for Chromium's error page too); the verdict detail is logged.
  const framed = Boolean(pageUrl) && (verdict?.verified === true || inconclusive) && !blocked;
  const handshake = useFrameHandshake(
    frameRef,
    pageUrl,
    framed,
    verdict?.allowedOrigins ?? [],
    handshakeTimeoutMs,
    verdict?.detail ?? ""
  );
  const answered = handshake.status === "ok" || handshake.status === "redirected";
  const showHeatmap = state.showHeatmap && handshake.status !== "redirected";
  // Bucket counts ignore the viewport filter, so the last response always has every option's count.
  const [buckets, setBuckets] = useState<BucketCount[] | null>(null);
  const options = useMemo(() => (buckets ? viewportOptions(buckets) : null), [buckets]);
  // No choice yet: the busiest class, so the checked option is always the one plotted.
  const busiest = options?.reduce((a, b) => (b.count > a.count ? b : a));
  const chosen = state.viewport ? options?.find((o) => o.viewport === state.viewport) : busiest;
  // The whole class is filtered; the busiest bucket goes first, so it sets the frame width.
  const filterBucket = chosen && chosen.count > 0 ? chosen.buckets.join(",") : undefined;

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setError(null);
    const params: Record<string, string> = { path, type: "click", from: String(Date.now() - state.days * DAY_MS) };
    // A chosen viewport filters events once its bucket is known (after the first response).
    if (filterBucket) params.viewport = filterBucket;
    fetchHeatmap(collectorUrl, projectId, params)
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setBuckets(body.meta.viewportBuckets ?? []);
      })
      .catch((err: HeatError) => !cancelled && setError(err));
    return () => {
      cancelled = true;
    };
  }, [collectorUrl, projectId, path, filterBucket, state.days]);

  const width = data?.meta.viewport.w ?? 1280;
  const height = Math.max(data?.meta.renderHeight ?? 720, data?.meta.viewport.h ?? 720);
  const max = useMemo(() => Math.max(1, ...(data?.points ?? []).map((p) => p.value)), [data]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    // Whole percent, rounded down, so the scaled frame never overflows (no horizontal scroll).
    const observer = new ResizeObserver(() =>
      setScale(Math.min(1, Math.floor((scroller.clientWidth / width) * 100) / 100))
    );
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    let cancelled = false;
    setRendered(false);
    const bucket = Math.max(width, height) / data.meta.resolution;
    void renderHeatmap(
      canvas,
      data.points,
      { width, height, radius: Math.max(12, bucket * 1.2) },
      () => cancelled
    ).then((ms) => {
      if (cancelled) return;
      canvas.dataset.renderMs = String(Math.round(ms));
      setRendered(true);
    });
    return () => {
      cancelled = true;
    };
  }, [data, width, height]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest("input, select, textarea")) return;
      if (event.key === "h" || event.key === "H") update({ showHeatmap: !state.showHeatmap });
      if (event.key === "[") update({ opacity: Math.max(0, state.opacity - 10) });
      if (event.key === "]") update({ opacity: Math.min(100, state.opacity + 10) });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.showHeatmap, state.opacity, update]);

  const activeViewport = state.viewport ?? busiest?.viewport ?? viewportClassOf(width);
  const period = `${state.days} ${state.days === 1 ? "day" : "days"}`;
  const rangeLabel = `Last ${period}`;
  const clicks = data?.meta.totalEvents ?? 0;
  const summary = `${clicks.toLocaleString("en-US")} clicks · ${rangeLabel} · ${activeViewport}${data?.meta.sampled ? " · sampled" : ""}`;
  const noPosition = data?.meta.excluded?.noCoordinates ?? 0;
  const areas = useMemo(() => (data ? topAreas(data.points, data.meta.viewport) : []), [data]);

  return (
    <section
      className="page-heatmap"
      aria-label={`Click heatmap for ${path}`}
      data-frame-state={blocked ? "blocked" : framed ? handshake.status : "none"}
    >
      <HeatmapControls state={state} activeViewport={activeViewport} options={options} onChange={update} />
      <p className="ph-summary" aria-live="polite" data-testid="heatmap-summary">
        {data ? summary : "Loading heatmap…"}
      </p>
      {data && clicks === 0 && <p className="ph-empty">No clicks on this page in the last {period}.</p>}
      {noPosition > 0 && (
        <p className="ph-note" data-testid="no-position-note">
          {noPosition === 1
            ? "1 click without a position isn't shown"
            : `${noPosition.toLocaleString("en-US")} clicks without a position aren't shown`}
        </p>
      )}
      {error && (
        <div role="alert" className="ph-alert" data-code={error.code}>
          <strong>{error.code}</strong> {error.message} Cause: {error.cause}. Fix: {error.fix}
        </div>
      )}
      {notAllowed && <SiteNotAllowedNotice siteOrigin={new URL(siteOrigin).origin} />}
      {refused && <FrameCheckFailedNotice reason={verdict.detail} />}
      {blocked && <FrameBlockedNotice reason={verdict.detail} dashboardOrigin={window.location.origin} />}
      {framed && handshake.status === "no-response" && <FrameNoResponseNotice pageUrl={pageUrl} />}
      {framed && handshake.status === "redirected" && <FrameRedirectedNotice href={handshake.href} />}
      <TopAreasTable areas={areas} visible={state.view === "table"} caption={summary} />
      <div
        className="ph-scroller"
        ref={scrollerRef}
        hidden={state.view === "table"}
        data-testid="heatmap-scroller"
        // Scrollable, so keyboard users must be able to focus it (arrow keys scroll the page preview).
        tabIndex={0}
        role="region"
        aria-label={`Page preview of ${path} with heatmap`}
      >
        <div style={{ width: width * scale, height: height * scale }}>
          <div className="ph-stage" style={{ width, height, transform: `scale(${scale})` }} data-testid="heatmap-stage">
            {framed && (
              <iframe
                title={`Page preview of ${path}`}
                src={pageUrl}
                sandbox="allow-same-origin allow-scripts"
                tabIndex={-1}
                scrolling="no"
                ref={frameRef}
                // Hidden until the page answers, so Chromium's error page never shows through.
                style={{ width, height, pointerEvents: "none", visibility: answered ? "visible" : "hidden" }}
              />
            )}
            {(!data || (framed && handshake.status === "waiting") || (pageUrl && !verdict)) && (
              <div className="ph-skeleton" aria-hidden="true" />
            )}
            <canvas
              ref={canvasRef}
              className={rendered && showHeatmap ? "ph-canvas ready" : "ph-canvas"}
              // A redirected page would not line up with the clicks: hide the heatmap.
              hidden={handshake.status === "redirected"}
              style={{ width, height, ["--heat-opacity" as string]: state.opacity / 100 }}
              aria-hidden="true"
              data-testid="heatmap-canvas"
            />
          </div>
        </div>
      </div>
      <p className="ph-note" data-testid="frame-scale">
        {width} px{scale < 1 ? `, ${Math.round(scale * 100)}%` : ""}
      </p>
      <HeatmapLegend max={max} />
    </section>
  );
}
