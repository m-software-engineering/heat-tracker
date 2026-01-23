import express, { type Request, type Response } from "express";
import crypto from "crypto";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { autoMigrate, createDb, type DbAdapterConfig, type DbContext } from "./db";
import { createLogger, type Logger } from "./logger";
import { createMetrics, type Metrics } from "./metrics";
import { ingestSchema, heatmapQuerySchema, sessionsQuerySchema, sessionEventsQuerySchema } from "./validation";
import { verifyJwt, type JwtConfig } from "./jwt";

export type AuthConfig =
  | { mode: "projectKey" }
  | { mode: "jwt" } & JwtConfig
  | { mode: "both" } & JwtConfig;

export type CollectorConfig = {
  db: DbAdapterConfig;
  auth: AuthConfig;
  autoMigrate?: boolean;
  ingestion?: {
    maxBodyBytes?: number;
    rateLimit?: { windowMs: number; max: number };
  };
  hooks?: {
    onBeforeInsert?: (payload: any) => any | Promise<any>;
  };
  logging?: { level: "debug" | "info" | "warn" | "error" };
};

export type Collector = {
  router: express.Router;
  ingestRouter: express.Router;
  apiRouter: express.Router;
  metrics: Metrics;
};

const DEFAULT_LIMIT = { windowMs: 10000, max: 120 };

type RateBucket = { count: number; resetAt: number };
const rateBuckets = new Map<string, RateBucket>();

const rateLimit = (key: string, windowMs: number, max: number) => {
  const now = Date.now();
  const existing = rateBuckets.get(key);
  if (!existing || now > existing.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  existing.count += 1;
  if (existing.count > max) {
    return true;
  }
  return false;
};

const parseTime = (value?: string) => {
  if (!value) return undefined;
  const asNum = Number(value);
  if (!Number.isNaN(asNum) && value.trim() !== "") return asNum;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const requestId = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
};

const parseViewportBucket = (bucket?: string) => {
  if (!bucket) return null;
  const [w, h] = bucket.split("x").map((n) => Number(n));
  if (!w || !h) return null;
  return { w, h };
};

const sanitizeEventMeta = (meta: any) => {
  if (!meta || typeof meta !== "object") return undefined;
  const clone = { ...meta };
  delete clone.value;
  delete clone.text;
  delete clone.content;
  return clone;
};

export const createCollector = async (config: CollectorConfig): Promise<Collector> => {
  const logger = createLogger(config.logging?.level || "info");
  const metrics = createMetrics();
  const dbContext = await createDb(config.db);

  if (config.autoMigrate ?? true) {
    await autoMigrate(dbContext);
  }

  const ingestRouter = express.Router();
  const apiRouter = express.Router();
  const router = express.Router();

  const maxBody = config.ingestion?.maxBodyBytes || 1_000_000;
  const limiter = config.ingestion?.rateLimit || DEFAULT_LIMIT;

  router.use(express.json({ limit: maxBody }));

  router.use((req, _res, next) => {
    (req as any).requestId = requestId();
    next();
  });

  ingestRouter.post("/ingest", async (req, res) => {
    const started = Date.now();
    const rid = (req as any).requestId;
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const projectKey = req.header("x-project-key");

    if (!projectKey) {
      logger.warn("missing project key", { requestId: rid });
      return res.status(401).json({ error: "missing project key" });
    }

    if (rateLimit(`${projectKey}:${ip}`, limiter.windowMs, limiter.max)) {
      return res.status(429).json({ error: "rate limit exceeded" });
    }

    const token = req.header("authorization")?.replace(/^Bearer /i, "");
    let jwtSub: string | undefined;
    try {
      if (config.auth.mode === "jwt" || config.auth.mode === "both") {
        if (!token) {
          if (config.auth.mode === "jwt") {
            return res.status(401).json({ error: "missing jwt" });
          }
        } else {
          const payload = await verifyJwt(token, config.auth);
          jwtSub = payload.sub;
        }
      }
    } catch (err: any) {
      logger.warn("jwt verification failed", { requestId: rid, error: err?.message });
      return res.status(401).json({ error: "invalid jwt" });
    }

    const parseResult = ingestSchema.safeParse(req.body);
    if (!parseResult.success) {
      metrics.rejectedEventCount += 1;
      return res.status(400).json({ error: "invalid payload", details: parseResult.error.flatten() });
    }

    let payload = parseResult.data;
    if (config.hooks?.onBeforeInsert) {
      payload = await config.hooks.onBeforeInsert(payload);
    }

    try {
      const { projectId, userId } = await ensureProjectAndUser(dbContext, projectKey, payload, jwtSub);
      await upsertSession(dbContext, projectId, userId, payload, req);
      await insertEvents(dbContext, projectId, userId, payload);

      metrics.ingestCount += 1;
      metrics.lastIngestMs = Date.now() - started;

      logger.info("ingest success", { requestId: rid, projectId, sessionId: payload.session.id });
      return res.json({ ok: true });
    } catch (err: any) {
      metrics.ingestErrorCount += 1;
      logger.error("ingest failed", { requestId: rid, error: err?.message });
      return res.status(500).json({ error: "ingest failed" });
    }
  });

  apiRouter.get("/api/projects/:projectId/heatmap", async (req, res) => {
    const parseResult = heatmapQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({ error: "invalid query" });
    }
    const query = parseResult.data;
    const projectId = req.params.projectId;
    const from = parseTime(query.from) ?? 0;
    const to = parseTime(query.to) ?? Date.now();
    const type = query.type ?? "click";

    try {
      const rows = await queryEvents(dbContext, projectId, type, query.path, from, to);
      const result = buildHeatmap(rows, query.resolution, query.viewportBucket);
      return res.json(result);
    } catch (err: any) {
      logger.error("heatmap query failed", { error: err?.message });
      return res.status(500).json({ error: "heatmap query failed" });
    }
  });

  apiRouter.get("/api/projects/:projectId/sessions", async (req, res) => {
    const parseResult = sessionsQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({ error: "invalid query" });
    }
    const query = parseResult.data;
    const projectId = req.params.projectId;
    const from = parseTime(query.from);
    const to = parseTime(query.to);

    try {
      const sessions = await listSessions(dbContext, projectId, query, from, to);
      return res.json({ sessions });
    } catch (err: any) {
      logger.error("sessions query failed", { error: err?.message });
      return res.status(500).json({ error: "sessions query failed" });
    }
  });

  apiRouter.get("/api/sessions/:sessionId", async (req, res) => {
    const parseResult = sessionEventsQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({ error: "invalid query" });
    }
    const query = parseResult.data;

    try {
      const detail = await getSessionDetail(dbContext, req.params.sessionId, query);
      return res.json(detail);
    } catch (err: any) {
      logger.error("session detail failed", { error: err?.message });
      return res.status(500).json({ error: "session detail failed" });
    }
  });

  router.use(ingestRouter);
  router.use(apiRouter);

  return { router, ingestRouter, apiRouter, metrics };
};

