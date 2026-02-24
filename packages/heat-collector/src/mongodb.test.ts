import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createCollector } from "./collector";
import { autoMigrate, createDb } from "./db";

class FakeCursor {
  constructor(private docs: any[]) {}

  sort(spec: Record<string, 1 | -1>) {
    const [field, direction] = Object.entries(spec)[0] || [];
    if (!field) return this;
    this.docs = [...this.docs].sort((a, b) => {
      const av = a[field] ?? 0;
      const bv = b[field] ?? 0;
      return direction === -1 ? bv - av : av - bv;
    });
    return this;
  }

  skip(offset: number) {
    this.docs = this.docs.slice(offset);
    return this;
  }

  limit(size: number) {
    this.docs = this.docs.slice(0, size);
    return this;
  }

  async toArray() {
    return this.docs;
  }
}

const matchFilter = (doc: any, filter: any) => {
  for (const [key, value] of Object.entries(filter || {})) {
    const actual = doc[key];
    if (value && typeof value === "object" && ("$gte" in value || "$lte" in value)) {
      if (typeof (value as any).$gte === "number" && !(actual >= (value as any).$gte)) return false;
      if (typeof (value as any).$lte === "number" && !(actual <= (value as any).$lte)) return false;
      continue;
    }
    if (actual !== value) return false;
  }
  return true;
};

class FakeCollection {
  docs: any[] = [];
  indexes: any[] = [];
  failCreateIndex = false;

  async createIndex(index: any, options?: any) {
    if (this.failCreateIndex) {
      throw Object.assign(new Error("not authorized"), { code: 13, codeName: "Unauthorized" });
    }
    this.indexes.push({ index, options });
    return "ok";
  }

  async findOne(filter: any) {
    return this.docs.find((doc) => matchFilter(doc, filter)) ?? null;
  }

  async insertOne(doc: any) {
    this.docs.push({ ...doc });
    return { acknowledged: true };
  }

  async insertMany(rows: any[]) {
    this.docs.push(...rows.map((row) => ({ ...row })));
    return { acknowledged: true };
  }

  async updateOne(filter: any, update: any) {
    const found = this.docs.find((doc) => matchFilter(doc, filter));
    if (!found) return { matchedCount: 0 };
    Object.assign(found, update.$set || {});
    return { matchedCount: 1 };
  }

  find(filter: any) {
    return new FakeCursor(this.docs.filter((doc) => matchFilter(doc, filter)));
  }

  async countDocuments(filter: any) {
    return this.docs.filter((doc) => matchFilter(doc, filter)).length;
  }
}

class FakeMongoDb {
  private collections = new Map<string, FakeCollection>();

  collection(name: string) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new FakeCollection());
    }
    return this.collections.get(name)!;
  }
}

const buildPayload = () => {
  const ts = Date.now();
  return {
    sdk: { name: "test", version: "0" },
    session: { id: "mongo-session-1", startedAt: ts, lastSeenAt: ts },
    user: { id: "ext-user-1", traits: { role: "beta" } },
    events: [
      {
        eventId: "event-1",
        sessionId: "mongo-session-1",
        ts,
        path: "/",
        viewport: { w: 1200, h: 800, dpr: 2 },
        device: { ua: "test", platform: "mac", language: "en" },
        type: "click",
        x: 100,
        y: 200
      }
    ]
  };
};

describe("mongodb support", () => {
  it("creates mongodb adapter with injected db and migrates indexes", async () => {
    const db = new FakeMongoDb();
    const ctx = await createDb({ dialect: "mongodb", db });
    await autoMigrate(ctx);

    expect(ctx.dialect).toBe("mongodb");
    expect(db.collection("projects").indexes.length).toBeGreaterThan(0);
    expect(db.collection("events").indexes.length).toBeGreaterThan(0);
  });

  it("does not fail migration when mongodb user cannot create indexes", async () => {
    const db = new FakeMongoDb();
    db.collection("projects").failCreateIndex = true;
    db.collection("users").failCreateIndex = true;
    db.collection("sessions").failCreateIndex = true;
    db.collection("events").failCreateIndex = true;

    const ctx = await createDb({ dialect: "mongodb", db });
    await expect(autoMigrate(ctx)).resolves.toBeUndefined();
  });

  it("ingests and serves data through mongodb backend", async () => {
    const db = new FakeMongoDb();
    const collector = await createCollector({
      db: { dialect: "mongodb", db },
      auth: { mode: "projectKey" },
      autoMigrate: true
    });

    const app = express();
    app.use(collector.router);

    await request(app).post("/ingest").set("x-project-key", "mongo-key").send(buildPayload()).expect(200);

    const project = await db.collection("projects").findOne({ key: "mongo-key" });
    expect(project?.id).toBeTruthy();

    const heatmap = await request(app)
      .get(`/api/projects/${project.id}/heatmap`)
      .query({ path: "/", type: "click", resolution: 64 })
      .expect(200);
    expect(heatmap.body.points.length).toBe(1);

    const sessions = await request(app).get(`/api/projects/${project.id}/sessions`).query({ limit: 10 }).expect(200);
    expect(sessions.body.sessions.length).toBe(1);
    expect(sessions.body.sessions[0].eventCount).toBe(1);

    const detail = await request(app).get("/api/sessions/mongo-session-1").query({ limit: 10 }).expect(200);
    expect(detail.body.session.id).toBe("mongo-session-1");
    expect(detail.body.events.length).toBe(1);
  });
});
