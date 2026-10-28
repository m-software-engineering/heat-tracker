/**
 * Canvas heatmap renderer. Work is split into chunks that yield to the event loop, so 100 k points
 * render in well under 300 ms without a long task (> 50 ms) blocking input (quality-bar §1).
 */
export type RenderPoint = { x: number; y: number; value: number };

export type RenderOptions = {
  /** Page-space size the points live in (CSS px): recorded viewport width × render height. */
  width: number;
  height: number;
  /** Blob radius in page px; defaults from the grid so neighbouring buckets blend. */
  radius: number;
};

/**
 * Viridis stops: perceptually uniform and readable with protanopia, deuteranopia and tritanopia.
 * Low counts are dark purple and transparent, high counts are bright yellow and opaque.
 */
export const PALETTE: Array<[number, string]> = [
  [0, "#440154"],
  [0.25, "#3b528b"],
  [0.5, "#21918c"],
  [0.75, "#5ec962"],
  [1, "#fde725"]
];

/** Upper bound on grid cells; the canvas backing store is one pixel per cell, CSS-scaled to the page. */
const MAX_CELLS = 400_000;
const POINTS_PER_CHUNK = 50_000;
const CELLS_PER_CHUNK = 100_000;

// MessageChannel yields without setTimeout's 4 ms clamp.
const yieldToEventLoop = () =>
  new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });

const hexToRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** 256-entry RGBA lookup indexed by intensity; alpha rises with intensity so low counts stay faint, and the core reaches full alpha so it still reads ≥ 50% through the overlay's CSS opacity (0.6 default, #174). */
const buildLut = () => {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i += 1) {
    const t = i / 255;
    const upper = Math.max(
      1,
      PALETTE.findIndex(([stop]) => stop >= t)
    );
    const [s1, c1] = PALETTE[upper - 1];
    const [s2, c2] = PALETTE[upper];
    const f = (t - s1) / (s2 - s1);
    const a = hexToRgb(c1);
    const b = hexToRgb(c2);
    for (let k = 0; k < 3; k += 1) lut[i * 4 + k] = a[k] + (b[k] - a[k]) * f;
    lut[i * 4 + 3] = i === 0 ? 0 : Math.min(255, 60 + i * 1.5);
  }
  return lut;
};

let lut: Uint8ClampedArray | null = null;

/** One box-blur pass along rows (step 1) or columns (step = width), in place via a scratch line. */
const boxBlur = (
  src: Float32Array,
  dst: Float32Array,
  lines: number,
  length: number,
  step: number,
  lineStep: number,
  r: number
) => {
  const scale = 1 / (2 * r + 1);
  for (let line = 0; line < lines; line += 1) {
    const base = line * lineStep;
    let sum = 0;
    for (let k = -r; k <= r; k += 1) sum += src[base + Math.min(length - 1, Math.max(0, k)) * step];
    for (let k = 0; k < length; k += 1) {
      dst[base + k * step] = sum * scale;
      sum += src[base + Math.min(length - 1, k + r + 1) * step] - src[base + Math.max(0, k - r) * step];
    }
  }
};

/**
 * Draws `points` onto `canvas`: counts are binned on a grid (at most MAX_CELLS cells), blurred with
 * three box passes (≈ Gaussian), and colored through PALETTE. The canvas keeps the page's CSS size,
 * so alignment does not depend on the grid. Resolves with the elapsed milliseconds; `isCancelled`
 * lets a newer render stop this one between chunks.
 */
export const renderHeatmap = async (
  canvas: HTMLCanvasElement,
  points: RenderPoint[],
  options: RenderOptions,
  isCancelled: () => boolean = () => false
) => {
  const started = performance.now();
  const cell = Math.max(1, Math.ceil(Math.sqrt((options.width * options.height) / MAX_CELLS)));
  const gw = Math.max(1, Math.ceil(options.width / cell));
  const gh = Math.max(1, Math.ceil(options.height / cell));
  let grid = new Float32Array(gw * gh);
  let scratch = new Float32Array(gw * gh);

  for (let start = 0; start < points.length; start += POINTS_PER_CHUNK) {
    const end = Math.min(points.length, start + POINTS_PER_CHUNK);
    for (let i = start; i < end; i += 1) {
      const p = points[i];
      const gx = Math.min(gw - 1, Math.max(0, Math.floor(p.x / cell)));
      const gy = Math.min(gh - 1, Math.max(0, Math.floor(p.y / cell)));
      grid[gy * gw + gx] += p.value;
    }
    await yieldToEventLoop();
    if (isCancelled()) return performance.now() - started;
  }

  const r = Math.max(1, Math.round(options.radius / cell / 2));
  for (let pass = 0; pass < 3; pass += 1) {
    boxBlur(grid, scratch, gh, gw, 1, gw, r);
    [grid, scratch] = [scratch, grid];
    await yieldToEventLoop();
    boxBlur(grid, scratch, gw, gh, gw, 1, r);
    [grid, scratch] = [scratch, grid];
    await yieldToEventLoop();
    if (isCancelled()) return performance.now() - started;
  }

  let peak = 0;
  for (let i = 0; i < grid.length; i += 1) if (grid[i] > peak) peak = grid[i];
  canvas.width = gw;
  canvas.height = gh;
  const ctx = canvas.getContext("2d");
  if (!ctx) return performance.now() - started;
  lut ??= buildLut();
  const image = ctx.createImageData(gw, gh);
  const data = image.data;
  const norm = peak > 0 ? 255 / peak : 0;
  for (let start = 0; start < grid.length; start += CELLS_PER_CHUNK) {
    const end = Math.min(grid.length, start + CELLS_PER_CHUNK);
    for (let i = start; i < end; i += 1) {
      const o = Math.min(255, Math.round(grid[i] * norm)) * 4;
      data[i * 4] = lut[o];
      data[i * 4 + 1] = lut[o + 1];
      data[i * 4 + 2] = lut[o + 2];
      data[i * 4 + 3] = lut[o + 3];
    }
    await yieldToEventLoop();
    if (isCancelled()) return performance.now() - started;
  }
  ctx.putImageData(image, 0, 0);
  return performance.now() - started;
};

/** CSS gradient for the legend, from the same stops as the canvas. */
export const legendGradient = () =>
  `linear-gradient(to right, ${PALETTE.map(([stop, color]) => `${color} ${stop * 100}%`).join(", ")})`;
