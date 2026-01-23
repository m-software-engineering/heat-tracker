import express from "express";
import { createCollector } from "@m-software-engineering/heat-collector";

const app = express();

const collector = await createCollector({
  db: { dialect: "sqlite", file: "./heat-tracker.db" },
  auth: { mode: "projectKey" },
  autoMigrate: true,
  ingestion: {
    maxBodyBytes: 1_000_000,
    rateLimit: { windowMs: 10_000, max: 200 }
  },
  logging: { level: "info" }
});

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use(collector.router);

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`collector listening on http://localhost:${port}`);
});
