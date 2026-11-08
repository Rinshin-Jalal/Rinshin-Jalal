import type { Push, Weather } from "./scene.ts";

export interface Env {
  STATE: KVNamespace;
  GITHUB_USER: string;
  PROFILE_URL: string;
  SITE_URL: string;
  LAT: string;
  LON: string;
  /** Optional: an ntfy.sh topic. A callout on a day with no push buzzes this topic. */
  NTFY_TOPIC?: string;
  /** Optional: raises GitHub's rate limit for the events lookup. */
  GITHUB_TOKEN?: string;
  /** Optional: salt for hashing visitor IPs used only for rate limits. */
  IP_SALT?: string;
}

type Cached<T> = { at: number; value: T };

/** Read-through cache in KV, so every profile view doesn't hit the upstream APIs. */
async function cached<T>(env: Env, key: string, ttlMs: number, load: () => Promise<T>): Promise<T | null> {
  const hit = await env.STATE.get<Cached<T>>(key, "json");
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  try {
    const value = await load();
    await env.STATE.put(key, JSON.stringify({ at: Date.now(), value }));
    return value;
  } catch {
    return hit?.value ?? null; // upstream down: serve stale rather than nothing
  }
}

export function getWeather(env: Env): Promise<Weather | null> {
  return cached(env, "cache:weather", 15 * 60_000, async () => {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${env.LAT}&longitude=${env.LON}`
      + "&current=temperature_2m,weather_code,cloud_cover,precipitation";
    const res = await fetch(url);
    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    const { current: c } = await res.json<{ current: Record<string, number> }>();
    return { tempC: c.temperature_2m, code: c.weather_code, cloud: c.cloud_cover, precip: c.precipitation };
  });
}

export function getLastPush(env: Env): Promise<Push | null> {
  return cached(env, "cache:push", 10 * 60_000, async () => {
    const headers: Record<string, string> = {
      "User-Agent": "rinshin-window",
      Accept: "application/vnd.github+json",
    };
    if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/users/${env.GITHUB_USER}/events/public?per_page=50`, { headers });
    if (!res.ok) throw new Error(`github ${res.status}`);
    const events = await res.json<{ type: string; created_at: string; repo: { name: string } }[]>();
    const push = events.find((e) => e.type === "PushEvent");
    return push ? { at: push.created_at, repo: push.repo.name } : null;
  });
}

export async function getCount(env: Env, key: "chai" | "callouts"): Promise<number> {
  return Number(await env.STATE.get(`count:${key}`)) || 0;
}

/** Increment a counter. KV isn't atomic, so two clicks in the same instant can count once. */
export async function bump(env: Env, key: "chai" | "callouts"): Promise<number> {
  const next = (await getCount(env, key)) + 1;
  await env.STATE.put(`count:${key}`, String(next));
  return next;
}

/**
 * True if this visitor already did `action` within `ttlSeconds`. Stores only a
 * salted hash of the IP, and it expires with the window.
 */
export async function limited(env: Env, req: Request, action: string, ttlSeconds: number): Promise<boolean> {
  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${env.IP_SALT ?? ""}:${ip}`));
  const id = [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const key = `rl:${action}:${id}`;
  if (await env.STATE.get(key)) return true;
  await env.STATE.put(key, "1", { expirationTtl: Math.max(60, ttlSeconds) });
  return false;
}
