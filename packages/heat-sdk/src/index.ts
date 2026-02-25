/* eslint-disable @typescript-eslint/no-explicit-any */

export type InitConfig = {
  endpoint: string;
  projectKey: string;
  app?: { name?: string; version?: string; env?: string };
  session?: {
    idleTimeoutMs?: number;
    persist?: "tab" | "browser";
  };
  batch?: {
    maxEvents?: number;
    flushIntervalMs?: number;
    maxQueueBytes?: number;
    storage?: "memory" | "localStorage";
  };
  sampling?: number;
  privacy?: {
    respectDoNotTrack?: boolean;
    blockSelectors?: string[];
    allowSelectors?: string[];
    maskTextSelectors?: string[];
  };
  capture?: {
    click?: boolean;
    move?: { enabled: boolean; throttleMs: number };
    scroll?: boolean;
    pageview?: boolean;
    inputs?: {
      enabled: boolean;
      mode: "off" | "metadata" | "masked" | "allowlist";
      allowSelectors?: string[];
    };
    keyboard?: {
      enabled: boolean;
      mode: "off" | "metadata" | "allowlist";
      allowSelectors?: string[];
    };
  };
};

export type Tracker = {
  identify: (userId: string, traits?: Record<string, any>) => void;
  setAuthToken: (jwt: string | null) => void;
  track: (name: string, props?: Record<string, any>) => void;
  flush: () => Promise<void>;
  shutdown: () => Promise<void>;
};

type ResolvedCaptureConfig = {
  click: boolean;
  move: { enabled: boolean; throttleMs: number };
  scroll: boolean;
  pageview: boolean;
  inputs: {
    enabled: boolean;
    mode: "off" | "metadata" | "masked" | "allowlist";
    allowSelectors?: string[];
  };
  keyboard: {
    enabled: boolean;
    mode: "off" | "metadata" | "allowlist";
    allowSelectors?: string[];
  };
};

type ResolvedConfig = {
  endpoint: string;
  projectKey: string;
  app: { name?: string; version?: string; env?: string };
  session: { idleTimeoutMs: number; persist: "tab" | "browser" };
  batch: {
    maxEvents: number;
    flushIntervalMs: number;
    maxQueueBytes: number;
    storage: "memory" | "localStorage";
  };
  sampling: number;
  privacy: {
    respectDoNotTrack: boolean;
    blockSelectors: string[];
    allowSelectors: string[];
    maskTextSelectors: string[];
  };
  capture: ResolvedCaptureConfig;
};

type EventBase = {
  eventId: string;
  sessionId: string;
  ts: number;
  path: string;
  viewport: { w: number; h: number; dpr: number };
  device: { ua: string; platform: string; language: string };
  meta?: Record<string, any>;
};

type ClickEvent = EventBase & {
  type: "click";
  x: number;
  y: number;
  selector?: string;
  button?: number;
};

type MoveEvent = EventBase & {
  type: "move";
  points: Array<{ x: number; y: number; tsOffset: number }>;
};

type ScrollEvent = EventBase & {
  type: "scroll";
  scrollY: number;
  scrollDepthPct: number;
};

type PageviewEvent = EventBase & {
  type: "pageview";
  from?: string;
  to: string;
};

type CustomEvent = EventBase & {
  type: "custom";
  name: string;
  props?: Record<string, any>;
};

type InputEventPayload = EventBase & {
  type: "input";
  action: "focus" | "blur" | "change";
  selector?: string;
  inputType?: string;
  length?: number;
  masked?: string;
};

type KeyboardEventPayload = EventBase & {
  type: "keyboard";
  category: "navigation" | "editing" | "modifier" | "system" | "other";
};

type AnyEvent =
  | ClickEvent
  | MoveEvent
  | ScrollEvent
  | PageviewEvent
  | CustomEvent
  | InputEventPayload
  | KeyboardEventPayload;

const DEFAULT_BLOCK_SELECTORS = [
  "[data-private]",
  "input[type=password]",
  "input[type=hidden]",
  "input[autocomplete=\"one-time-code\"]",
  "input[autocomplete=\"current-password\"]",
  "input[autocomplete=\"cc-number\"]",
  "input[autocomplete=\"cc-csc\"]",
  "input[autocomplete=\"cc-exp\"]"
];

