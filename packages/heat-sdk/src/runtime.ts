/* eslint-disable @typescript-eslint/no-explicit-any */
import type { HeatError } from "@m-software-engineering/heat-errors";

export type InitConfig = {
  endpoint: string;
  projectKey: string;
  /** Logs each error code once per page load with its fix and docs link. */
  debug?: boolean;
  /** Receives every SDK and collector error; the SDK is otherwise silent after init. */
  onError?: (err: HeatError) => void;
  app?: { name?: string; version?: string; env?: string };
  /**
   * Origins of heat-tracker dashboards allowed to show this page in a frame, e.g. `["https://heat.example.com"]`.
   * When framed, the SDK posts `{ type: "heat-tracker:frame-hello", href: origin + pathname }` to each of them
   * (exact targetOrigin, never `*`; no query or hash) so the dashboard knows the page loaded. Omit to send nothing.
   */
  dashboardOrigins?: string[];
  session?: {
    idleTimeoutMs?: number;
    persist?: "tab" | "browser";
  };
  batch?: {
    maxEvents?: number;
    flushIntervalMs?: number;
    maxQueueBytes?: number;
  };
  sampling?: number;
  privacy?: {
    respectDoNotTrack?: boolean;
    blockSelectors?: string[];
    allowSelectors?: string[];
    maskTextSelectors?: string[];
    /** Query params kept in the stored path; every other param (and the hash) is dropped. Default `[]`. */
    keepQueryParams?: string[];
  };
  capture?: {
    click?: boolean;
    move?: { enabled: boolean; throttleMs: number };
    scroll?: boolean;
    pageview?: boolean;
    /** Send `document.title` (masked, ≤ 200 chars) on pageviews. Default `true`. */
    pageTitle?: boolean;
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
  pageTitle: boolean;
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

export type ResolvedConfig = {
  endpoint: string;
  projectKey: string;
  debug?: boolean;
  onError?: InitConfig["onError"];
  app: { name?: string; version?: string; env?: string };
  session: { idleTimeoutMs: number; persist: "tab" | "browser" };
  batch: {
    maxEvents: number;
    flushIntervalMs: number;
    maxQueueBytes: number;
  };
  sampling: number;
  privacy: {
    respectDoNotTrack: boolean;
    blockSelectors: string[];
    allowSelectors: string[];
    maskTextSelectors: string[];
    keepQueryParams: string[];
  };
  capture: ResolvedCaptureConfig;
};

export type EventBase = {
  eventId: string;
  sessionId: string;
  ts: number;
  path: string;
  viewport: { w: number; h: number; dpr: number };
  device: { ua: string; platform: string; language: string };
  meta?: Record<string, any>;
};

export type ClickEvent = EventBase & {
  type: "click";
  x: number;
  y: number;
  selector?: string;
  button?: number;
};

export type MoveEvent = EventBase & {
  type: "move";
  points: Array<{ x: number; y: number; tsOffset: number }>;
};

export type ScrollEvent = EventBase & {
  type: "scroll";
  scrollY: number;
  scrollDepthPct: number;
};

export type PageviewEvent = EventBase & {
  type: "pageview";
  from?: string;
  to: string;
  title?: string;
};

export type CustomEvent = EventBase & {
  type: "custom";
  name: string;
  props?: Record<string, any>;
};

export type InputEventPayload = EventBase & {
  type: "input";
  action: "focus" | "blur" | "change";
  selector?: string;
  inputType?: string;
  length?: number;
  masked?: string;
};

export type KeyboardEventPayload = EventBase & {
  type: "keyboard";
  category: "navigation" | "editing" | "modifier" | "system" | "other";
};

export type AnyEvent =
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
  'input[autocomplete="one-time-code"]',
  'input[autocomplete="current-password"]',
  'input[autocomplete="cc-number"]',
  'input[autocomplete="cc-csc"]',
  'input[autocomplete="cc-exp"]'
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
    maxQueueBytes: 1_000_000
  },
  sampling: 1,
  privacy: {
    respectDoNotTrack: true,
    blockSelectors: DEFAULT_BLOCK_SELECTORS,
    allowSelectors: [],
    maskTextSelectors: [],
    keepQueryParams: []
  },
  capture: {
    click: true,
    move: { enabled: true, throttleMs: 80 },
    scroll: true,
    pageview: true,
    pageTitle: true,
    inputs: { enabled: false, mode: "off", allowSelectors: [] },
    keyboard: { enabled: false, mode: "off", allowSelectors: [] }
  }
};

export const SDK_NAME = "@m-software-engineering/heat-sdk";
export const SDK_VERSION = "0.2.6";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const createMemoryStorage = (): StorageLike => {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    }
  };
};

export const getBrowserStorage = (name: "localStorage" | "sessionStorage"): StorageLike => {
  try {
    return window[name];
  } catch {
    return createMemoryStorage();
  }
};

