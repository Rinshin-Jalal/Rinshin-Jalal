// Renders the window in a spread of conditions to out/*.svg, so the art can be
// checked by eye without deploying. Run: node --experimental-strip-types test/render.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { renderWindow, type SceneState } from "../src/scene.ts";

const ist = (hhmm: string, day = "2026-11-08") => new Date(`${day}T${hhmm}:00+05:30`);
const hoursBefore = (d: Date, h: number) => new Date(d.getTime() - h * 3600_000).toISOString();

const cases: Record<string, SceneState> = {};
const add = (name: string, now: Date, s: Omit<SceneState, "now">) => (cases[name] = { now, ...s });

let now = ist("10:30");
add("1-morning-shipping-light", now, {
  weather: { tempC: 31.2, code: 1, cloud: 20, precip: 0 },
  lastPush: { at: hoursBefore(now, 0.7), repo: "Rinshin-Jalal/braindump" }, chai: 12, callouts: 2, theme: "light",
});
now = ist("18:05");
add("2-dusk-around-dark", now, {
  weather: { tempC: 27.4, code: 2, cloud: 55, precip: 0 },
  lastPush: { at: hoursBefore(now, 5), repo: "Rinshin-Jalal/liar-callout" }, chai: 41, callouts: 3, theme: "dark",
});
now = ist("23:30");
add("3-night-thunderstorm-shipping-dark", now, {
  weather: { tempC: 24.1, code: 95, cloud: 100, precip: 4.2 },
  lastPush: { at: hoursBefore(now, 1), repo: "Rinshin-Jalal/open-beuro" }, chai: 41, callouts: 3, theme: "dark",
});
now = ist("03:00");
add("4-night-asleep-not-shipped-light", now, {
  weather: { tempC: 22.8, code: 0, cloud: 5, precip: 0 },
  lastPush: { at: hoursBefore(now, 9), repo: "Rinshin-Jalal/a-very-long-repository-name-here" }, chai: 7, callouts: 11, theme: "light",
});
now = ist("06:10");
add("5-dawn-fog-light", now, {
  weather: { tempC: 21.5, code: 45, cloud: 90, precip: 0 },
  lastPush: null, chai: 0, callouts: 0, theme: "light",
});
now = ist("14:20");
add("6-afternoon-rain-dark", now, {
  weather: { tempC: 26.0, code: 63, cloud: 100, precip: 2.1 },
  lastPush: { at: hoursBefore(now, 2), repo: "Rinshin-Jalal/xoom-caller" }, chai: 128, callouts: 0, theme: "dark",
});

mkdirSync("out", { recursive: true });
for (const [name, state] of Object.entries(cases)) {
  const svg = renderWindow(state);
  writeFileSync(`out/${name}.svg`, svg);
  console.log(`${name}.svg  ${(svg.length / 1024).toFixed(1)} KB`);
}
