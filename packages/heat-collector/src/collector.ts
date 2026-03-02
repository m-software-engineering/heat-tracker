import express, { type Request, type Response } from "express";
import crypto from "crypto";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { autoMigrate, createDb, type DbAdapterConfig, type DbContext } from "./db";
import { createLogger, type Logger } from "./logger";
import { createMetrics, type Metrics } from "./metrics";
import {
  eventsQuerySchema,
  heatmapQuerySchema,
  ingestSchema,
  sessionEventsQuerySchema,
  sessionsQuerySchema
} from "./validation";
import { verifyJwt, type JwtConfig } from "./jwt";

export type AuthConfig =
  | { mode: "projectKey" }
  | ({ mode: "jwt" } & JwtConfig)
  | ({ mode: "both" } & JwtConfig);

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

type EventType = "click" | "move" | "scroll" | "pageview" | "custom" | "input" | "keyboard";
type EventQueryType = "all" | EventType;
type RequestWithContext = Request & { requestId?: string; startedAtMs?: number };

type RateBucket = { count: number; resetAt: number };
type RateLimitResult = { limited: boolean; remaining: number; resetAt: number; limit: number };
type SendErrorOptions = {
  status: number;
  code: string;
  error: string;
  message: string;
  details?: unknown;
  logLevel?: "warn" | "error";
  context?: Record<string, unknown>;
  headers?: Record<string, string>;
};

const DEFAULT_LIMIT = { windowMs: 10000, max: 120 };
const HEAT_COLLECTOR_HEADER_VALUE = "heat-collector";
const HEATMAP_PLOTTABLE_TYPES = new Set<EventType>(["click", "move", "scroll"]);

const rateBuckets = new Map<string, RateBucket>();

const consumeRateLimit = (key: string, windowMs: number, max: number): RateLimitResult => {
  const now = Date.now();
  const existing = rateBuckets.get(key);

  if (!existing || now > existing.resetAt) {
    const resetAt = now + windowMs;
    rateBuckets.set(key, { count: 1, resetAt });
    return { limited: false, remaining: Math.max(0, max - 1), resetAt, limit: max };
  }

  existing.count += 1;
  const limited = existing.count > max;
  return {
    limited,
    remaining: Math.max(0, max - existing.count),
    resetAt: existing.resetAt,
    limit: max
  };
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

const toViewportBucket = (w: number, h: number) => {
  const bw = Math.round(w / 100) * 100;
  const bh = Math.round(h / 100) * 100;
  return `${bw}x${bh}`;
};

const sanitizeEventMeta = (meta: any) => {
  if (!meta || typeof meta !== "object") return undefined;
  const clone = { ...meta };
  delete clone.value;
  delete clone.text;
  delete clone.content;
  return clone;
};

const isMongo = (ctx: DbContext) => ctx.dialect === "mongodb";

const resolveRequestId = (req: Request) => {
  return (req as RequestWithContext).requestId || "unknown";
};

const setBaseResponseHeaders = (res: Response, rid: string) => {
  res.setHeader("X-Request-Id", rid);
  res.setHeader("X-Heat-Collector", HEAT_COLLECTOR_HEADER_VALUE);
  res.setHeader("X-Content-Type-Options", "nosniff");
};

const sendError = (logger: Logger, req: Request, res: Response, options: SendErrorOptions) => {
  const rid = resolveRequestId(req);
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      res.setHeader(key, value);
    }
  }

  const payload = {
    error: options.error,
    code: options.code,
    message: options.message,
    requestId: rid,
    ...(options.details !== undefined ? { details: options.details } : {})
  };

  const level = options.logLevel || "warn";
  const context = {
    requestId: rid,
    status: options.status,
    code: options.code,
    ...(options.context || {}),
    ...(options.details !== undefined ? { details: options.details } : {})
  };

  if (level === "error") {
    logger.error(options.message, context);
  } else {
    logger.warn(options.message, context);
  }

  return res.status(options.status).json(payload);
};

const markNoStore = (res: Response) => {
  res.setHeader("Cache-Control", "no-store");
};

