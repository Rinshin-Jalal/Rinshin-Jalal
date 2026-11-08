import { pixelText, textWidth } from "./font.ts";

export type Theme = "light" | "dark";
export interface Weather { tempC: number; code: number; cloud: number; precip: number }
export interface Push { at: string; repo: string }
export interface SceneState {
  now: Date;
  weather: Weather | null;
  lastPush: Push | null;
  chai: number;
  callouts: number;
  theme: Theme;
}

// The scene is a 120x40 grid of 7px cells, with a status bar underneath.
export const P = 7;
export const COLS = 120;
export const ROWS = 40;
export const W = COLS * P; // 840
export const SCENE_H = ROWS * P; // 280
export const BAR_H = 72;
export const H = SCENE_H + BAR_H; // 352

type Box = { x: number; y: number; w: number; h: number };
const PILL_Y = SCENE_H + 38;
const PILL_H = 26;

/** Click targets in image pixels, shared with the worker's ismap hit test. */
export const REGIONS = {
  window: { x: 97 * P, y: 19 * P, w: 11 * P, h: 6 * P },
  chai: { x: 108 * P, y: 18 * P, w: 7 * P, h: 8 * P },
  // Status bar pills sit in fixed slots, so the hit test never depends on counts.
  chaiPill: { x: 16, y: PILL_Y, w: 220, h: PILL_H },
  callout: { x: 246, y: PILL_Y, w: 340, h: PILL_H },
  building: { x: 596, y: PILL_Y, w: 228, h: PILL_H },
} satisfies Record<string, Box>;

// ---------------------------------------------------------------- colour

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (rgb: number[]) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [hex(a), hex(b)];
  const k = Math.min(1, Math.max(0, t));
  return toHex(x.map((v, i) => v + (y[i] - v) * k));
}
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Small seeded RNG so stars, clouds and ripples stay put between renders. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- grid

class Grid {
  private cells = new Map<number, string>();
  set(x: number, y: number, c: string) {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
    this.cells.set(y * COLS + x, c);
  }
  rect(x: number, y: number, w: number, h: number, c: string) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  /** One <path> per colour, with horizontal runs merged. */
  toSvg(attrs = ""): string {
    const byColour = new Map<string, string[]>();
    for (let y = 0; y < ROWS; y++) {
      let x = 0;
      while (x < COLS) {
        const c = this.cells.get(y * COLS + x);
        if (!c) { x++; continue; }
        let end = x;
        while (end + 1 < COLS && this.cells.get(y * COLS + end + 1) === c) end++;
        const run = end - x + 1;
        if (!byColour.has(c)) byColour.set(c, []);
        byColour.get(c)!.push(`M${x * P} ${y * P}h${run * P}v${P}h-${run * P}z`);
        x = end + 1;
      }
    }
    const paths = [...byColour].map(([c, d]) => `<path fill="${c}" d="${d.join("")}"/>`).join("");
    return attrs ? `<g ${attrs}>${paths}</g>` : paths;
  }
}

// ---------------------------------------------------------------- time & weather

/** Hours since midnight in Kerala (IST, UTC+5:30), as a float. */
export function istHours(now: Date): number {
  const minutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440;
  return minutes / 60;
}

/** Milliseconds timestamp of the most recent midnight in IST. */
export function istMidnight(now: Date): number {
  return now.getTime() - istHours(now) * 3600_000;
}

const SKY: { h: number; top: string; bot: string }[] = [
  { h: 0, top: "#0a0f24", bot: "#1b2246" },
  { h: 4.9, top: "#0a0f24", bot: "#1b2246" },
  { h: 5.9, top: "#2b3570", bot: "#f2a26b" },
  { h: 7.0, top: "#4b97cf", bot: "#bfe3f0" },
  { h: 16.6, top: "#4b97cf", bot: "#cde9f2" },
  { h: 17.8, top: "#3b2d63", bot: "#f08a5d" },
  { h: 19.0, top: "#0a0f24", bot: "#232a52" },
  { h: 24, top: "#0a0f24", bot: "#1b2246" },
];

