---
"@m-software-engineering/heat-collector": minor
---

Heatmaps are aggregated in the database. `GET /api/projects/:projectId/heatmap` now runs grouped queries (`GROUP BY` on bucketed coordinates for Postgres, MySQL and SQLite; aggregation pipelines for MongoDB) instead of loading every matched event into Node, so collector memory no longer grows with traffic. Output is unchanged (golden-tested against the old path), plus `meta.totalEvents` and `meta.sampled` (`false`).

- `autoMigrate` creates the `events_project_path_type_ts_idx` index on (project, path, type, ts).
- Without `viewportBucket`, the default viewport is the most common bucket among the 10,000 most recent matching events (identical to before when fewer events match).
- `viewportBucket` must be `<width>x<height>` (e.g. `1440x900`); other values now return 400 `HEAT_E_QUERY_INVALID` naming the param instead of silently using 1280x720.