/** Returns whether browser storage accepted the write/removal; unavailable storage is never success. */
export const writeStorage = (store: StorageLike | undefined, key: string, value?: unknown): boolean => {
  if (!store) return false;
  try {
    if (value === undefined) store.removeItem(key);
    else store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export const stableHash = (input: string) => {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
};

type HistoryListener = () => void;

const historyPatch = {
  listeners: new Set<HistoryListener>(),
  push: undefined as History["pushState"] | undefined,
  replace: undefined as History["replaceState"] | undefined
};

const notifyHistoryListeners = () => {
  for (const listener of Array.from(historyPatch.listeners)) {
    listener();
  }
};

const ensureHistoryPatched = () => {
  if (historyPatch.push && historyPatch.replace) return;

  historyPatch.push = history.pushState;
  historyPatch.replace = history.replaceState;

  history.pushState = function patchedPushState(this: History, ...args: Parameters<History["pushState"]>) {
    historyPatch.push?.apply(this, args as any);
    notifyHistoryListeners();
  } as History["pushState"];

  history.replaceState = function patchedReplaceState(this: History, ...args: Parameters<History["replaceState"]>) {
    historyPatch.replace?.apply(this, args as any);
    notifyHistoryListeners();
  } as History["replaceState"];
};

export const addHistoryListener = (listener: HistoryListener) => {
  ensureHistoryPatched();
  historyPatch.listeners.add(listener);
};

export const removeHistoryListener = (listener: HistoryListener) => {
  historyPatch.listeners.delete(listener);
  if (historyPatch.listeners.size > 0) return;

  if (historyPatch.push) {
    history.pushState = historyPatch.push;
  }
  if (historyPatch.replace) {
    history.replaceState = historyPatch.replace;
  }
  historyPatch.push = undefined;
  historyPatch.replace = undefined;
};

export const safeNow = () => Date.now();

export const randomId = () => {
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

export const getViewport = () => ({
  w: window.innerWidth,
  h: window.innerHeight,
  dpr: window.devicePixelRatio || 1
});

export const getDevice = () => ({
  ua: navigator.userAgent,
  platform: navigator.platform || "",
  language: navigator.language || ""
});

export const elementSelector = (el: Element | null) => {
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

export const isSensitiveInput = (el: Element | null) => {
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

export const matchesAny = (el: Element, selectors: string[]) => {
  return selectors.some((selector) => {
    try {
      return el.closest(selector);
    } catch {
      return false;
    }
  });
};

export const inputLength = (el: HTMLInputElement | HTMLTextAreaElement) => {
  try {
    return el.value ? el.value.length : 0;
  } catch {
    return undefined;
  }
};

export const classifyKey = (key: string) => {
  if (["Backspace", "Delete", "Enter", "Tab"].includes(key)) return "editing";
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"].includes(key)) {
    return "navigation";
  }
  if (["Shift", "Control", "Alt", "Meta"].includes(key)) return "modifier";
  if (["Escape", "PrintScreen"].includes(key)) return "system";
  return "other";
};

export const computeScrollDepth = () => {
  const doc = document.documentElement;
  const scrollTop = window.scrollY || doc.scrollTop || 0;
  const scrollHeight = doc.scrollHeight - window.innerHeight;
  const pct = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
  return { scrollTop, pct: Math.max(0, Math.min(100, pct)) };
};

export const eventPagePoint = (event: MouseEvent) => {
  const scrollX = window.scrollX || document.documentElement.scrollLeft || 0;
  const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
  return {
    x: event.clientX + scrollX,
    y: event.clientY + scrollY
  };
};

const normalizeMaxEvents = (value: number | undefined) => {
  if (value === undefined) return DEFAULT_CONFIG.batch.maxEvents;
  if (!Number.isFinite(value) || value < 1) return DEFAULT_CONFIG.batch.maxEvents;
  return value;
};

export const ensureConfig = (config: InitConfig): ResolvedConfig => {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    app: { ...DEFAULT_CONFIG.app, ...config.app },
    session: { ...DEFAULT_CONFIG.session, ...config.session },
    batch: {
      ...DEFAULT_CONFIG.batch,
      ...config.batch,
      maxEvents: normalizeMaxEvents(config.batch?.maxEvents)
    },
    privacy: {
      ...DEFAULT_CONFIG.privacy,
      ...config.privacy,
      blockSelectors: config.privacy?.blockSelectors ?? DEFAULT_CONFIG.privacy.blockSelectors,
      allowSelectors: config.privacy?.allowSelectors ?? DEFAULT_CONFIG.privacy.allowSelectors,
      maskTextSelectors: config.privacy?.maskTextSelectors ?? DEFAULT_CONFIG.privacy.maskTextSelectors,
      keepQueryParams: config.privacy?.keepQueryParams ?? DEFAULT_CONFIG.privacy.keepQueryParams
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

export const loadSession = (store: StorageLike, key: string, idleTimeoutMs: number) => {
  let stored: { id: string; startedAt: number; lastSeenAt: number } | null = null;
  try {
    const raw = store.getItem(key);
    if (raw) stored = JSON.parse(raw);
  } catch {
    stored = null;
  }

  const now = safeNow();
  if (!stored || now - stored.lastSeenAt > idleTimeoutMs) {
    const id = randomId();
    const session = { id, startedAt: now, lastSeenAt: now };
    writeStorage(store, key, session);
    return session;
  }
  return stored;
};