function skyAt(h: number) {
  const i = SKY.findIndex((k) => k.h > h);
  const [a, b] = [SKY[i - 1], SKY[i]];
  const t = (h - a.h) / (b.h - a.h);
  return { top: mix(a.top, b.top, t), bot: mix(a.bot, b.bot, t) };
}

/** 0 in full day, 1 in full night, ramping through dawn and dusk. */
function nightness(h: number): number {
  if (h < 5.0 || h >= 19.0) return 1;
  if (h < 6.8) return 1 - (h - 5.0) / 1.8;
  if (h >= 17.3) return (h - 17.3) / 1.7;
  return 0;
}

type Sky = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "heavy" | "thunder";

/** WMO weather code to a word for the status line and a sky to draw. */
export function describeWeather(code: number): { label: string; sky: Sky } {
  if (code <= 1) return { label: code === 0 ? "clear" : "mostly clear", sky: "clear" };
  if (code === 2) return { label: "partly cloudy", sky: "partly" };
  if (code === 3) return { label: "cloudy", sky: "cloudy" };
  if (code === 45 || code === 48) return { label: "fog", sky: "fog" };
  if (code >= 51 && code <= 57) return { label: "drizzle", sky: "drizzle" };
  if (code === 61 || code === 80) return { label: code === 61 ? "light rain" : "showers", sky: "rain" };
  if (code === 63 || code === 81 || code === 66) return { label: code === 81 ? "showers" : "rain", sky: "rain" };
  if (code === 65 || code === 82 || code === 67) return { label: code === 82 ? "heavy showers" : "heavy rain", sky: "heavy" };
  if (code >= 95) return { label: "thunderstorm", sky: "thunder" };
  return { label: "", sky: "partly" };
}

// ---------------------------------------------------------------- status

export type Activity = "shipping" | "asleep" | "around";

export function activity(state: SceneState): Activity {
  const h = istHours(state.now);
  const since = state.lastPush ? state.now.getTime() - Date.parse(state.lastPush.at) : Infinity;
  if (since < 3 * 3600_000) return "shipping";
  if (h >= 1.5 && h < 7.5 && since > 2 * 3600_000) return "asleep";
  return "around";
}

export function shippedToday(state: Pick<SceneState, "now" | "lastPush">): boolean {
  return !!state.lastPush && Date.parse(state.lastPush.at) >= istMidnight(state.now);
}

