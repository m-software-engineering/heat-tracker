export type Metrics = {
  ingestCount: number;
  ingestErrorCount: number;
  rejectedEventCount: number;
  lastIngestMs: number | null;
};

export const createMetrics = (): Metrics => ({
  ingestCount: 0,
  ingestErrorCount: 0,
  rejectedEventCount: 0,
  lastIngestMs: null
});
