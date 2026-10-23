/* eslint-disable @typescript-eslint/no-explicit-any */

import { HeatTrackerError, SDK_ERRORS } from "@m-software-engineering/heat-errors";
import { KEEPALIVE_MAX_BODY_BYTES, exitBudget, onPageExit, utf8Bytes } from "./page-exit";
import { announceToParentFrame } from "./frame-handshake";
import {
  createErrorReporter,
  eventsDroppedError,
  ingestHttpError,
  ingestNetworkError,
  type ReportError
} from "./errors";
import { pagePath, pageTitle } from "./page-info";

export type { HeatError, HeatErrorCode } from "@m-software-engineering/heat-errors";
export { HeatTrackerError, isHeatError } from "@m-software-engineering/heat-errors";

import {
  loadSession,
  SDK_NAME,
  SDK_VERSION,
  getBrowserStorage,
  writeStorage,
  stableHash,
  safeNow,
  randomId,
  getViewport,
  getDevice,
  elementSelector,
  isSensitiveInput,
  matchesAny,
  inputLength,
  classifyKey,
  computeScrollDepth,
  eventPagePoint,
  ensureConfig,
  addHistoryListener,
  removeHistoryListener,
  type InitConfig,
  type Tracker,
  type ResolvedConfig,
  type AnyEvent,
  type StorageLike,
  type EventBase,
  type CustomEvent,
  type MoveEvent,
  type PageviewEvent,
  type ClickEvent,
  type ScrollEvent,
  type InputEventPayload,
  type KeyboardEventPayload
} from "./runtime";
export type { InitConfig, Tracker } from "./runtime";

class TrackerImpl implements Tracker {
  private config: ResolvedConfig;
  private reportError: ReportError;
  private sessionId: string;
  private startedAt: number;
  private lastSeenAt: number;
  private userId?: string;
  private userTraits?: Record<string, any>;
  private authToken: string | null = null;
  private queue: AnyEvent[] = [];
  private inFlight = new Set<AnyEvent>();
  private exitSent = new WeakSet<AnyEvent>();
  private movePoints: Array<{ x: number; y: number; tsOffset: number }> = [];
  private moveBaseTs = 0;
  private flushTimer?: number;
  private retryTimer?: number;
  private backoffMs = 0;
  private stopped = false;
  private flushing?: Promise<void>;
  private moveAt = 0;
  private scrollAt = 0;
  private currentPath: string;
  private lastTitle?: string;
  private sessionStore: StorageLike;
  private detachPageExit?: () => void;

  constructor(config: ResolvedConfig) {
    this.config = config;
    this.currentPath = this.path();
    this.reportError = createErrorReporter(config);
    this.sessionStore = getBrowserStorage(
      this.config.session.persist === "browser" ? "localStorage" : "sessionStorage"
    );
    const session = loadSession(this.sessionStore, this.storageKey("session"), this.config.session.idleTimeoutMs);
    this.sessionId = session.id;
    this.startedAt = session.startedAt;
    this.lastSeenAt = session.lastSeenAt;
    this.restoreQueue();
    const restored = this.queue.length > 0;

    this.attachListeners();
    this.detachPageExit = onPageExit(this.flushOnExit);
    this.flushTimer = window.setInterval(() => {
      void this.flush();
    }, this.config.batch.flushIntervalMs);

    if (this.config.capture.pageview) {
      this.pageview(undefined, this.currentPath);
    }
    if (restored) void this.flush();
  }

  identify(userId: string, traits?: Record<string, any>) {
    this.userId = userId;
    this.userTraits = traits;
  }

  setAuthToken(jwt: string | null) {
    this.authToken = jwt;
  }

  track(name: string, props?: Record<string, any>) {
    const base = this.baseEvent();
    const evt: CustomEvent = {
      ...base,
      type: "custom",
      name,
      props
    };
    this.enqueue(evt);
  }

  async flush() {
    if (this.stopped) return;
    if (this.flushing) {
      await this.flushing;
      return;
    }

    this.flushing = this.flushInternal();
    try {
      await this.flushing;
    } finally {
      this.flushing = undefined;
    }
  }

  async shutdown() {
    await this.flush();
    this.stopped = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    this.detachListeners();
    this.detachPageExit?.();
  }