function ago(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function clock(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60 + 1e-6);
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${hh < 12 ? "am" : "pm"}`;
}

// ---------------------------------------------------------------- drawing

// Western Ghats: three ridges fading into haze, mist in the valleys, a hill
// with the house on top, and a teak-and-palm valley with a railway line.

/** A smooth, deterministic ridge line: one row number per column. */
function ridgeLine(seed: number, base: number, amp: number): number[] {
  const r = rng(seed);
  const [a, b, c] = [r(), r(), r()].map((v) => v * Math.PI * 2);
  return Array.from({ length: COLS }, (_, x) => Math.round(
    base - amp * (0.55 * Math.sin(x * 0.045 + a) + 0.3 * Math.sin(x * 0.11 + b) + 0.15 * Math.sin(x * 0.27 + c))));
}
const FAR = ridgeLine(11, 11, 7);
const MID = ridgeLine(23, 19, 4);
// The near hill rises from the valley on the left to a flat top under the house.
const NEAR = Array.from({ length: COLS }, (_, x) =>
  x >= 88 ? 26 : x >= 68 ? Math.round(31 - ((x - 68) / 20) * 5) : 31 + (Math.sin(x * 0.4) > 0.6 ? -1 : 0));
// A waterfall down the middle ridge, fuller in the rain.
const FALL_X = 44;

const PALMS = [
  { x: 6, base: 37, h: 10, lean: -1 }, { x: 27, base: 37, h: 12, lean: 2 },
  { x: 52, base: 37, h: 9, lean: -1 }, { x: 66, base: 37, h: 11, lean: 1 },
];
const ARECA = [{ x: 15, h: 12 }, { x: 37, h: 13 }, { x: 59, h: 10 }];
const FRONDS = [
  [-1, 0], [-2, 0], [-3, 1], [-4, 1], [-5, 2], [1, 0], [2, 0], [3, 1], [4, 1], [5, 2],
  [-1, -1], [-2, -2], [-3, -2], [-4, -2], [1, -1], [2, -2], [3, -2], [4, -2],
  [0, -1], [0, -2], [-2, 1], [-2, 2], [-3, 3], [2, 1], [2, 2], [3, 3],
];

export function renderScene(state: SceneState): string {
  const h = istHours(state.now);
  const n = nightness(h);
  const w = state.weather ? describeWeather(state.weather.code) : { label: "", sky: "clear" as Sky };
  const wet = ["drizzle", "rain", "heavy", "thunder"].includes(w.sky);
  const overcast = Math.max(
    clamp01(((state.weather?.cloud ?? 0) - 40) / 60),
    wet ? 0.65 : 0, w.sky === "fog" ? 0.7 : 0,
  );
  const act = activity(state);
  const rand = rng(7);

  let { top, bot } = skyAt(h);
  const grey = mix("#8a929c", "#262a36", n);
  top = mix(top, grey, overcast * 0.6);
  bot = mix(bot, grey, overcast * 0.5);

  // Separate grids so the sun sets behind the ridges and its glow stays in the sky.
  const sky = new Grid(), skyGlow = new Grid(), land = new Grid();
  for (let y = 0; y < 30; y++) sky.rect(0, y, COLS, 1, mix(top, bot, Math.round((Math.min(y, 24) / 24) * 7) / 7));

  // stars, only on a clear-enough night
  const stars: string[] = [];
  if (n > 0.4) {
    const count = Math.round(50 * (1 - overcast) * n);
    for (let i = 0; i < count; i++) {
      const sx = Math.floor(rand() * W), sy = Math.floor(rand() * 14 * P);
      const big = rand() < 0.25;
      stars.push(`<rect class="tw${i % 3}" x="${sx}" y="${sy}" width="${big ? 4 : 2}" height="${big ? 4 : 2}"/>`);
    }
  }

  // sun by day, moon by night, both rising and setting behind the hills
  const disc = (cx: number, cy: number, r: number, c: string, g: Grid) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) g.set(x, y, c);
  };
  if (h >= 6.0 && h < 18.4 && overcast < 0.85) {
    const t = (h - 6.0) / 12.4, s = Math.sin(Math.PI * t);
    const cx = 8 + t * 74, cy = 21 - s * 17;
    const c = s < 0.3 ? "#ff9f5a" : "#ffd166";
    disc(cx, cy, 4.2, mix(bot, c, 0.35), skyGlow);
    disc(cx, cy, 2.6, c, sky);
  } else if (n > 0.5 && overcast < 0.9) {
    const t = ((h - 18.5 + 24) % 24) / 12, s = Math.sin(Math.PI * clamp01(t));
    const cx = 10 + clamp01(t) * 70, cy = 19 - s * 14;
    disc(cx, cy, 4.4, mix(top, "#f2efe0", 0.18), skyGlow);
    disc(cx, cy, 3.1, "#f2efe0", sky);
    disc(cx + 1.6, cy - 1.0, 2.7, mix(top, bot, Math.round((Math.min(cy, 24) / 24) * 7) / 7), sky); // crescent
  }

  // clouds, drifting above the peaks
  const clouds = new Grid();
  const cloudCount = wet ? 5 : Math.min(5, Math.round((state.weather?.cloud ?? 0) / 22));
  const cloudColour = mix(mix("#f3f6f9", "#2c3352", n), grey, overcast * 0.5);
  const SHAPES = [["..##..", ".####.", "######"], ["...###....", ".#######..", "##########", ".########."]];
  for (let i = 0; i < cloudCount; i++) {
    const shape = SHAPES[i % 2], cx = Math.floor(rand() * 100) - 4, cy = 1 + Math.floor(rand() * 7);
    shape.forEach((row, j) => [...row].forEach((ch, k) => ch === "#" && clouds.set(cx + k, cy + j, cloudColour)));
  }

  // three ridges, each nearer one darker and less hazy
  const haze = (c: string, k: number) => mix(mix(c, bot, k), "#0a0d18", n * 0.8);
  const ridges: [number[], string][] = [
    [FAR, haze("#5f8199", 0.42)], [MID, haze("#3c6553", 0.2)], [NEAR, haze("#2d5a34", 0.05)],
  ];
  for (const [line, colour] of ridges) line.forEach((top, x) => land.rect(x, top, 1, ROWS - top, colour));
  const falls = new Grid();
  const fallLen = wet ? 9 : 6;
  for (let k = 1; k <= fallLen; k++) falls.set(FALL_X, MID[FALL_X] + k, mix("#e8f1f6", "#55607a", n));
  // tea and teak texture on the near hill and valley floor
  const texture = haze("#25492b", 0.05);
  for (let i = 0; i < 70; i++) {
    const tx = Math.floor(rand() * COLS), ty = 31 + Math.floor(rand() * 9);
    if (ty > NEAR[tx]) land.rect(tx, ty, 2, 1, texture);
  }

  // valley trees: coconut and areca palms, darker against a low sun
  const sil = clamp01(n + (h > 16.8 && h < 18.6 ? 0.35 : 0) + (h > 5.6 && h < 7.0 ? 0.35 : 0));
  const leaf = mix("#2f6b3a", "#0c1a10", sil), trunk = mix("#6e4c2c", "#1e140c", sil);
  for (const a of ARECA) {
    for (let k = 0; k <= a.h; k++) land.set(a.x, 37 - k, trunk);
    const top = 37 - a.h;
    [[-1, 0], [1, 0], [0, -1], [-2, 1], [2, 1], [-1, -1], [1, -1]].forEach(([dx, dy]) => land.set(a.x + dx, top + dy, leaf));
  }
  for (const p of PALMS) {
    for (let k = 0; k <= p.h; k++) land.set(p.x + Math.round(p.lean * (k / p.h) ** 2), p.base - k, trunk);
    const cx = p.x + p.lean, cy = p.base - p.h;
    for (const [dx, dy] of FRONDS) land.set(cx + dx, cy + dy, leaf);
    land.set(cx - 1, cy + 1, mix("#5a3a1e", "#170f08", sil));
    land.set(cx + 1, cy + 1, mix("#5a3a1e", "#170f08", sil));
  }

  // the railway along the valley floor
  const rail = mix("#3a3029", "#0d0b09", n * 0.6);
  land.rect(0, 38, COLS, 1, rail);
  for (let x = 1; x < COLS; x += 3) land.set(x, 39, mix(rail, "#000000", 0.3));

  // valley mist, heaviest in the morning and in the rain
  const mistAmount = clamp01(0.3 + (h > 5 && h < 9.5 ? 0.3 : 0) + overcast * 0.35);
  const mist = new Grid();
  const mistColour = mix("#eef1f4", "#8d96ad", n);
  // one thin wisp in each valley: at the foot of the far ridge and the mid ridge
  for (const row of [17, 24]) {
    for (let x = -10; x < COLS; ) {
      const seg = 10 + Math.floor(rand() * 20);
      // part around the waterfall, so the two never cross into a "+"
      if (rand() < 0.55) for (let i = x; i < x + seg; i++) if (Math.abs(i - FALL_X) > 5) mist.set(i, row, mistColour);
      x += seg + 4 + Math.floor(rand() * 10);
    }
  }

  // the house on the hill: Kerala tiled roof, a window, a chai on the sill
  const house = new Grid(), glow = new Grid();
  const dim = (c: string, k = 0.65) => mix(c, "#0b0a10", n * k);
  for (let y = 13, half = 6; y <= 18; y++, half += 2) {
    const tile = y % 2 ? "#9c3d26" : "#83301d";
    house.rect(103 - half, y, half * 2 + 1, 1, dim(tile));
  }
  house.rect(91, 19, 24, 7, dim("#eadfc6", 0.75));
  house.rect(93, 21, 3, 5, dim("#5a3720"));
  const lit = act !== "asleep" && n > 0.3;
  const inside = act === "asleep" ? "#141210" : lit ? "#ffd27f" : dim("#3a3129", 0.4);
  house.rect(97, 19, 12, 6, dim("#5a3720"));
  house.rect(98, 20, 10, 4, inside);
  if (act !== "asleep") {
    const body = lit ? "#2b211a" : "#1c1612";
    house.rect(100, 21, 1, 2, body);
    house.rect(99, 23, 3, 1, body);
  }
  house.rect(103, 23, 5, 1, lit ? "#c9ced6" : "#7d838b");
  house.rect(104, 21, 3, 2, act === "shipping" ? "#9bd8ff" : "#454c58");
  house.rect(96, 25, 18, 1, dim("#6b4528"));
  // chai in a glass tumbler, the way a Kerala tea shop serves it
  house.rect(110, 22, 2, 1, mix("#f2dcb3", "#7a6a55", n * 0.5));
  house.rect(110, 23, 2, 2, mix("#a8571f", "#5a2f12", n * 0.5));
  if (lit) glow.rect(96, 18, 14, 8, "#ffd27f");

  const steam = new Grid();
  [[110, 21], [111, 20]].forEach(([x, y]) => steam.set(x, y, "#ffffff"));
  const zzz = act === "asleep" ? pixelText("z z", 108 * P, 15 * P, 3, "#e9e4d6") : "";

  // fireflies over the valley on a dry night
  const flies: string[] = [];
  if (n > 0.6 && !wet) {
    for (let i = 0; i < 10; i++) {
      const fx = Math.floor(rand() * 86 * P), fy = Math.floor((28 + rand() * 8) * P);
      flies.push(`<rect class="ff${i % 3}" x="${fx}" y="${fy}" width="3" height="3"/>`);
    }
  }

  // a small maroon train that crosses the valley now and then
  const train = new Grid();
  const lamp = n > 0.5 ? "#ffcf70" : "#e9d9b0";
  train.rect(0, 35, 6, 3, dim("#2f4b6e", 0.5));
  train.rect(0, 36, 6, 1, dim("#d9a441", 0.5));
  train.set(5, 35, n > 0.5 ? "#fff3c4" : "#c9d6e2");
  for (const x0 of [7, 18]) {
    train.rect(x0, 35, 10, 3, dim("#7a2a1f", 0.5));
    for (let x = x0 + 1; x < x0 + 9; x += 2) train.set(x, 36, lamp);
  }
  train.rect(0, 37, 28, 1, "#1a1512");

  // rain, lightning, fog
  let weatherFx = "";
  if (wet) {
    const drops = { drizzle: 45, rain: 90, heavy: 150, thunder: 150 }[w.sky as "rain"];
    const parts: string[] = [];
    for (let i = 0; i < drops; i++) {
      const x = Math.floor(rand() * W), y = Math.floor(rand() * SCENE_H) - SCENE_H;
      parts.push(`<rect class="r${i % 4}" x="${x}" y="${y}" width="2" height="${w.sky === "drizzle" ? 6 : 10}"/>`);
    }
    weatherFx += `<g fill="${n > 0.5 ? "#8fa3c4" : "#d6e4f2"}" opacity="0.75">${parts.join("")}</g>`;
  }
  if (w.sky === "thunder") weatherFx += `<rect class="flash" width="${W}" height="${SCENE_H}" fill="#ffffff"/>`;
  if (w.sky === "fog") {
    weatherFx += `<g class="fog" fill="${mix("#d9dde2", "#3a3f4c", n)}" opacity="0.45">`
      + `<rect y="${15 * P}" width="${W + 120}" height="${4 * P}"/><rect x="-60" y="${24 * P}" width="${W + 120}" height="${3 * P}"/></g>`;
  }

  return [
    sky.toSvg(),
    `<g fill="#fff8e7">${stars.join("")}</g>`,
    skyGlow.toSvg(`opacity="0.3"`),
    clouds.toSvg(`class="clouds"`),
    land.toSvg(),
    falls.toSvg(`class="falls"`),
    mist.toSvg(`class="mist" opacity="${((0.12 + mistAmount * 0.3) * (1 - n * 0.4)).toFixed(2)}"`),
    `<g class="train">${train.toSvg()}</g>`,
    house.toSvg(),
    glow.toSvg(`opacity="0.18"`),
    steam.toSvg(`class="steam" opacity="0.6"`),
    zzz && `<g class="zzz">${zzz}</g>`,
    flies.length ? `<g fill="#e8f58a">${flies.join("")}</g>` : "",
    weatherFx,
  ].join("");
}