const ensureProjectAndUser = async (
  ctx: DbContext,
  projectKey: string,
  payload: any,
  jwtSub?: string
): Promise<{ projectId: string; userId?: string }> => {
  const now = Date.now();
  const { projects, users } = ctx.schema as any;

  const existing = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.key, projectKey))
    .limit(1);

  let projectId: string;
  if (existing.length === 0) {
    projectId = crypto.randomUUID();
    await ctx.db.insert(projects).values({
      id: projectId,
      key: projectKey,
      name: "Default",
      createdAt: now
    });
  } else {
    projectId = existing[0].id;
  }

  const externalId = jwtSub ?? payload.user?.id;
  if (!externalId) {
    return { projectId };
  }

  const existingUser = await ctx.db
    .select()
    .from(users)
    .where(and(eq(users.projectId, projectId), eq(users.externalId, externalId)))
    .limit(1);

  let userId: string;
  if (existingUser.length === 0) {
    userId = crypto.randomUUID();
    await ctx.db.insert(users).values({
      id: userId,
      projectId,
      externalId,
      traitsJson: payload.user?.traits ? JSON.stringify(payload.user.traits) : null,
      createdAt: now
    });
  } else {
    userId = existingUser[0].id;
  }

  return { projectId, userId };
};

const upsertSession = async (ctx: DbContext, projectId: string, userId: string | undefined, payload: any, req: Request) => {
  const { sessions } = ctx.schema as any;
  const now = Date.now();
  const sessionId = payload.session.id;
  const existing = await ctx.db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);

  if (existing.length === 0) {
    await ctx.db.insert(sessions).values({
      id: sessionId,
      projectId,
      userId: userId ?? null,
      startedAt: payload.session.startedAt ?? now,
      lastSeenAt: payload.session.lastSeenAt ?? now,
      firstPath: payload.events[0]?.path ?? payload.session.firstPath ?? "",
      userAgent: req.header("user-agent") || payload.events[0]?.device?.ua || null,
      deviceJson: payload.events[0]?.device ? JSON.stringify(payload.events[0].device) : null,
      ipHash: hashIp(req.ip || "")
    });
  } else {
    await ctx.db
      .update(sessions)
      .set({
        lastSeenAt: payload.session.lastSeenAt ?? now,
        userId: userId ?? existing[0].userId
      })
      .where(eq(sessions.id, sessionId));
  }
};

const hashIp = (ip: string) => {
  if (!ip) return null;
  const hash = crypto.createHash("sha256").update(ip).digest("hex");
  return hash.slice(0, 32);
};

