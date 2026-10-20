// Child process for heatmap-bench.mjs: hosts the built collector and reports its RSS over IPC.
import express from "express";
import { createCollector } from "../dist/index.js";

const collector = await createCollector({
  db: { dialect: "pg", connectionString: process.env.DATABASE_URL },
  auth: { mode: "projectKey" },
  logging: { level: "error" }
});
const app = express();
app.use(collector.router);
const server = app.listen(0, "127.0.0.1", () => {
  process.send({ port: server.address().port });
  setInterval(() => process.connected && process.send({ rss: process.memoryUsage().rss }), 100).unref();
});
process.on("disconnect", () => process.exit(0));