const DEFAULT_CONFIG: ResolvedConfig = {
  endpoint: "",
  projectKey: "",
  app: {},
  session: {
    idleTimeoutMs: 30 * 60 * 1000,
    persist: "tab"
  },
  batch: {
    maxEvents: 50,
    flushIntervalMs: 2000,
    maxQueueBytes: 1_000_000,
    storage: "memory"
  },
  sampling: 1,
  privacy: {
    respectDoNotTrack: true,
    blockSelectors: DEFAULT_BLOCK_SELECTORS,
    allowSelectors: [],
    maskTextSelectors: []
  },
  capture: {
    click: true,
    move: { enabled: true, throttleMs: 80 },
    scroll: true,
    pageview: true,
    inputs: { enabled: false, mode: "off", allowSelectors: [] },
    keyboard: { enabled: false, mode: "off", allowSelectors: [] }
  }
};

const SDK_NAME = "@m-software-engineering/heat-sdk";
const SDK_VERSION = "0.2.3";

const safeNow = () => Date.now();

const randomId = () => {
  const cryptoObj = typeof globalThis !== "undefined" ? (globalThis as any).crypto : undefined;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== "function") {
    return `m-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
  }
  const bytes = new Uint8Array(16);
  cryptoObj.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  const hex = Array.from(bytes, toHex).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const getPath = () => `${location.pathname}${location.search}${location.hash}`;

const getViewport = () => ({
  w: window.innerWidth,
  h: window.innerHeight,
  dpr: window.devicePixelRatio || 1
});

const getDevice = () => ({
  ua: navigator.userAgent,
  platform: navigator.platform || "",
  language: navigator.language || ""
});

const elementSelector = (el: Element | null) => {
  if (!el) return undefined;
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && parts.length < 4) {
    let part = current.tagName.toLowerCase();
    if (current.id) {
      part += `#${current.id}`;
      parts.unshift(part);
      break;
    }
    if (current.classList.length > 0) {
      const cls = Array.from(current.classList).slice(0, 2).join(".");
      part += `.${cls}`;
    }
    parts.unshift(part);
    current = current.parentElement;
  }
  const selector = parts.join(" > ");
  return selector.length > 200 ? selector.slice(0, 200) : selector;
};

const isSensitiveInput = (el: Element | null) => {
  if (!el || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
  const type = el instanceof HTMLInputElement ? el.type : "text";
  const blocked = ["password"].includes(type);
  const autocomplete = el.getAttribute("autocomplete") || "";
  const name = el.getAttribute("name") || "";
  const id = el.getAttribute("id") || "";
  const sensitiveHints = `${autocomplete} ${name} ${id}`.toLowerCase();
  const otp = sensitiveHints.includes("one-time-code") || sensitiveHints.includes("otp");
  const token = sensitiveHints.includes("token") || sensitiveHints.includes("secret");
  const cc = sensitiveHints.includes("cc-") || sensitiveHints.includes("card");
  return blocked || otp || token || cc;
};

const matchesAny = (el: Element, selectors: string[]) => {
  return selectors.some((selector) => {
    try {
      return el.closest(selector);
    } catch {
      return false;
    }
  });
};

const inputLength = (el: HTMLInputElement | HTMLTextAreaElement) => {
  try {
    return el.value ? el.value.length : 0;
  } catch {
    return undefined;
  }
};

const classifyKey = (key: string) => {
  if (["Backspace", "Delete", "Enter", "Tab"].includes(key)) return "editing";
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"].includes(key)) {
    return "navigation";
  }
  if (["Shift", "Control", "Alt", "Meta"].includes(key)) return "modifier";
  if (["Escape", "PrintScreen"].includes(key)) return "system";
  return "other";
};

const computeScrollDepth = () => {
  const doc = document.documentElement;
  const scrollTop = window.scrollY || doc.scrollTop || 0;
  const scrollHeight = doc.scrollHeight - window.innerHeight;
  const pct = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
  return { scrollTop, pct: Math.max(0, Math.min(100, pct)) };
};