// ---------------------------------------------------------------- status bar

const THEMES = {
  light: { bg: "#f8f6f1", ink: "#221f1a", muted: "#6e6a62", line: "#e6e1d6", pill: "#efebe3", accent: "#b5651d" },
  dark: { bg: "#0e0d0b", ink: "#eae5db", muted: "#8c857a", line: "#2a2722", pill: "#1a1815", accent: "#e0914e" },
};

const ICONS: Record<string, string[]> = {
  cup: [".#.#.", ".....", "####.", "###.#", "###.."],
  phone: ["##...", "#....", "#....", ".#...", "..###"],
  arrow: [".####", "...##", "..#.#", ".#..#", "#...."],
};

function icon(name: string, x: number, y: number, s: number, fill: string): string {
  const rects = ICONS[name].flatMap((row, j) =>
    [...row].map((ch, i) => (ch === "#" ? `<rect x="${x + i * s}" y="${y + j * s}" width="${s}" height="${s}"/>` : "")));
  return `<g fill="${fill}">${rects.join("")}</g>`;
}

function pill(box: Box, iconName: string, text: string, t: typeof THEMES.light, strong: boolean): string {
  const s = 2, ty = box.y + (box.h - 5 * s) / 2;
  return `<rect x="${box.x + 0.5}" y="${box.y + 0.5}" width="${box.w - 1}" height="${box.h - 1}" rx="5" fill="${strong ? t.accent : t.pill}" stroke="${strong ? t.accent : t.line}"/>`
    + icon(iconName, box.x + 10, ty, s, strong ? t.bg : t.accent)
    + pixelText(text, box.x + 28, ty, s, strong ? t.bg : t.ink);
}

