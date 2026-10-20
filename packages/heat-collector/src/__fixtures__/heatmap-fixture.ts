/** Deterministic ingest payloads and queries for the heatmap golden test. */
const BASE_TS = 1_760_000_000_000;

const viewports = [
  { w: 1440, h: 900, dpr: 2 },
  { w: 1440, h: 900, dpr: 1 },
  { w: 390, h: 844, dpr: 3 },
  { w: 1366, h: 768 }
];

const device = { ua: "golden", platform: "linux", language: "en" };

const event = (i: number, fields: Record<string, unknown>) => ({
  eventId: `golden-${i}`,
  sessionId: `golden-session-${i % 3}`,
  ts: BASE_TS + i * 1000,
  path: "/pricing",
  viewport: viewports[i % viewports.length],
  device,
  ...fields
});

const pricingEvents = () => {
  const events: any[] = [];
  for (let i = 0; i < 60; i += 1) {
    events.push(event(i, { type: "click", x: (i * 37) % 1500, y: (i * 53) % 2600 }));
  }
  events.push(event(60, { type: "click", x: 0, y: 0 }));
  events.push(event(61, { type: "click", x: 1439, y: 899 }));
  events.push(event(62, { type: "click", x: 5000, y: 4000 }));
  events.push(event(63, { type: "click", x: 12.6, y: 7.4, meta: { viewportBucket: "390x800" } }));
  events.push(event(64, { type: "click", x: 300, y: 300, meta: { viewportBucket: "not-a-bucket" } }));
  events.push(
    event(65, {
      type: "move",
      points: [
        { x: 10, y: 10, tsOffset: 0 },
        { x: 700.4, y: 450.5, tsOffset: 16 },
        { x: 1439, y: 1800, tsOffset: 32 }
      ]
    })
  );
  for (const [n, pct] of [10, 50, 99, 100, 250].entries()) {
    events.push(event(66 + n, { type: "scroll", scrollY: pct * 10, scrollDepthPct: pct }));
  }
  events.push(event(71, { type: "pageview", to: "/pricing" }));
  events.push(event(72, { type: "custom", name: "cta" }));
  events.push(event(73, { type: "keyboard", category: "navigation" }));
  // Breaks the 400x800 / 1400x900 tie among scroll rows: tie order is row order, which SQL does not fix.
  events.push(event(74, { type: "scroll", scrollY: 0, scrollDepthPct: 0 }));
  return events;
};

const sessionsOf = (events: any[]) => [...new Set(events.map((e) => e.sessionId as string))];

/** Payloads grouped by session so each ingest request has one session. */
export const goldenPayloads = () => {
  const events = [
    ...pricingEvents(),
    ...[0, 1, 2].map((i) => ({ ...event(100 + i, { type: "pageview", to: "/docs" }), path: "/docs" }))
  ];
  return sessionsOf(events).map((sessionId) => ({
    sdk: { name: "golden", version: "0" },
    session: { id: sessionId, startedAt: BASE_TS, lastSeenAt: BASE_TS },
    events: events.filter((e) => e.sessionId === sessionId)
  }));
};

// The events fall in one hour; this window covers it and the next as whole hours (served by the rollup).
const WINDOW = { from: String(BASE_TS - 3_600_000), to: String(BASE_TS + 3_600_000) };

/** Query strings exercised by the golden test, keyed by a stable name. */
export const goldenQueries: Record<string, Record<string, string>> = {
  defaultClick: { ...WINDOW, path: "/pricing" },
  allTypes: { ...WINDOW, path: "/pricing", type: "all" },
  scrollLowRes: { ...WINDOW, path: "/pricing", type: "scroll", resolution: "32" },
  moveFixedBucket: { ...WINDOW, path: "/pricing", type: "move", viewportBucket: "1440x900" },
  clickHighRes: { ...WINDOW, path: "/pricing", type: "click", resolution: "1024" },
  fallbackToAll: { ...WINDOW, path: "/docs" },
  explicitClickEmpty: { ...WINDOW, path: "/docs", type: "click" },
  noEvents: { ...WINDOW, path: "/nowhere" },
  // Starts mid-hour, so it is read from raw events only.
  timeWindow: { path: "/pricing", type: "all", from: String(BASE_TS + 10_000), to: String(BASE_TS + 40_000) },
  wholeProject: { ...WINDOW, type: "all" },
  mobileOnly: { ...WINDOW, path: "/pricing", type: "all", viewport: "400x800" },
  mobileOnlyRaw: {
    path: "/pricing",
    type: "all",
    viewport: "400x800",
    from: String(BASE_TS),
    to: String(BASE_TS + 100_000)
  }
};
