# the window

A live pixel-art window into the hills of Kerala, served as an SVG by a Cloudflare Worker for my GitHub profile.

| Route | What it does |
| --- | --- |
| `GET /window.svg?theme=light\|dark` | Draws the scene: real IST time, live weather, my latest public push, chai and callout counts |
| `GET /tap?x,y` | Click handler. The README wraps the image in `<a href=".../tap"><img ismap></a>`, so the browser appends the click's x,y |
| `GET /chai`, `/callout`, `/building` | The same actions as plain links, for phones |

## Deploy

```bash
npm install
npx wrangler login
npx wrangler kv namespace create STATE     # paste the id into wrangler.toml
npx wrangler deploy
```

Optional secrets (`npx wrangler secret put NAME`):
- `NTFY_TOPIC`: an [ntfy.sh](https://ntfy.sh) topic. Subscribe to it in the ntfy app, and a callout on a day with no push buzzes your phone. Pick a long random name, because anyone who knows the topic can post to it.
- `GITHUB_TOKEN`: a fine-grained token with no permissions, for a higher GitHub API rate limit.
- `IP_SALT`: any random string, used to hash visitor IPs for rate limits. Only a salted hash is stored, and it expires with the limit.

To serve it from `window.rinsh.in`, uncomment the `routes` line in `wrangler.toml`. That needs `rinsh.in` on Cloudflare DNS. Otherwise, replace `https://window.rinsh.in` in the profile README with the `workers.dev` URL that `wrangler deploy` prints.

## Develop

```bash
npm run render     # draws six conditions (dawn fog, monsoon night...) to out/*.svg
npm run dev        # local worker with simulated KV on http://localhost:8787
npm run typecheck
```