const insertEvents = async (ctx: DbContext, projectId: string, userId: string | undefined, payload: any) => {
  const { events } = ctx.schema as any;
  const rows: any[] = [];

  for (const event of payload.events) {
    if (event.type === "input" && event.masked && /[^*]/.test(event.masked)) {
      continue;
    }

    const base = {
      id: crypto.randomUUID(),
      projectId,
      sessionId: payload.session.id,
      userId: userId ?? null,
      type: event.type,
      ts: event.ts,
      path: event.path,
      selector: event.selector ?? null,
      metaJson: JSON.stringify({
        viewport: event.viewport,
        device: event.device,
        meta: sanitizeEventMeta(event.meta)
      })
    };

    if (event.type === "move" && Array.isArray(event.points)) {
      for (const point of event.points) {
        rows.push({
          ...base,
          id: crypto.randomUUID(),
          ts: event.ts + point.tsOffset,
          x: Math.round(point.x),
          y: Math.round(point.y)
        });
      }
      continue;
    }

    if (event.type === "click") {
      rows.push({
        ...base,
        x: Math.round(event.x),
        y: Math.round(event.y)
      });
      continue;
    }

    if (event.type === "scroll") {
      rows.push({
        ...base,
        scrollDepth: Math.round(event.scrollDepthPct * 100)
      });
      continue;
    }

    rows.push(base);
  }

  if (rows.length === 0) return;
  await ctx.db.insert(events).values(rows);
};

const queryEvents = async (
  ctx: DbContext,
  projectId: string,
  type: string,
  path: string | undefined,
  from: number,
  to: number
) => {
  const { events } = ctx.schema as any;
  const filters = [eq(events.projectId, projectId), eq(events.type, type), gte(events.ts, from), lte(events.ts, to)];
  if (path) filters.push(eq(events.path, path));
  const where = and(...filters);
  return ctx.db.select().from(events).where(where);
};

const buildHeatmap = (rows: any[], resolution: number, viewportBucket?: string) => {
  const buckets: Record<string, number> = {};
  const bucketCounts: Record<string, number> = {};
  const parsedBuckets: Record<string, { w: number; h: number }> = {};

  for (const row of rows) {
    const meta = row.metaJson ? JSON.parse(row.metaJson) : {};
    const bucket = meta?.meta?.viewportBucket || "";
    if (bucket) {
      bucketCounts[bucket] = (bucketCounts[bucket] || 0) + 1;
      if (!parsedBuckets[bucket]) {
        const parsed = parseViewportBucket(bucket);
        if (parsed) parsedBuckets[bucket] = parsed;
      }
    }
  }

  const preferredBucket = viewportBucket || Object.entries(bucketCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const viewport = parseViewportBucket(preferredBucket) || { w: 1280, h: 720 };

  const bucketWidth = viewport.w / resolution;
  const bucketHeight = viewport.h / resolution;

  for (const row of rows) {
    let x = row.x;
    let y = row.y;
    if (row.type === "scroll" && row.scrollDepth != null) {
      const pct = row.scrollDepth / 100;
      x = 0;
      y = Math.round((pct / 100) * viewport.h);
    }
    if (typeof x !== "number" || typeof y !== "number") continue;
    const bx = Math.min(resolution - 1, Math.max(0, Math.floor(x / bucketWidth)));
    const by = Math.min(resolution - 1, Math.max(0, Math.floor(y / bucketHeight)));
    const key = `${bx}:${by}`;
    buckets[key] = (buckets[key] || 0) + 1;
  }

  const points = Object.entries(buckets).map(([key, value]) => {
    const [bx, by] = key.split(":").map((n) => Number(n));
    return {
      x: Math.round((bx + 0.5) * bucketWidth),
      y: Math.round((by + 0.5) * bucketHeight),
      value
    };
  });

  return {
    points,
    meta: {
      resolution,
      viewport,
      total: rows.length,
      bucket: preferredBucket || `${viewport.w}x${viewport.h}`
    }
  };
};

const listSessions = async (
  ctx: DbContext,
  projectId: string,
  query: { limit: number; offset: number; userId?: string; path?: string },
  from?: number,
  to?: number
) => {
  const { sessions, events } = ctx.schema as any;
  const filters = [eq(sessions.projectId, projectId)];
  if (query.userId) filters.push(eq(sessions.userId, query.userId));
  if (from) filters.push(gte(sessions.startedAt, from));
  if (to) filters.push(lte(sessions.lastSeenAt, to));

  const where = and(...filters);

  const rows = await ctx.db
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      startedAt: sessions.startedAt,
      lastSeenAt: sessions.lastSeenAt,
      firstPath: sessions.firstPath,
      eventCount: sql<number>`count(${events.id})`
    })
    .from(sessions)
    .leftJoin(events, eq(events.sessionId, sessions.id))
    .where(where)
    .groupBy(sessions.id)
    .limit(query.limit)
    .offset(query.offset);

  if (query.path) {
    return rows.filter((row: any) => row.firstPath === query.path);
  }

  return rows;
};

const getSessionDetail = async (
  ctx: DbContext,
  sessionId: string,
  query: { limit: number; offset: number; type?: string }
) => {
  const { sessions, events } = ctx.schema as any;

  const sessionRows = await ctx.db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (sessionRows.length === 0) {
    return { session: null, events: [] };
  }

  const filters = [eq(events.sessionId, sessionId)];
  if (query.type) filters.push(eq(events.type, query.type));
  const where = and(...filters);

  const eventRows = await ctx.db
    .select()
    .from(events)
    .where(where)
    .orderBy(events.ts)
    .limit(query.limit)
    .offset(query.offset);

  return { session: sessionRows[0], events: eventRows };
};