  /**
   * Page hidden or unloading: start every pending batch now, synchronously, with fetch keepalive
   * (survives the unload; keeps the project-key/auth headers), ignoring the retry backoff. Events of
   * a batch that fails stay queued (and persisted) for the next flush or page load.
   */
  private flushOnExit = (reason: "hidden" | "pagehide") => {
    if (this.stopped) return;
    this.enqueueMove();
    const pending = this.queue.length;
    // Failed exit sends may have requeued; only a later ordinary flush retries those events.
    const deferred = this.queue.filter((event) => this.exitSent.has(event));
    this.queue = this.queue.filter((event) => !this.exitSent.has(event));
    while (this.queue.length > 0) {
      if (this.exitSent.has(this.queue[0])) {
        deferred.push(this.queue.shift()!);
        continue;
      }
      const next = this.takeBatch(exitBudget.remaining);
      if (next.bytes > KEEPALIVE_MAX_BODY_BYTES) {
        deferred.push(...next.batch);
        continue;
      }
      if (next.bytes > exitBudget.remaining) {
        this.queue.unshift(...next.batch);
        break;
      }
      void this.sendBatch(true, next);
    }
    this.queue.unshift(...deferred);
    const sent = pending - this.queue.length;
    if (!this.persistQueue()) this.dropQueue("exit budget exhausted and queue persistence unavailable");
    if (this.config.debug && pending > 0) {
      // eslint-disable-next-line no-console -- debug-only, once per exit (#28)
      console.info(`heat-sdk: flushed ${sent}/${pending} events via fetch keepalive on ${reason}`);
    }
  };

  private async flushInternal() {
    this.enqueueMove();

    while (this.queue.length > 0) {
      const sent = await this.sendBatch();
      if (!sent) return;
    }
  }

  private enqueue(event: AnyEvent, autoFlush = true) {
    this.queue.push(event);
    this.trimQueue();
    this.persistQueue();
    if (autoFlush && this.queue.length >= this.config.batch.maxEvents) {
      void this.flush();
    }
  }

  private trimQueue() {
    const maxBytes = this.config.batch.maxQueueBytes;
    if (!maxBytes) return;
    let dropped = 0;
    let size = this.queueSize();
    while (this.queue.length > 0 && size > maxBytes) {
      this.queue.shift();
      dropped += 1;
      size = this.queueSize();
    }
    if (dropped) this.reportError(eventsDroppedError(dropped, "batch.maxQueueBytes exceeded"));
  }

  private queueSize() {
    try {
      return JSON.stringify(this.queue).length;
    } catch {
      return this.queue.length * 200;
    }
  }

  private enqueueMove() {
    if (this.movePoints.length === 0) return;
    const base = this.baseEvent(this.moveBaseTs || safeNow());
    const evt: MoveEvent = {
      ...base,
      type: "move",
      points: [...this.movePoints]
    };
    this.movePoints = [];
    this.moveBaseTs = 0;
    this.enqueue(evt, false);
  }

  /** Splices the longest queue prefix whose request body fits `limit` UTF-8 bytes (at least one event). */
  private takeBatch(limit: number) {
    const payload = {
      sdk: { name: SDK_NAME, version: SDK_VERSION },
      app: this.config.app,
      session: { id: this.sessionId, startedAt: this.startedAt, lastSeenAt: this.lastSeenAt },
      user: this.userId ? { id: this.userId, traits: this.userTraits } : undefined,
      events: [] as AnyEvent[]
    };
    let bytes = utf8Bytes(payload);
    let n = 0;
    for (const event of this.queue.slice(0, this.config.batch.maxEvents)) {
      const size = utf8Bytes(event) + (n && 1);
      if (n && bytes + size > limit) break;
      bytes += size;
      n += 1;
    }
    payload.events = this.queue.splice(0, n);
    return { batch: payload.events, body: JSON.stringify(payload), bytes };
  }