export function renderStatus(state: SceneState): string {
  const t = THEMES[state.theme];
  const h = istHours(state.now);
  const act = activity(state);
  const w = state.weather ? `${Math.round(state.weather.tempC)}°c ${describeWeather(state.weather.code).label}` : "";
  const left = [`${clock(h)} in kerala`, w, act].filter(Boolean).join(" · ");
  let right = "no public pushes lately";
  if (state.lastPush) {
    const repo = state.lastPush.repo.replace(/^[^/]+\//, "");
    right = `last push ${ago(state.now.getTime() - Date.parse(state.lastPush.at))} · ${repo.length > 22 ? repo.slice(0, 21) + "-" : repo}`;
  }
  const y = SCENE_H + 14, s = 2;
  const shipped = shippedToday(state);
  const calloutText = shipped ? `shipped today · ${state.callouts} callouts` : `not shipped today · call him out · ${state.callouts}`;
  return `<rect y="${SCENE_H}" width="${W}" height="${BAR_H}" fill="${t.bg}"/>`
    + `<rect y="${SCENE_H}" width="${W}" height="1" fill="${t.line}"/>`
    + `<rect x="16" y="${y + 1}" width="8" height="8" fill="${t.accent}"/>`
    + pixelText(left, 32, y, s, t.ink)
    + pixelText(right, W - 16 - textWidth(right, s), y, s, t.muted)
    + pill(REGIONS.chaiPill, "cup", `send chai · ${state.chai}`, t, false)
    + pill(REGIONS.callout, "phone", calloutText, t, !shipped)
    + pill(REGIONS.building, "arrow", "what's he building >", t, false);
}

// ---------------------------------------------------------------- whole image

const CSS = `
.tw0{animation:tw 3.1s ease-in-out infinite}.tw1{animation:tw 4.3s ease-in-out -1.2s infinite}.tw2{animation:tw 5.7s ease-in-out -2.9s infinite}
@keyframes tw{0%,100%{opacity:1}50%{opacity:.25}}
.clouds{animation:drift 70s ease-in-out infinite alternate}@keyframes drift{from{transform:translateX(-30px)}to{transform:translateX(40px)}}
.mist{animation:drift 55s ease-in-out infinite alternate}
.falls{animation:falls 1.3s steps(2) infinite}@keyframes falls{0%{opacity:.95}50%{opacity:.6}}
.train{transform:translateX(-220px);animation:train 48s linear infinite}@keyframes train{0%{transform:translateX(-220px)}45%,100%{transform:translateX(${W + 20}px)}}
.steam{animation:steam 2.4s ease-in-out infinite}@keyframes steam{0%{opacity:0;transform:translateY(4px)}50%{opacity:.7}100%{opacity:0;transform:translateY(-6px)}}
.zzz{animation:zzz 4s ease-in-out infinite}@keyframes zzz{0%{opacity:0;transform:translateY(6px)}40%{opacity:1}100%{opacity:0;transform:translateY(-14px)}}
.r0,.r1,.r2,.r3{animation:rain .9s linear infinite}.r1{animation-delay:-.22s}.r2{animation-delay:-.45s}.r3{animation-delay:-.67s}
@keyframes rain{from{transform:translateY(0)}to{transform:translateY(${SCENE_H}px)}}
.flash{opacity:0;animation:flash 9s linear infinite}@keyframes flash{0%,93%,95.5%,100%{opacity:0}94%{opacity:.55}97%{opacity:.35}}
.fog{animation:drift 40s ease-in-out infinite alternate}
.ff0,.ff1,.ff2{opacity:0;animation:ff 3.4s ease-in-out infinite}.ff1{animation-delay:-1.1s;animation-duration:4.1s}.ff2{animation-delay:-2.3s;animation-duration:2.9s}
@keyframes ff{0%,100%{opacity:0}45%,55%{opacity:1}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}`;

export function renderWindow(state: SceneState): string {
  const t = THEMES[state.theme];
  const act = activity(state);
  const title = `A live pixel window into Kerala. It is ${clock(istHours(state.now))} there`
    + `${state.weather ? `, ${describeWeather(state.weather.code).label}` : ""}, and Rinshin is ${act}.`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" shape-rendering="crispEdges" role="img" aria-label="${title}">`
    + `<title>${title}</title><style>${CSS}</style>`
    + `<clipPath id="c"><rect width="${W}" height="${H}" rx="12"/></clipPath>`
    + `<clipPath id="s"><rect width="${W}" height="${SCENE_H}"/></clipPath>`
    + `<g clip-path="url(#c)"><g clip-path="url(#s)">${renderScene(state)}</g>${renderStatus(state)}</g>`
    + `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="${t.line}"/>`
    + `</svg>`;
}
