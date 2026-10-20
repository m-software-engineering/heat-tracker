---
"@m-software-engineering/heat-collector": minor
---

Heatmaps are aggregated in the database. `GET /api/projects/:projectId/heatmap` now runs grouped queries (`GROUP BY` on bucketed coordinates for Postgres, MySQL and SQLite; aggregation pipelines for MongoDB) instead of loading every matched event into Node, so collector memory no longer grows with traffic. Whole hours are served from a `heatmap_rollup` table that ingest keeps up to date, so 1 M events stay within p95 ≤ 500 ms. Output is golden-tested on every database, plus `meta.totalEvents`, `meta.sampled` (`false`), `meta.range`, `meta.excluded` and `meta.viewportBuckets`.

- `autoMigrate` creates the `events_project_path_type_ts_idx` index on (project, path, type, ts), adds `events.viewport_bucket` (filled for existing rows) `events.rollup_state`, and creates and backfills `heatmap_rollup` in locked batches (safe under concurrent ingest; never double-counts). Ingest writes events and rollup in one transaction. The first start after upgrading reads every stored event once (about 75 s per 1M events on Postgres).
- **Behavior change:** without `from` and `to` a heatmap covers the last 7 days (ending with the current hour) instead of all time; `meta.range` returns the applied range.
- **Behavior change (SQL):** `click`/`move` events without coordinates are no longer plotted at 0,0; they are skipped (as MongoDB already did) and counted in `meta.excluded.noCoordinates`.
- New `viewport=<w>x<h>` query param filters events by stored viewport bucket.
- Without `viewportBucket`, the default viewport is the most common bucket among the 10,000 most recent matching events (identical to before when fewer events match).
- `viewportBucket` must be `<width>x<height>` (e.g. `1440x900`); other values now return 400 `HEAT_E_QUERY_INVALID` naming the param instead of silently using 1280x720.

During a rolling upgrade, events written by older collectors are counted before heatmap reads and by a periodic background catch-up (`heatmap.rollupCatchUpIntervalMs`), so whole-hour heatmaps no longer miss them. Adds `Collector.close()` and the `HEAT_E_ROLLUP_CATCH_UP` error code.