  private async sendBatch(force = false, taken?: ReturnType<TrackerImpl["takeBatch"]>) {
    if (!taken && this.queue.length === 0) return true;
    if (!force && this.backoffMs > 0 && this.retryTimer) return false;

    const { batch, body, bytes } = taken ?? this.takeBatch(KEEPALIVE_MAX_BODY_BYTES);
    const keepalive = bytes <= exitBudget.remaining;
    if (keepalive) exitBudget.remaining -= bytes;
    for (const event of batch) {
      this.inFlight.add(event);
      if (force) this.exitSent.add(event);
    }
    this.persistQueue();
    try {
      const res = await fetch(this.config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-project-key": this.config.projectKey,
          ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {})
        },
        body,
        keepalive
      });

      if (!res.ok) {
        this.reportError(await ingestHttpError(res));
        this.requeue(batch, force);
        return false;
      }
      this.backoffMs = 0;
      for (const event of batch) this.inFlight.delete(event);
      this.persistQueue();
      return true;
    } catch (err) {
      this.reportError(ingestNetworkError(err));
      this.requeue(batch, force);
      return false;
    }
  }

  private requeue(batch: AnyEvent[], exiting: boolean) {
    for (const event of batch) this.inFlight.delete(event);
    this.queue = [...batch, ...this.queue];
    if (!this.persistQueue() && exiting) this.dropQueue("exit request failed and queue persistence unavailable");
    this.scheduleRetry();
  }

  private scheduleRetry() {
    if (this.retryTimer) return;
    this.backoffMs = this.backoffMs === 0 ? 1000 : Math.min(this.backoffMs * 2, 30000);
    const jitter = Math.floor(Math.random() * 300);
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = undefined;
      void this.flush();
    }, this.backoffMs + jitter);
  }

  private baseEvent(ts = safeNow()): EventBase {
    this.lastSeenAt = ts;
    this.persistSession();
    return {
      eventId: randomId(),
      sessionId: this.sessionId,
      ts,
      path: this.path(),
      viewport: getViewport(),
      device: getDevice(),
      meta: {
        viewportBucket: this.bucket()
      }
    };
  }

  private bucket() {
    const { w, h } = getViewport();
    const bw = Math.round(w / 100) * 100;
    const bh = Math.round(h / 100) * 100;
    return `${bw}x${bh}`;
  }

  private shouldCapture(el: Element | null, allow?: string[]) {
    if (!el) return false;
    const blockSelectors = this.config.privacy.blockSelectors;
    if (matchesAny(el, blockSelectors)) return false;
    if (this.config.privacy.allowSelectors.length > 0) {
      return matchesAny(el, this.config.privacy.allowSelectors);
    }
    if (allow && allow.length > 0) {
      return matchesAny(el, allow);
    }
    return true;
  }

  private attachListeners() {
    const { capture } = this.config;
    if (capture.click) {
      window.addEventListener("click", this.handleClick, true);
    }
    if (capture.move?.enabled) {
      window.addEventListener("mousemove", this.handleMove, true);
    }
    if (capture.scroll) {
      window.addEventListener("scroll", this.handleScroll, { passive: true });
    }
    if (capture.pageview) {
      window.addEventListener("popstate", this.onNavigation);
      addHistoryListener(this.onNavigation);
    }
    if (capture.inputs?.enabled && capture.inputs.mode !== "off") {
      window.addEventListener("focus", this.handleInput, true);
      window.addEventListener("blur", this.handleInput, true);
      window.addEventListener("change", this.handleInput, true);
    }
    if (capture.keyboard?.enabled && capture.keyboard.mode !== "off") {
      window.addEventListener("keydown", this.handleKeyboard, true);
    }
  }

  private detachListeners() {
    window.removeEventListener("click", this.handleClick, true);
    window.removeEventListener("mousemove", this.handleMove, true);
    window.removeEventListener("scroll", this.handleScroll);
    window.removeEventListener("popstate", this.onNavigation);
    window.removeEventListener("focus", this.handleInput, true);
    window.removeEventListener("blur", this.handleInput, true);
    window.removeEventListener("change", this.handleInput, true);
    window.removeEventListener("keydown", this.handleKeyboard, true);
    removeHistoryListener(this.onNavigation);
  }

  private path() {
    return pagePath(this.config.privacy.keepQueryParams);
  }

  private onNavigation = () => {
    const nextPath = this.path();
    if (nextPath === this.currentPath) return;
    const prev = this.currentPath;
    this.currentPath = nextPath;
    this.pageview(prev, nextPath);
  };

  private pageview(from?: string, to?: string) {
    const base = this.baseEvent();
    const evt: PageviewEvent = {
      ...base,
      type: "pageview",
      from,
      to: to || this.path()
    };
    if (this.config.capture.pageTitle) {
      const title = pageTitle(this.config.privacy.maskTextSelectors);
      // SPA routers often set the new title after pushState: a title unchanged from the previous path
      // is probably the old page's, so it is not sent (the collector keeps the last real title).
      if (title && !(from !== undefined && from !== evt.to && title === this.lastTitle)) evt.title = title;
      this.lastTitle = title;
    }
    this.enqueue(evt);
  }

  private handleClick = (event: MouseEvent) => {
    const target = event.target as Element | null;
    if (!this.shouldCapture(target)) return;
    const point = eventPagePoint(event);
    const base = this.baseEvent();
    const evt: ClickEvent = {
      ...base,
      type: "click",
      x: point.x,
      y: point.y,
      selector: elementSelector(target),
      button: event.button
    };
    this.enqueue(evt);
  };

  private handleMove = (event: MouseEvent) => {
    const target = event.target as Element | null;
    if (!this.shouldCapture(target)) return;
    const now = safeNow();
    if (now - this.moveAt < this.config.capture.move.throttleMs) return;
    this.moveAt = now;
    if (this.moveBaseTs === 0) this.moveBaseTs = now;
    const tsOffset = now - this.moveBaseTs;
    const point = eventPagePoint(event);
    this.movePoints.push({ x: point.x, y: point.y, tsOffset });
  };

  private handleScroll = () => {
    const now = safeNow();
    if (now - this.scrollAt < 200) return;
    this.scrollAt = now;
    const { scrollTop, pct } = computeScrollDepth();
    const base = this.baseEvent();
    const evt: ScrollEvent = {
      ...base,
      type: "scroll",
      scrollY: scrollTop,
      scrollDepthPct: pct
    };
    this.enqueue(evt);
  };

  private handleInput = (event: Event) => {
    const target = event.target as Element | null;
    const config = this.config.capture.inputs;
    if (!config?.enabled || config.mode === "off") return;
    if (!target || !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    if (config.mode === "allowlist" && (!config.allowSelectors?.length || !matchesAny(target, config.allowSelectors))) {
      return;
    }
    if (!this.shouldCapture(target, config.allowSelectors)) return;
    if (isSensitiveInput(target)) return;

    const base = this.baseEvent();
    const length = inputLength(target);
    const evt: InputEventPayload = {
      ...base,
      type: "input",
      action: event.type as InputEventPayload["action"],
      selector: elementSelector(target),
      inputType: target instanceof HTMLInputElement ? target.type : "textarea",
      length
    };

    if (config.mode === "masked") {
      const masked = length ? "*".repeat(Math.min(length, 16)) : "";
      evt.masked = masked;
    }

    this.enqueue(evt);
  };

  private handleKeyboard = (event: KeyboardEvent) => {
    const target = event.target as Element | null;
    const config = this.config.capture.keyboard;
    if (!config?.enabled || config.mode === "off") return;
    if (
      config.mode === "allowlist" &&
      (!config.allowSelectors?.length || !target || !matchesAny(target, config.allowSelectors))
    ) {
      return;
    }
    if (!this.shouldCapture(target, config.allowSelectors)) return;
    if (isSensitiveInput(target)) return;

    const base = this.baseEvent();
    const evt: KeyboardEventPayload = {
      ...base,
      type: "keyboard",
      category: classifyKey(event.key)
    };
    this.enqueue(evt);
  };

  private persistSession() {
    writeStorage(this.sessionStore, this.storageKey("session"), {
      id: this.sessionId,
      startedAt: this.startedAt,
      lastSeenAt: this.lastSeenAt
    });
  }

  private dropQueue(cause: string) {
    const dropped = this.queue.length;
    if (!dropped) return;
    this.queue = [];
    this.reportError(eventsDroppedError(dropped, cause));
  }

  private persistQueue(): boolean {
    try {
      const pending = [...this.inFlight, ...this.queue];
      return writeStorage(window.sessionStorage, this.storageKey("queue"), pending.length ? pending : undefined);
    } catch {
      return false;
    }
  }

  private restoreQueue() {
    try {
      const store = window.sessionStorage;
      const key = this.storageKey("queue");
      const raw = store.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.queue = parsed as AnyEvent[];
      } else {
        store.removeItem(key);
      }
    } catch {
      // ignore
    }
  }

  private storageKey(kind: "session" | "queue") {
    return `${SDK_NAME}:${stableHash(`${this.config.projectKey}|${this.config.endpoint}`)}:${kind}`;
  }
}