const safeParseMetaJson = (value: unknown) => {
  if (!value) return {} as Record<string, unknown>;
  if (typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string") return {} as Record<string, unknown>;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const pickBucketFromMeta = (meta: Record<string, unknown>) => {
  const nestedMeta = meta.meta as Record<string, unknown> | undefined;
  const explicit = typeof nestedMeta?.viewportBucket === "string" ? nestedMeta.viewportBucket : undefined;
  if (explicit && parseViewportBucket(explicit)) {
    return explicit;
  }

  const viewport = meta.viewport as Record<string, unknown> | undefined;
  const w = Number(viewport?.w);
  const h = Number(viewport?.h);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return toViewportBucket(w, h);
  }

  return undefined;
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

  router.use((req, res, next) => {
    const rid = requestId();
    const ctxReq = req as RequestWithContext;
    ctxReq.requestId = rid;
    ctxReq.startedAtMs = Date.now();
    setBaseResponseHeaders(res, rid);
    next();
  });

  router.use((req, res, next) => {
    res.on("finish", () => {
      const ctxReq = req as RequestWithContext;
      const startedAt = ctxReq.startedAtMs ?? Date.now();
      const durationMs = Date.now() - startedAt;
      const payload = {
        requestId: resolveRequestId(req),
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs
      };

      if (res.statusCode >= 500) {
        logger.error("request failed", payload);
        return;
      }
      if (res.statusCode >= 400) {
        logger.warn("request failed", payload);
        return;
      }
      logger.info("request completed", payload);
    });

    next();
  });

  ingestRouter.post("/ingest", async (req, res) => {
    const started = Date.now();
    const rid = resolveRequestId(req);
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const projectKey = req.header("x-project-key");

    if (!projectKey) {
      return sendError(logger, req, res, {
        status: 401,
        code: "missing_project_key",
        error: "missing project key",
        message: "Request rejected because header x-project-key is required.",
        context: { ip }
      });
    }

    const limitStatus = consumeRateLimit(`${projectKey}:${ip}`, limiter.windowMs, limiter.max);
    res.setHeader("X-RateLimit-Limit", String(limitStatus.limit));
    res.setHeader("X-RateLimit-Remaining", String(limitStatus.remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(limitStatus.resetAt / 1000)));

    if (limitStatus.limited) {
      const retryAfterSeconds = Math.max(1, Math.ceil((limitStatus.resetAt - Date.now()) / 1000));
      return sendError(logger, req, res, {
        status: 429,
        code: "rate_limited",
        error: "rate limit exceeded",
        message: "Too many ingest requests for this project key and IP in the current window.",
        headers: { "Retry-After": String(retryAfterSeconds) },
        context: { projectKey, ip, retryAfterSeconds, windowMs: limiter.windowMs, max: limiter.max }
      });
    }

    const token = req.header("authorization")?.replace(/^Bearer /i, "");
    let jwtSub: string | undefined;
    try {
      if (config.auth.mode === "jwt" || config.auth.mode === "both") {
        if (!token) {
          if (config.auth.mode === "jwt") {
            return sendError(logger, req, res, {
              status: 401,
              code: "missing_jwt",
              error: "missing jwt",
              message: "Request rejected because Authorization: Bearer <jwt> is required.",
              context: { projectKey }
            });
          }
        } else {
          const payload = await verifyJwt(token, config.auth);
          jwtSub = payload.sub;
        }
      }
    } catch (err: any) {
      return sendError(logger, req, res, {
        status: 401,
        code: "invalid_jwt",
        error: "invalid jwt",
        message: "JWT validation failed.",
        context: { projectKey, error: err }
      });
    }

    const parseResult = ingestSchema.safeParse(req.body);
    if (!parseResult.success) {
      metrics.rejectedEventCount += 1;
      return sendError(logger, req, res, {
        status: 400,
        code: "invalid_payload",
        error: "invalid payload",
        message: "Request body did not match the expected ingestion schema.",
        details: parseResult.error.flatten(),
        context: { projectKey }
      });
    }

    let payload = parseResult.data;

    try {
      if (config.hooks?.onBeforeInsert) {
        payload = await config.hooks.onBeforeInsert(payload);
      }

      const { projectId, userId } = await ensureProjectAndUser(dbContext, projectKey, payload, jwtSub);
      await upsertSession(dbContext, projectId, userId, payload, req);
      await insertEvents(dbContext, projectId, userId, payload);

      metrics.ingestCount += 1;
      metrics.lastIngestMs = Date.now() - started;

      markNoStore(res);
      res.setHeader("X-Ingested-Events", String(payload.events.length));

      logger.info("ingest success", {
        requestId: rid,
        projectId,
        sessionId: payload.session.id,
        ingestedEvents: payload.events.length,
        durationMs: Date.now() - started
      });

      return res.status(200).json({
        ok: true,
        requestId: rid,
        projectId,
        sessionId: payload.session.id
      });
    } catch (err: any) {
      metrics.ingestErrorCount += 1;
      return sendError(logger, req, res, {
        status: 500,
        code: "ingest_failed",
        error: "ingest failed",
        message: "Unexpected error while persisting ingestion payload.",
        logLevel: "error",
        context: { projectKey, error: err, durationMs: Date.now() - started }
      });
    }
  });

  apiRouter.get("/api/projects/:projectId/heatmap", async (req, res) => {
    const parseResult = heatmapQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return sendError(logger, req, res, {
        status: 400,
        code: "invalid_query",
        error: "invalid query",
        message: "Invalid heatmap query parameters.",
        details: parseResult.error.flatten()
      });
    }

    const query = parseResult.data;
    const projectId = req.params.projectId;

    const fromValue = parseTime(query.from);
    if (query.from && fromValue === undefined) {
      return sendError(logger, req, res, {
        status: 400,
        code: "invalid_from",
        error: "invalid query",
        message: "Query param 'from' must be a unix timestamp in milliseconds or a valid date string."
      });
    }

    const toValue = parseTime(query.to);
    if (query.to && toValue === undefined) {
      return sendError(logger, req, res, {
        status: 400,
        code: "invalid_to",
        error: "invalid query",
        message: "Query param 'to' must be a unix timestamp in milliseconds or a valid date string."
      });
    }

    const from = fromValue ?? 0;
    const to = toValue ?? Date.now();

    if (from > to) {
      return sendError(logger, req, res, {
        status: 400,
        code: "invalid_time_range",
        error: "invalid query",
        message: "Query param 'from' must be less than or equal to 'to'.",
        context: { from, to }
      });
    }

    const requestedType = (query.type ?? "click") as EventQueryType;

    try {
      let resolvedType = requestedType;
      let rows = await queryEvents(dbContext, projectId, requestedType, query.path, from, to);

      if (!query.type && rows.length === 0) {
        const fallbackRows = await queryEvents(dbContext, projectId, "all", query.path, from, to);
        if (fallbackRows.length > 0) {
          rows = fallbackRows;
          resolvedType = "all";
        }
      }

      const result = buildHeatmap(rows, query.resolution, query.viewportBucket, requestedType, resolvedType);

      markNoStore(res);
      res.setHeader("X-Result-Count", String(result.meta.total));
      res.setHeader("X-Heatmap-Point-Count", String(result.points.length));
      res.setHeader("X-Requested-Type", requestedType);
      res.setHeader("X-Resolved-Type", resolvedType);

      logger.info("heatmap query success", {
        requestId: resolveRequestId(req),
        projectId,
        requestedType,
        resolvedType,
        from,
        to,
        path: query.path,
        matchedEvents: result.meta.total,
        plottedEvents: result.meta.plotted
      });

      return res.json(result);
    } catch (err: any) {
      return sendError(logger, req, res, {
        status: 500,
        code: "heatmap_query_failed",
        error: "heatmap query failed",
        message: "Unexpected error while querying heatmap data.",
        logLevel: "error",
        context: {
          projectId,
          requestedType,
          path: query.path,
          from,
          to,
          error: err
        }
      });
    }
  });

  apiRouter.get("/api/projects/:projectId/events", async (req, res) => {
    const parseResult = eventsQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return sendError(logger, req, res, {
        status: 400,
        code: "invalid_query",
        error: "invalid query",
        message: "Invalid events query parameters.",
        details: parseResult.error.flatten()
      });
    }

    const query = parseResult.data;
    const projectId = req.params.projectId;

    const fromValue = parseTime(query.from);
    if (query.from && fromValue === undefined) {
      return sendError(logger, req, res, {
        status: 400,
        code: "invalid_from",
        error: "invalid query",
        message: "Query param 'from' must be a unix timestamp in milliseconds or a valid date string."
      });
    }

    const toValue = parseTime(query.to);
    if (query.to && toValue === undefined) {
      return sendError(logger, req, res, {
        status: 400,
        code: "invalid_to",
        error: "invalid query",
        message: "Query param 'to' must be a unix timestamp in milliseconds or a valid date string."
      });
    }

    const type = (query.type ?? "all") as EventQueryType;

    if (fromValue !== undefined && toValue !== undefined && fromValue > toValue) {
      return sendError(logger, req, res, {
        status: 400,
        code: "invalid_time_range",
        error: "invalid query",
        message: "Query param 'from' must be less than or equal to 'to'.",
        context: { from: fromValue, to: toValue }
      });
    }

    try {
      const events = await listProjectEvents(dbContext, projectId, {
        limit: query.limit,
        offset: query.offset,
        path: query.path,
        type,
        from: fromValue,
        to: toValue
      });

      markNoStore(res);
      res.setHeader("X-Total-Count", String(events.length));
      res.setHeader("X-Requested-Type", type);

      return res.json({
        events,
        meta: {
          count: events.length,
          limit: query.limit,
          offset: query.offset,
          projectId,
          requestedType: type
        }
      });
    } catch (err: any) {
      return sendError(logger, req, res, {
        status: 500,
        code: "events_query_failed",
        error: "events query failed",
        message: "Unexpected error while querying project events.",
        logLevel: "error",
        context: {
          projectId,
          requestedType: type,
          path: query.path,
          limit: query.limit,
          offset: query.offset,
          from: fromValue,
          to: toValue,
          error: err
        }
      });
    }
  });

  apiRouter.get("/api/projects/:projectId/sessions", async (req, res) => {
    const parseResult = sessionsQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return sendError(logger, req, res, {
        status: 400,
        code: "invalid_query",
        error: "invalid query",
        message: "Invalid sessions query parameters.",
        details: parseResult.error.flatten()
      });
    }

    const query = parseResult.data;
    const projectId = req.params.projectId;

    const from = parseTime(query.from);
    if (query.from && from === undefined) {
      return sendError(logger, req, res, {
        status: 400,
        code: "invalid_from",
        error: "invalid query",
        message: "Query param 'from' must be a unix timestamp in milliseconds or a valid date string."
      });
    }

    const to = parseTime(query.to);
    if (query.to && to === undefined) {
      return sendError(logger, req, res, {
        status: 400,
        code: "invalid_to",
        error: "invalid query",
        message: "Query param 'to' must be a unix timestamp in milliseconds or a valid date string."
      });
    }

    if (from !== undefined && to !== undefined && from > to) {
      return sendError(logger, req, res, {
        status: 400,
        code: "invalid_time_range",
        error: "invalid query",
        message: "Query param 'from' must be less than or equal to 'to'.",
        context: { from, to }
      });
    }

    try {
      const sessions = await listSessions(dbContext, projectId, query, from, to);

      markNoStore(res);
      res.setHeader("X-Total-Count", String(sessions.length));

      return res.json({
        sessions,
        meta: {
          count: sessions.length,
          limit: query.limit,
          offset: query.offset,
          projectId
        }
      });
    } catch (err: any) {
      return sendError(logger, req, res, {
        status: 500,
        code: "sessions_query_failed",
        error: "sessions query failed",
        message: "Unexpected error while querying sessions.",
        logLevel: "error",
        context: { projectId, query, error: err }
      });
    }
  });

  apiRouter.get("/api/sessions/:sessionId", async (req, res) => {
    const parseResult = sessionEventsQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return sendError(logger, req, res, {
        status: 400,
        code: "invalid_query",
        error: "invalid query",
        message: "Invalid session events query parameters.",
        details: parseResult.error.flatten()
      });
    }

    const query = parseResult.data;
    const sessionId = req.params.sessionId;

    try {
      const detail = await getSessionDetail(dbContext, sessionId, query);

      markNoStore(res);
      res.setHeader("X-Session-Found", detail.session ? "1" : "0");
      res.setHeader("X-Total-Count", String(detail.events.length));

      return res.json({
        ...detail,
        meta: {
          found: Boolean(detail.session),
          count: detail.events.length,
          limit: query.limit,
          offset: query.offset
        }
      });
    } catch (err: any) {
      return sendError(logger, req, res, {
        status: 500,
        code: "session_detail_failed",
        error: "session detail failed",
        message: "Unexpected error while querying session detail.",
        logLevel: "error",
        context: { sessionId, query, error: err }
      });
    }
  });

  apiRouter.get("/api/metrics", (req, res) => {
    markNoStore(res);
    return res.status(200).json({
      metrics,
      requestId: resolveRequestId(req),
      now: Date.now()
    });
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

  if (isMongo(ctx)) {
    const projects = ctx.db.collection("projects");
    const users = ctx.db.collection("users");

    let project = await projects.findOne({ key: projectKey });
    if (!project) {
      const projectId = crypto.randomUUID();
      await projects.insertOne({ id: projectId, key: projectKey, name: "Default", createdAt: now });
      project = { id: projectId };
    }

    const projectId = typeof project.id === "string" && project.id ? project.id : String(project._id || "");
    if (!projectId) {
      throw new Error("Project id is missing in MongoDB project document");
    }

    const externalId = jwtSub ?? payload.user?.id;
    if (!externalId) {
      return { projectId };
    }

    let user = await users.findOne({ projectId, externalId });
    if (!user) {
      const userId = crypto.randomUUID();
      await users.insertOne({
        id: userId,
        projectId,
        externalId,
        traitsJson: payload.user?.traits ? JSON.stringify(payload.user.traits) : null,
        createdAt: now
      });
      user = { id: userId };
    }

    const userId = typeof user.id === "string" && user.id ? user.id : String(user._id || "");
    return userId ? { projectId, userId } : { projectId };
  }

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
  const now = Date.now();
  const sessionId = payload.session.id;

  if (isMongo(ctx)) {
    const sessions = ctx.db.collection("sessions");
    const existing = await sessions.findOne({ id: sessionId });

    if (!existing) {
      await sessions.insertOne({
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
      return;
    }

    await sessions.updateOne(
      { id: sessionId },
      {
        $set: {
          lastSeenAt: payload.session.lastSeenAt ?? now,
          userId: userId ?? existing.userId
        }
      }
    );
    return;
  }

  const { sessions } = ctx.schema as any;
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

  if (isMongo(ctx)) {
    await ctx.db.collection("events").insertMany(rows, { ordered: true });
    return;
  }

  const { events } = ctx.schema as any;
  await ctx.db.insert(events).values(rows);
};

const queryEvents = async (
  ctx: DbContext,
  projectId: string,
  type: EventQueryType,
  path: string | undefined,
  from: number,
  to: number
) => {
  if (isMongo(ctx)) {
    const filter: any = { projectId, ts: { $gte: from, $lte: to } };
    if (type !== "all") filter.type = type;
    if (path) filter.path = path;
    return ctx.db.collection("events").find(filter).toArray();
  }

  const { events } = ctx.schema as any;
  const filters = [eq(events.projectId, projectId), gte(events.ts, from), lte(events.ts, to)];
  if (type !== "all") filters.push(eq(events.type, type));
  if (path) filters.push(eq(events.path, path));
  const where = and(...filters);
  return ctx.db.select().from(events).where(where);
};

const listProjectEvents = async (
  ctx: DbContext,
  projectId: string,
  query: {
    limit: number;
    offset: number;
    path?: string;
    type?: EventQueryType;
    from?: number;
    to?: number;
  }
) => {
  if (isMongo(ctx)) {
    const filter: any = { projectId };

    if (query.type && query.type !== "all") {
      filter.type = query.type;
    }
    if (query.path) {
      filter.path = query.path;
    }
    if (query.from !== undefined || query.to !== undefined) {
      filter.ts = {
        ...(query.from !== undefined ? { $gte: query.from } : {}),
        ...(query.to !== undefined ? { $lte: query.to } : {})
      };
    }

    return ctx.db
      .collection("events")
      .find(filter)
      .sort({ ts: 1 })
      .skip(query.offset)
      .limit(query.limit)
      .toArray();
  }

  const { events } = ctx.schema as any;
  const filters = [eq(events.projectId, projectId)];

  if (query.type && query.type !== "all") {
    filters.push(eq(events.type, query.type));
  }
  if (query.path) {
    filters.push(eq(events.path, query.path));
  }
  if (query.from !== undefined) {
    filters.push(gte(events.ts, query.from));
  }
  if (query.to !== undefined) {
    filters.push(lte(events.ts, query.to));
  }

  const where = and(...filters);

  return ctx.db
    .select()
    .from(events)
    .where(where)
    .orderBy(events.ts)
    .limit(query.limit)
    .offset(query.offset);
};

const buildHeatmap = (
  rows: any[],
  resolution: number,
  viewportBucket: string | undefined,
  requestedType: EventQueryType,
  resolvedType: EventQueryType
) => {
  const buckets: Record<string, number> = {};
  const bucketCounts: Record<string, number> = {};
  const typeBreakdown: Record<string, number> = {};
  let plotted = 0;

  for (const row of rows) {
    const rowType = typeof row.type === "string" ? row.type : "unknown";
    typeBreakdown[rowType] = (typeBreakdown[rowType] || 0) + 1;

    const meta = safeParseMetaJson(row.metaJson);
    const bucket = pickBucketFromMeta(meta);
    if (bucket) {
      bucketCounts[bucket] = (bucketCounts[bucket] || 0) + 1;
    }
  }

  const preferredBucket = viewportBucket || Object.entries(bucketCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const viewport = parseViewportBucket(preferredBucket) || { w: 1280, h: 720 };

  const bucketWidth = viewport.w / resolution;
  const bucketHeight = viewport.h / resolution;

  for (const row of rows) {
    let x = Number(row.x);
    let y = Number(row.y);

    if (row.type === "scroll" && row.scrollDepth != null) {
      const pct = Number(row.scrollDepth) / 100;
      x = 0;
      y = Math.round((pct / 100) * viewport.h);
    }

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }

    const bx = Math.min(resolution - 1, Math.max(0, Math.floor(x / bucketWidth)));
    const by = Math.min(resolution - 1, Math.max(0, Math.floor(y / bucketHeight)));
    const key = `${bx}:${by}`;
    buckets[key] = (buckets[key] || 0) + 1;
    plotted += 1;
  }

  const points = Object.entries(buckets).map(([key, value]) => {
    const [bx, by] = key.split(":").map((n) => Number(n));
    return {
      x: Math.round((bx + 0.5) * bucketWidth),
      y: Math.round((by + 0.5) * bucketHeight),
      value
    };
  });

  const ignored = Math.max(0, rows.length - plotted);
  const warning =
    rows.length > 0 && plotted === 0
      ? "Events matched the filter but none are plottable. Use type=click|move|scroll or inspect /api/projects/:projectId/events."
      : undefined;

  return {
    points,
    meta: {
      resolution,
      viewport,
      total: rows.length,
      plotted,
      ignored,
      requestedType,
      resolvedType,
      bucket: preferredBucket || `${viewport.w}x${viewport.h}`,
      plottableTypes: Array.from(HEATMAP_PLOTTABLE_TYPES),
      typeBreakdown,
      ...(warning ? { warning } : {})
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
  if (isMongo(ctx)) {
    const sessionFilter: any = { projectId };
    if (query.userId) sessionFilter.userId = query.userId;
    if (from !== undefined) {
      sessionFilter.startedAt = { ...(sessionFilter.startedAt || {}), $gte: from };
    }
    if (to !== undefined) {
      sessionFilter.lastSeenAt = { ...(sessionFilter.lastSeenAt || {}), $lte: to };
    }

    const sessions = await ctx.db
      .collection("sessions")
      .find(sessionFilter)
      .sort({ startedAt: 1 })
      .skip(query.offset)
      .limit(query.limit)
      .toArray();

    const rows = await Promise.all(
      sessions.map(async (session: any) => ({
        sessionId: session.id,
        userId: session.userId,
        startedAt: session.startedAt,
        lastSeenAt: session.lastSeenAt,
        firstPath: session.firstPath,
        eventCount: await ctx.db.collection("events").countDocuments({ sessionId: session.id })
      }))
    );

    if (query.path) {
      return rows.filter((row: any) => row.firstPath === query.path);
    }

    return rows;
  }

  const { sessions, events } = ctx.schema as any;
  const filters = [eq(sessions.projectId, projectId)];
  if (query.userId) filters.push(eq(sessions.userId, query.userId));
  if (from !== undefined) filters.push(gte(sessions.startedAt, from));
  if (to !== undefined) filters.push(lte(sessions.lastSeenAt, to));

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
  if (isMongo(ctx)) {
    const session = await ctx.db.collection("sessions").findOne({ id: sessionId });
    if (!session) {
      return { session: null, events: [] };
    }

    const filter: any = { sessionId };
    if (query.type) filter.type = query.type;

    const events = await ctx.db
      .collection("events")
      .find(filter)
      .sort({ ts: 1 })
      .skip(query.offset)
      .limit(query.limit)
      .toArray();

    return { session, events };
  }

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
