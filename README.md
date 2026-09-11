# Survival Agent

A **Next.js 16 + React 19** rebuild of the token-survival dashboard pattern at emilelearns.run, written from scratch. It is **one application**: the pages, the API and the data-ingest loop all run in a single long-lived Next.js process. There are **six mathematician personas** and **nine statistical bound formulas** to remix it with.


The agent watches every token that clears **$10K peak market cap** and learns which ones reach **$30K**. It fills a jar only with a *proven floor* (measured AUC minus a penalty ε), never with the raw score.

```bash
npm install
npm run dev          # simulated market                  → http://localhost:3000
npm run dev:live     # real Robinhood Chain via DexScreener
npm test             # 27 tests: math, calibration, engine, route handlers, SSE, live ingest
npm run build        # tsc --noEmit + next build
npm start            # production server (npm run start:live for real data)
```

Stack: Next.js 16.3 (App Router, route handlers, instrumentation) · React 19.3 · Zustand 5 · Tailwind CSS 4.3 · Base UI 1.8 · TypeScript 7 · KaTeX · Vitest 5.

---

## How the data works

The agent starts when the server boots (`src/instrumentation.ts`) and keeps running in the same process. Browsers read one snapshot from `/api/state`, then receive updates over **Server-Sent Events** from `/api/stream`.

| Mode | Command / env | What visitors see |
|---|---|---|
| Simulated | `npm run dev`, `npm start`, `DATA_SOURCE=simulated` | A synthetic market. Badge, sidebar and footer say **SIMULATED**. |
| Live | `npm run dev:live`, `npm run start:live`, `DATA_SOURCE=dexscreener` | Real Robinhood Chain tokens. Badge says **LIVE**. |

Labels are always honest: the site only says LIVE when the server is ingesting real data.

**Warming up.** In live mode a token is labelled 48 hours after launch, and the gates need 2,000 labelled tokens. Until then:
- the feed shows real tokens marked *watching*;
- the jar shows **Warming up** with `labelled / 2,000`, the number being watched, and a countdown to the next label;
- AUC and floor read "—".

No model numbers are shown before real data exists.

Live data is saved to `data/state.json` every 30 s and on shutdown, so a restart loses nothing. Snapshots written by the earlier standalone server load as-is.

---

## Design

The layout is called "Research Desk": a sidebar plus a grid of cards. It is built with:
- Tailwind v4 theme tokens (`src/app/globals.css`);
- Base UI primitives for the dialogs, tabs and collapsible panel;
- `clsx` + `tailwind-merge`;
- Inter for text and JetBrains Mono for numbers.

- **Themes:** light, dark, or follow the system. The choice is saved per browser and applied before first paint, so there is no flash. In light mode the persona accent is darkened automatically for contrast.
- **Hero video:** put your own file at `public/videos/hero.mp4`, or set `NEXT_PUBLIC_HERO_VIDEO` / `NEXT_PUBLIC_HERO_POSTER`.
  - It plays muted and looped, and pauses when scrolled off-screen.
  - It never autoplays for visitors who have reduced motion turned on.
  - If the file is missing, the illustration is shown instead.
  - An H.264 MP4 at 16:9, under about 10 MB, works best.
- **Restraint:** no gradients, glows or decorative animation. The only moving parts are the typing code panels and value changes, which animate with transform only.

---

## Remix options