const ensureConfig = (config: InitConfig): ResolvedConfig => {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    app: { ...DEFAULT_CONFIG.app, ...config.app },
    session: { ...DEFAULT_CONFIG.session, ...config.session },
    batch: { ...DEFAULT_CONFIG.batch, ...config.batch },
    privacy: {
      ...DEFAULT_CONFIG.privacy,
      ...config.privacy,
      blockSelectors: config.privacy?.blockSelectors ?? DEFAULT_CONFIG.privacy.blockSelectors,
      allowSelectors: config.privacy?.allowSelectors ?? DEFAULT_CONFIG.privacy.allowSelectors,
      maskTextSelectors: config.privacy?.maskTextSelectors ?? DEFAULT_CONFIG.privacy.maskTextSelectors
    },
    capture: {
      ...DEFAULT_CONFIG.capture,
      ...config.capture,
      move: {
        enabled: config.capture?.move?.enabled ?? DEFAULT_CONFIG.capture.move.enabled,
        throttleMs: config.capture?.move?.throttleMs ?? DEFAULT_CONFIG.capture.move.throttleMs
      },
      inputs: {
        enabled: config.capture?.inputs?.enabled ?? DEFAULT_CONFIG.capture.inputs.enabled,
        mode: config.capture?.inputs?.mode ?? DEFAULT_CONFIG.capture.inputs.mode,
        allowSelectors: config.capture?.inputs?.allowSelectors ?? DEFAULT_CONFIG.capture.inputs.allowSelectors
      },
      keyboard: {
        enabled: config.capture?.keyboard?.enabled ?? DEFAULT_CONFIG.capture.keyboard.enabled,
        mode: config.capture?.keyboard?.mode ?? DEFAULT_CONFIG.capture.keyboard.mode,
        allowSelectors: config.capture?.keyboard?.allowSelectors ?? DEFAULT_CONFIG.capture.keyboard.allowSelectors
      }
    }
  };
};

class TrackerImpl implements Tracker {
  private config: ResolvedConfig;
  private sessionId: string;
  private sessionStartedAt: number;
  private lastSeenAt: number;
  private userId?: string;
  private userTraits?: Record<string, any>;
  private authToken: string | null = null;
  private queue: AnyEvent[] = [];
  private movePoints: Array<{ x: number; y: number; tsOffset: number }> = [];
  private moveBaseTs = 0;
  private flushTimer?: number;
  private retryTimer?: number;
  private backoffMs = 0;
  private stopped = false;
  private lastMoveCapture = 0;
  private lastScrollCapture = 0;
  private currentPath = getPath();
  private originalHistoryPushState?: History["pushState"];
  private originalHistoryReplaceState?: History["replaceState"];

  constructor(config: ResolvedConfig) {
    this.config = config;
    const session = this.loadSession();
    this.sessionId = session.id;
    this.sessionStartedAt = session.startedAt;
    this.lastSeenAt = session.lastSeenAt;
    this.restoreQueue();

    this.attachListeners();
    this.flushTimer = window.setInterval(() => {
      void this.flush();
    }, this.config.batch.flushIntervalMs);

    if (this.config.capture.pageview) {
      this.recordPageview(undefined, this.currentPath);
    }
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
    this.enqueueMoveEvent();
    await this.sendBatch();
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
  }

  private enqueue(event: AnyEvent) {
    this.queue.push(event);
    this.persistQueue();
    this.trimQueue();
    if (this.queue.length >= this.config.batch.maxEvents) {
      void this.flush();
    }
  }

  private trimQueue() {
    const maxBytes = this.config.batch.maxQueueBytes;
    if (!maxBytes) return;
    let size = this.queueSize();
    while (this.queue.length > 0 && size > maxBytes) {
      this.queue.shift();
      size = this.queueSize();
    }
  }

  private queueSize() {
    try {
      return JSON.stringify(this.queue).length;
    } catch {
      return this.queue.length * 200;
    }
  }

