/** One-click batch, as the SDK would send it. */
export const clickBatch = (sessionId = "onboarding-session") => {
  const ts = Date.now();
  return {
    sdk: { name: "heat-sdk", version: "e2e" },
    session: { id: sessionId, startedAt: ts, lastSeenAt: ts },
    events: [
      {
        eventId: `${sessionId}-1`,
        sessionId,
        ts,
        path: "/",
        viewport: { w: 1280, h: 720, dpr: 1 },
        device: { ua: "e2e", platform: "linux", language: "en" },
        type: "click",
        x: 10,
        y: 20
      }
    ]
  };
};
