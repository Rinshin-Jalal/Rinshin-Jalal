// A live pixel window into Kerala for a GitHub profile README.
//
//   GET /window.svg?theme=light|dark  the scene: real IST time, real weather,
//                                     real "did he push today", live counters
//   GET /tap?x,y                      clicks on the image (<img ismap> sends x,y)
//   GET /chai  /callout  /building    the same actions as plain links, for
//                                     phones and anything that can't click ismap
import { bump, getCount, getLastPush, getWeather, limited, type Env } from "./data.ts";
import { REGIONS, renderWindow, shippedToday, type SceneState, type Theme } from "./scene.ts";

const NO_CACHE = "no-cache, no-store, must-revalidate, max-age=0";

async function state(env: Env, theme: Theme): Promise<SceneState> {
  const [weather, lastPush, chai, callouts] = await Promise.all([
    getWeather(env), getLastPush(env), getCount(env, "chai"), getCount(env, "callouts"),
  ]);
  return { now: new Date(), weather, lastPush, chai, callouts, theme };
}

const back = (env: Env, to?: string) =>
  new Response(null, { status: 302, headers: { Location: to ?? env.PROFILE_URL, "Cache-Control": NO_CACHE } });

async function chai(env: Env, req: Request): Promise<Response> {
  if (!(await limited(env, req, "chai", 600))) await bump(env, "chai");
  return back(env);
}

async function callout(env: Env, req: Request, ctx: ExecutionContext): Promise<Response> {
  if (!(await limited(env, req, "callout", 86_400))) {
    await bump(env, "callouts");
    const lastPush = await getLastPush(env);
    // Only buzz the phone when the callout is deserved: nothing pushed today.
    if (env.NTFY_TOPIC && !shippedToday({ now: new Date(), lastPush })) {
      ctx.waitUntil(fetch(`https://ntfy.sh/${env.NTFY_TOPIC}`, {
        method: "POST",
        headers: { Title: "you've been called out", Tags: "rotating_light" },
        body: "someone on your github profile noticed you haven't shipped today.",
      }));
    }
  }
  return back(env);
}

async function building(env: Env): Promise<Response> {
  const push = await getLastPush(env);
  return back(env, push ? `https://github.com/${push.repo}` : env.SITE_URL);
}

const inside = (x: number, y: number, b: { x: number; y: number; w: number; h: number }) =>
  x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    switch (url.pathname) {
      case "/window.svg": {
        const theme: Theme = url.searchParams.get("theme") === "dark" ? "dark" : "light";
        return new Response(renderWindow(await state(env, theme)), {
          headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": NO_CACHE },
        });
      }
      case "/tap": {
        // <img ismap> appends "?x,y" in the image's rendered pixels.
        const [x, y] = url.search.slice(1).split(",").map(Number);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return back(env);
        if (inside(x, y, REGIONS.chai) || inside(x, y, REGIONS.chaiPill)) return chai(env, req);
        if (inside(x, y, REGIONS.callout)) return callout(env, req, ctx);
        if (inside(x, y, REGIONS.building) || inside(x, y, REGIONS.window)) return building(env);
        return back(env, env.SITE_URL);
      }
      case "/chai": return chai(env, req);
      case "/callout": return callout(env, req, ctx);
      case "/building": return building(env);
      default: return back(env);
    }
  },
} satisfies ExportedHandler<Env>;
