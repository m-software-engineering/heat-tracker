import { createHash } from "node:crypto";

/**
 * Stable events.id from (project, client eventId[, move point index]).
 * SHA-256 hex fits VARCHAR(64). JSON tuple encoding avoids delimiter collisions.
 */
export const eventRowId = (projectId: string, eventId: string, pointIndex?: number) =>
  createHash("sha256")
    .update(JSON.stringify([projectId, eventId, pointIndex ?? null]))
    .digest("hex");