const noop = () => {};
const noopAsync = async () => {};
const createNoopTracker = (): Tracker => ({
  identify: noop,
  setAuthToken: noop,
  track: noop,
  flush: noopAsync,
  shutdown: noopAsync
});

export const init = (config: InitConfig): Tracker => {
  const resolved = ensureConfig(config);
  const missing = (["endpoint", "projectKey"] as const).filter((key) => !resolved[key]);
  if (missing.length > 0) {
    const keys = missing.join(" and ");
    throw new HeatTrackerError(
      SDK_ERRORS.HEAT_E_CONFIG_MISSING,
      `${keys} ${missing.length > 1 ? "are" : "is"} missing`,
      {
        message: `init() is missing ${keys}.`
      }
    );
  }
  if (typeof window === "undefined") {
    throw new HeatTrackerError(SDK_ERRORS.HEAT_E_NOT_BROWSER, 'typeof window is "undefined"');
  }
  announceToParentFrame(config.dashboardOrigins);

  if (resolved.privacy.respectDoNotTrack && navigator.doNotTrack === "1") {
    return createNoopTracker();
  }
  if (resolved.sampling < 1 && Math.random() > resolved.sampling) {
    return createNoopTracker();
  }

  const tracker = new TrackerImpl(resolved);
  return tracker;
};

export type { AnyEvent };
