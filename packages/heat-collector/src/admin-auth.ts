import crypto from "crypto";
import type { RequestHandler } from "express";
import { QUERY_ERRORS } from "@m-software-engineering/heat-errors";
import { sendError } from "./http-errors";
import type { Logger } from "./logger";

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest();

/** Constant-time comparison on fixed-length digests, so token length does not leak. */
export const adminTokenMatches = (expected: string, received: string) =>
  crypto.timingSafeEqual(sha256(expected), sha256(received));

/**
 * Guards the read API with `Authorization: Bearer <admin token>`. Ingest and `/healthz` are
 * mounted on other routers and never pass through this.
 */
export const requireAdminToken =
  (logger: Logger, token: string): RequestHandler =>
  (req, res, next) => {
    const header = req.header("authorization");
    const value = header?.trim() ?? "";
    // String ops instead of a regex: the header is attacker-controlled (no backtracking).
    const received = value.slice(0, 7).toLowerCase() === "bearer " ? value.slice(7).trim() : "";
    if (!received) {
      sendError(
        logger,
        req,
        res,
        QUERY_ERRORS.HEAT_E_ADMIN_TOKEN_MISSING,
        header ? "header Authorization is not of the form Bearer <token>" : "header Authorization is missing"
      );
      return;
    }
    if (!adminTokenMatches(token, received)) {
      sendError(logger, req, res, QUERY_ERRORS.HEAT_E_ADMIN_TOKEN_INVALID, "the Bearer token does not match");
      return;
    }
    next();
  };