  private enqueueMoveEvent() {
    if (this.movePoints.length === 0) return;
    const base = this.baseEvent(this.moveBaseTs || safeNow());
    const evt: MoveEvent = {
      ...base,
      type: "move",
      points: [...this.movePoints]
    };
    this.movePoints = [];
    this.moveBaseTs = 0;
    this.enqueue(evt);
  }

  private async sendBatch() {
    if (this.queue.length === 0) return;
    if (this.backoffMs > 0 && this.retryTimer) return;

    const batch = this.queue.splice(0, this.config.batch.maxEvents);
    const payload = {
      sdk: { name: SDK_NAME, version: SDK_VERSION },
      app: this.config.app,
      session: {
        id: this.sessionId,
        startedAt: this.sessionStartedAt,
        lastSeenAt: this.lastSeenAt
      },
      user: this.userId ? { id: this.userId, traits: this.userTraits } : undefined,
      events: batch
    };

    try {
      const res = await fetch(this.config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-project-key": this.config.projectKey,
          ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {})
        },
        body: JSON.stringify(payload),
        keepalive: true
      });

      if (!res.ok) {
        throw new Error(`Ingest failed: ${res.status}`);
      }
      this.backoffMs = 0;
    } catch {
      this.queue = [...batch, ...this.queue];
      this.persistQueue();
      this.scheduleRetry();
    }
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
      path: getPath(),
      viewport: getViewport(),
      device: getDevice(),
      meta: {
        viewportBucket: this.viewportBucket()
      }
    };
  }

  private viewportBucket() {
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
      window.addEventListener("popstate", this.handleNavigation);
      this.patchHistory();
    }
    if (capture.inputs?.enabled && capture.inputs.mode !== "off") {
      window.addEventListener("focus", this.handleInputFocus, true);
      window.addEventListener("blur", this.handleInputBlur, true);
      window.addEventListener("change", this.handleInputChange, true);
    }
    if (capture.keyboard?.enabled && capture.keyboard.mode !== "off") {
      window.addEventListener("keydown", this.handleKeyboard, true);
    }
  }

  private detachListeners() {
    window.removeEventListener("click", this.handleClick, true);
    window.removeEventListener("mousemove", this.handleMove, true);
    window.removeEventListener("scroll", this.handleScroll);
    window.removeEventListener("popstate", this.handleNavigation);
    window.removeEventListener("focus", this.handleInputFocus, true);
    window.removeEventListener("blur", this.handleInputBlur, true);
    window.removeEventListener("change", this.handleInputChange, true);
    window.removeEventListener("keydown", this.handleKeyboard, true);
    this.restoreHistory();
  }

  private patchHistory() {
    if (!this.originalHistoryPushState) {
      this.originalHistoryPushState = history.pushState;
    }
    if (!this.originalHistoryReplaceState) {
      this.originalHistoryReplaceState = history.replaceState;
    }

    history.pushState = (...args) => {
      this.originalHistoryPushState?.apply(history, args as any);
      this.handleNavigation();
    };
    history.replaceState = (...args) => {
      this.originalHistoryReplaceState?.apply(history, args as any);
      this.handleNavigation();
    };
  }

  private restoreHistory() {
    if (this.originalHistoryPushState) {
      history.pushState = this.originalHistoryPushState;
    }
    if (this.originalHistoryReplaceState) {
      history.replaceState = this.originalHistoryReplaceState;
    }
  }

  private handleNavigation = () => {
    const nextPath = getPath();
    if (nextPath === this.currentPath) return;
    const prev = this.currentPath;
    this.currentPath = nextPath;
    this.recordPageview(prev, nextPath);
  };

  private recordPageview(from?: string, to?: string) {
    const base = this.baseEvent();
    const evt: PageviewEvent = {
      ...base,
      type: "pageview",
      from,
      to: to || getPath()
    };
    this.enqueue(evt);
  }

  private handleClick = (event: MouseEvent) => {
    const target = event.target as Element | null;
    if (!this.shouldCapture(target)) return;
    const base = this.baseEvent();
    const evt: ClickEvent = {
      ...base,
      type: "click",
      x: event.clientX,
      y: event.clientY,
      selector: elementSelector(target),
      button: event.button
    };
    this.enqueue(evt);
  };

  private handleMove = (event: MouseEvent) => {
    const now = safeNow();
    if (now - this.lastMoveCapture < this.config.capture.move.throttleMs) return;
    this.lastMoveCapture = now;
    if (this.moveBaseTs === 0) this.moveBaseTs = now;
    const tsOffset = now - this.moveBaseTs;
    this.movePoints.push({ x: event.clientX, y: event.clientY, tsOffset });
  };

  private handleScroll = () => {
    const now = safeNow();
    if (now - this.lastScrollCapture < 200) return;
    this.lastScrollCapture = now;
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

  private handleInputFocus = (event: FocusEvent) => {
    this.captureInputEvent(event, "focus");
  };

  private handleInputBlur = (event: FocusEvent) => {
    this.captureInputEvent(event, "blur");
  };

  private handleInputChange = (event: Event) => {
    this.captureInputEvent(event, "change");
  };

  private captureInputEvent(event: Event, action: "focus" | "blur" | "change") {
    const target = event.target as Element | null;
    const config = this.config.capture.inputs;
    if (!config?.enabled || config.mode === "off") return;
    if (!target || !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    if (!this.shouldCapture(target, config.allowSelectors)) return;
    if (isSensitiveInput(target)) return;

    const base = this.baseEvent();
    const length = inputLength(target);
    const evt: InputEventPayload = {
      ...base,
      type: "input",
      action,
      selector: elementSelector(target),
      inputType: target instanceof HTMLInputElement ? target.type : "textarea",
      length
    };

    if (config.mode === "masked") {
      const masked = length ? "*".repeat(Math.min(length, 16)) : "";
      evt.masked = masked;
    }

    this.enqueue(evt);
  }

  private handleKeyboard = (event: KeyboardEvent) => {
    const target = event.target as Element | null;
    const config = this.config.capture.keyboard;
    if (!config?.enabled || config.mode === "off") return;
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

  private loadSession() {
    const store = this.storage();
    const key = this.sessionStorageKey();
    let stored: { id: string; startedAt: number; lastSeenAt: number } | null = null;
    try {
      const raw = store.getItem(key);
      if (raw) stored = JSON.parse(raw);
    } catch {
      stored = null;
    }

    const now = safeNow();
    if (!stored || now - stored.lastSeenAt > this.config.session.idleTimeoutMs) {
      const id = randomId();
      const session = { id, startedAt: now, lastSeenAt: now };
      try {
        store.setItem(key, JSON.stringify(session));
      } catch {
        // ignore
      }
      return session;
    }
    return stored;
  }

  private persistSession() {
    const store = this.storage();
    const key = this.sessionStorageKey();
    const session = { id: this.sessionId, startedAt: this.sessionStartedAt, lastSeenAt: this.lastSeenAt };
    try {
      store.setItem(key, JSON.stringify(session));
    } catch {
      // ignore
    }
  }

  private storage() {
    return this.config.session.persist === "browser" ? localStorage : sessionStorage;
  }

  private sessionStorageKey() {
    return `${SDK_NAME}:session`;
  }

  private persistQueue() {
    if (this.config.batch.storage !== "localStorage") return;
    try {
      localStorage.setItem(`${SDK_NAME}:queue`, JSON.stringify(this.queue));
    } catch {
      // ignore
    }
  }

  private restoreQueue() {
    if (this.config.batch.storage !== "localStorage") return;
    try {
      const raw = localStorage.getItem(`${SDK_NAME}:queue`);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.queue = parsed as AnyEvent[];
      }
    } catch {
      // ignore
    }
  }
}

const createNoopTracker = (): Tracker => ({
  identify: () => {},
  setAuthToken: () => {},
  track: () => {},
  flush: async () => {},
  shutdown: async () => {}
});

export const init = (config: InitConfig): Tracker => {
  const resolved = ensureConfig(config);
  if (!resolved.endpoint || !resolved.projectKey) {
    throw new Error("heat-sdk: endpoint and projectKey are required");
  }
  if (typeof window === "undefined") {
    throw new Error("heat-sdk: init must be called in a browser environment");
  }

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