Open **Remix** in the sidebar, or the **Formula Lab** page. Choices persist per browser and can be shared by URL: `/?persona=bayes&bound=vc` (`bound=default` uses the persona's own formula). The server writes a separate idea cycle for every persona, so the Brain page follows the persona you pick.

**Recommended default:** Wassily with the Hoeffding bound. AUC is a U-statistic, so Hoeffding gives a genuinely distribution-free floor, and the jar fills at a believable pace. The original's VC bound needs tens of thousands of tokens before the jar moves.

### Personas (`src/config/personas.ts`)

| id | Mascot | Mathematician | Default formula |
|---|---|---|---|
| `hoeffding` | Wassily `$WASSILY` | Wassily Hoeffding (1914–1991) | Hoeffding bound for U-statistics |
| `kolmogorov` | Andrey `$ANDREY` | Andrey Kolmogorov (1903–1987) | Kolmogorov–Smirnov / DKW band |
| `bayes` | Thomas `$THOMAS` | Thomas Bayes (c. 1701–1761) | Bayes–Laplace posterior floor |
| `chebyshev` | Pafnuty `$PAFNUTY` | Pafnuty Chebyshev (1821–1894) | Chebyshev–Cantelli inequality |
| `bernstein` | Sergei `$SERGEI` | Sergei Bernstein (1880–1968) | Bernstein inequality |
| `wilcoxon` | Frank `$FRANK` | Frank Wilcoxon (1892–1965) | Wilcoxon–Mann–Whitney normal interval |

### Bound formulas (`src/math/bounds.ts`)

With n tokens, n₊ survivors, n₋ = n − n₊, measured AUC A, confidence 1 − δ (δ = 0.05):

| id | Formula | Proven or approximate |
|---|---|---|
| `vc` | ε = √((d(ln(2n/d)+1) + ln(4/δ)) / n) | distribution-free, very loose |
| `vc-bootstrap` | floor = min(A − ε_VC, bootstrap 2.5th percentile) | stricter of the two |
| `bootstrap` | floor = 2.5th percentile of B resampled AUCs (Efron) | empirical |
| `hoeffding` | ε = √(ln(1/δ) / 2·min(n₊, n₋)) | distribution-free |
| `bernstein` | ε = √(2σ² ln(1/δ)/m) + 2 ln(1/δ)/3m, σ² = A(1−A) | distribution-free, variance-aware |
| `dkw` | ε = √(ln(4/δ)/2n₊) + √(ln(4/δ)/2n₋) | distribution-free |
| `wilcoxon` | ε = z₁₋δ · SE (Hanley–McNeil 1982) | normal approximation |
| `cantelli` | ε = SE · √((1−δ)/δ) | finite-variance only (SE itself is an estimate) |
| `bayes` | floor = δ-quantile of Beta(kA+1, k(1−A)+1), k = A(1−A)/SE² − 1 | posterior, uniform prior |

Jar = clamp((floor − 0.50) / (0.60 − 0.50), 0, 1), capped at 95% until every gate passes (n ≥ 2,000, n₊ ≥ 200, fold σ < 0.05, time-split gap ≤ 0.04).

To add a formula, append a `BoundDef` to `BOUNDS`. To add a persona, append to `PERSONAS`.

---

## Pages

- **Overview `/`**
  - KPI strip.
  - Hero media panel for your video, with the SIMULATED/LIVE badge and contract-address copy.
  - Jar card: AUC ruler, gates, or the warming-up progress.
  - Live ingest feed with Pause/Resume.
  - Validation gates and feature weights.
  - Proof panel (formula, sliders, Sync / Fill to target / Reset).
  - Collapsible pipeline panel that types real excerpts of the server code.
- **Console `/console`:** uptime, cycle countdown, feed, typing learning pipeline, survival by launch hour, lore words by survival lift, written read-out.
- **Brain `/brain`:**
  - 100 committed candidates per cycle, per persona.
  - In-browser sha256 verification.
  - The generator's real source.
  - Confidence banner, "revised out" and theft-record tabs, score histogram.
- **Formula Lab `/lab`:** evidence sliders, floor-vs-n chart, ranked table with **Use** buttons, persona gallery.
- **About `/about`:** disclaimer, methodology, active formula, `dataset.csv` and `methodology.json`.
- **Short links:** `/github`, `/x`, `/twitter` redirect to the configured URLs, or home when unset.

## API (route handlers in `src/app/api`)

All routes are read-only and same-origin.

| Route | |
|---|---|
| `GET /api/health` | source, token count, warm-up, ingest stats |
| `GET /api/state` | counters, warm-up, Console findings, latest model (AUC, σ, gates, floor, jar, feature importance), 400 newest tokens |
| `GET /api/stream` | Server-Sent Events: `{token, counters}` on each token, `{model, counters}` on each retrain |
| `GET /api/model/history?days=30` | model runs over time |
| `GET /api/dataset.csv` · `GET /api/methodology.json` | open data |
| `GET /api/ideas/current` · `/cycle/[id]` · `/eliminated` · `/exclusions` · `/commitments?from=&to=` · `/generator` · `/filter` | idea cycles; add `?persona=` |
| `GET /api/bootstrap?n=&npos=&auc=` | bootstrap floor for the proof-panel sliders |

Each cycle the agent:
1. retrains (5-fold CV, time-split check, 500-resample bootstrap);
2. writes 100 committed ideas per persona;
3. appends every commitment to `data/commitments.jsonl` before the cycle can be served.

### Live ingest

- **Discover:** poll DexScreener `token-profiles/latest` and `token-boosts/latest` every 60 s and keep tokens on `robinhood`. The profile description becomes the lore, which is sanitized.
- **Price:** batch `tokens/v1/robinhood/{≤30 addresses}` and keep the **peak** market cap, never the current one.
- **Admit:** only tokens first seen within 6 h of launch. For older tokens the earlier peak is unknowable.
- **Label:** once at 48 h. Below $10K leaves the study, ≥ $30K is *passed*, otherwise *stalled*.

**Known limits:**
- **Holder counts:** Robinhood Chain's explorer ([Blockscout](https://robinhoodchain.blockscout.com/)) blocks server requests with a Cloudflare check. Holders are **imputed with the median** unless `HOLDERS_API_URL` points at a keyed endpoint (e.g. the [Blockscout Pro API](https://docs.blockscout.com/robinhood-api)).
- **Sampling bias:** discovery only covers tokens that appear in DexScreener profiles or boosts, not every deployment.
- **Deployer and block number:** DexScreener doesn't provide them.

All of this is stated in `methodology.json`.

## Configuration

See `.env.example`.
- **Public (`NEXT_PUBLIC_*`)** values are baked in at build time: contract address, GitHub/X links, default persona and bound, hero video.
- **Server** values are read at runtime: `DATA_SOURCE`, `CHAIN`, `PERSONA`, `BOUND`, `CYCLE_SECONDS`, `POLL_SECONDS`, `MAX_DISCOVERY_AGE_HOURS`, `HOLDERS_API_URL`, `PERSIST`, `DATA_DIR`.

---

## Deploy (one long-running process)

The ingest loop lives in memory, so run **exactly one instance** with a **persistent disk** for `/data`. Serverless platforms won't work. The `Dockerfile` builds the app and starts it in live mode (`DATA_SOURCE=dexscreener`, `DATA_DIR=/data`, port 3000).

**Railway**
1. Create a service from this repo. `railway.json` selects the Dockerfile, the `/api/health` check and one replica.
2. Add a **Volume** mounted at `/data`.
3. Add your `NEXT_PUBLIC_*` variables. They are passed to the build as Docker build args.
4. Deploy, then attach a domain.

**Fly.io**
```bash
fly launch --no-deploy                       # generates fly.toml from the Dockerfile
fly volumes create agent_data --size 1
# in fly.toml:  [mounts] source = "agent_data"  destination = "/data"
#               internal_port = 3000, min_machines_running = 1, auto_stop_machines = false
fly deploy --build-arg NEXT_PUBLIC_CONTRACT_ADDRESS=0x...
```

**VPS / any Docker host**
```bash
docker build -t survival-agent --build-arg NEXT_PUBLIC_CONTRACT_ADDRESS=0x... .
docker run -d --name survival-agent --restart unless-stopped -p 3000:3000 -v agent-data:/data survival-agent
```
Put it behind HTTPS (Caddy, nginx, or the platform's proxy), and make sure the proxy doesn't buffer `/api/stream`.

---

## Where this intentionally differs from the reference site

- **Jar values:** the reference shows hardcoded levels (80% and 76%) that contradict its own formula; its VC floor at n = 2,346 is 0.500, an empty jar. Here every number is computed.
- **LIVE label:** the reference labels its feed LIVE regardless of source. Here simulated data is labelled simulated, and live mode warms up honestly.
- **Pause:** the reference's Pause button does nothing. Here it freezes the feed and the code panel.
- **Fill to target:** the reference's preset leaves a VC jar at 0%. Here it finds evidence that actually reaches the target.
- **Console threshold:** the reference says "$20K" but counts $30K passes. Here $30K is used everywhere.
- **Gates:** displayed gate thresholds match the enforced ones.
- **Commitments:** the reference's offline commitment hashes were placeholders. Here they are real sha256 and verifiable.
- **Bootstrap floor:** computed on out-of-fold predictions.
- **Branding:** all copy, the illustration, the logo and the code are original. No reference branding, assets, contract address, social links or credentials are included.

## Layout

```
src/
  app/          layout, providers, pages (server components), api/* route handlers, github|x|twitter redirects
  views/        client views for each page
  components/   shell/ overview/ analytics/ ideas/ lab/ layout/ ui/
  client/       live.ts: /api/state snapshot + /api/stream SSE into the store
  server/       runtime (singleton agent), agent, config, persist, serialize, sourceBlocks, sources/{simulated,dexscreener}
  engine/       simulator, features, model (IRLS), trainer, ideas, ledger, proof, findings, sanitize
  math/         stats, auc, bounds, sha256
  config/ store/ hooks/ lib/
  instrumentation.ts   starts the agent when the server boots
data/           state.json + commitments.jsonl (git-ignored)
```

*The agent is a mascot, not a financial adviser. This measures survival, not price.*
