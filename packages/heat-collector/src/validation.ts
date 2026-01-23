import { z } from "zod";

export const viewportSchema = z.object({
  w: z.number(),
  h: z.number(),
  dpr: z.number().optional()
});

export const deviceSchema = z.object({
  ua: z.string().optional(),
  platform: z.string().optional(),
  language: z.string().optional()
});

const baseEventSchema = z.object({
  eventId: z.string(),
  sessionId: z.string(),
  ts: z.number(),
  path: z.string(),
  viewport: viewportSchema,
  device: deviceSchema,
  meta: z.record(z.any()).optional()
});

const clickEventSchema = baseEventSchema.extend({
  type: z.literal("click"),
  x: z.number(),
  y: z.number(),
  selector: z.string().optional(),
  button: z.number().optional()
});

const moveEventSchema = baseEventSchema.extend({
  type: z.literal("move"),
  points: z.array(
    z.object({
      x: z.number(),
      y: z.number(),
      tsOffset: z.number()
    })
  )
});

const scrollEventSchema = baseEventSchema.extend({
  type: z.literal("scroll"),
  scrollY: z.number(),
  scrollDepthPct: z.number()
});

const pageviewEventSchema = baseEventSchema.extend({
  type: z.literal("pageview"),
  from: z.string().optional(),
  to: z.string()
});

const customEventSchema = baseEventSchema.extend({
  type: z.literal("custom"),
  name: z.string(),
  props: z.record(z.any()).optional()
});

const inputEventSchema = baseEventSchema.extend({
  type: z.literal("input"),
  action: z.enum(["focus", "blur", "change"]),
  selector: z.string().optional(),
  inputType: z.string().optional(),
  length: z.number().optional(),
  masked: z.string().optional()
});

const keyboardEventSchema = baseEventSchema.extend({
  type: z.literal("keyboard"),
  category: z.enum(["navigation", "editing", "modifier", "system", "other"])
});

export const eventSchema = z.discriminatedUnion("type", [
  clickEventSchema,
  moveEventSchema,
  scrollEventSchema,
  pageviewEventSchema,
  customEventSchema,
  inputEventSchema,
  keyboardEventSchema
]);

export const ingestSchema = z.object({
  sdk: z
    .object({
      name: z.string().optional(),
      version: z.string().optional()
    })
    .optional(),
  app: z
    .object({
      name: z.string().optional(),
      version: z.string().optional(),
      env: z.string().optional()
    })
    .optional(),
  session: z.object({
    id: z.string(),
    startedAt: z.number().optional(),
    lastSeenAt: z.number().optional()
  }),
  user: z
    .object({
      id: z.string(),
      traits: z.record(z.any()).optional()
    })
    .optional(),
  events: z.array(eventSchema).min(1)
});

export const heatmapQuerySchema = z.object({
  path: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  type: z.enum(["click", "move", "scroll"]).optional(),
  resolution: z.coerce.number().int().optional().default(128),
  viewportBucket: z.string().optional()
});

export const sessionsQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  userId: z.string().optional(),
  path: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0)
});

export const sessionEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional().default(200),
  offset: z.coerce.number().int().min(0).optional().default(0),
  type: z.string().optional()
});

export type IngestPayload = z.infer<typeof ingestSchema>;
