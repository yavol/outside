# OUTSIDE

**A map you can talk to. A coastal escape shaped around what is actually outside.**

OUTSIDE is a Vercel Fast Forward hackathon project by Yaroslav Volovich. Describe your kind of day, compare three California beaches using USGS camera snapshots and National Weather Service forecasts, then build a small gear bag around your budget and what you already own.

The project lives at [github.com/yavol/outside](https://github.com/yavol/outside). See the [90-second demo guide](docs/demo.md).

## What works

- **Conversational planning:** choose Cowell Beach, Santa Cruz Main Beach, or Sunset State Beach; compare available forecasts; preserve your destination, budget, and explicitly owned gear.
- **A map with evidence:** MapLibre, OpenFreeMap, approximate beach pins, public USGS snapshots, forecast cards, source links, and source timestamps.
- **Two visual inputs:** ask a vision model to describe the selected camera frame, or show a jacket, backpack, or water bottle to avoid shopping for a duplicate. Ownership requires confirmation; manual selection is also available.
- **Real products:** Shop by Shopify's public MCP catalog supplies product images, merchants, prices, stock, and variants. Requests can filter by budget, blue color, and lower price tier.
- **A complete test checkout:** selected variants and stock are fetched again, the USD budget is checked in integer cents, and the app issues a local test receipt. No payment is collected and no merchant order or cart is created.
- **A saved escape:** destination, budget, owned categories, and bag are stored in this browser's local storage and can be restored from **My escapes**.
- **Provider resilience:** Vercel AI Gateway is preferred; alternate models and optional direct Gemini requests provide fallback. Replies show the actual model and elapsed time. A local planner remains available when model requests fail.

## Run locally

Use Node.js 24 and npm.

```sh
git clone git@github.com:yavol/outside.git
cd outside
npm install
cp .env.example .env.local
npm run dev
```

Open [localhost:3000](http://localhost:3000). Add an AI credential to `.env.local` for conversation and image analysis. Public map, USGS, NWS, and Shop catalog requests do not need an application API key.

| Variable | Purpose |
| --- | --- |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway credential for local development or an explicitly configured deployment. |
| `VERCEL_OIDC_TOKEN` | Optional Vercel-issued deployment token; the app can use it automatically when available. Do not commit a token. |
| `GEMINI_API_KEY` | Optional direct Gemini provider, including local development and fallback. `GOOGLE_GENERATIVE_AI_API_KEY` is accepted as an alias. |
| `OUTSIDE_GATEWAY_MODEL` | Gateway primary model; default `google/gemini-3.8-flash`. |
| `OUTSIDE_GATEWAY_FALLBACK_MODEL` | Gateway alternate model; default `openai/gpt-5.4-mini`. |
| `OUTSIDE_GEMINI_MODEL` | Direct Gemini primary model; default `gemini-3.8-flash`. |
| `OUTSIDE_GEMINI_FALLBACK_MODEL` | Direct Gemini alternate model; default `gemini-2.5-flash`. |

Model names can be changed to models available to your provider account. Keys stay in server environment variables. Without a working model credential, conversation uses the labeled local planner and image analysis reports that it is unavailable. Manual owned-gear selection still works.

Run the project checks with:

```sh
npm run check
npm test
npm run build
```

`npm test` runs Node's TypeScript test runner against input validation, provider fallback, ownership state, image validation, live-catalog response parsing, variant selection, and checkout budget checks. The tests use controlled provider responses; they do not establish deployment health or merchant availability.

## Architecture

The app is a Next.js App Router application with React, TypeScript, MapLibre GL, and server route handlers. No database is required.

| Route | Responsibility |
| --- | --- |
| `GET /api/conditions` | Fetch and cache USGS camera metadata, NWS hourly forecasts, astronomical times, and active weather alerts. Optional `ids=cowells,main-beach,sunset` limits the destinations. |
| `POST /api/agent` | Fetch server-side conditions, resolve explicit trip facts, compare forecast preferences, and request a structured planner reply. |
| `POST /api/vision` | Analyze an approved USGS image or a validated JPG, PNG, or WebP upload up to 3 MB. |
| `GET /api/shop` | Query the fixed Shop MCP catalog endpoint with category, price, color, and availability filters. |
| `POST /api/checkout` | Refresh selected catalog variants, verify stock and budget, and return a test receipt. |
| `GET /api/health` | Report configured provider flags and selected planner capability without returning credentials. |

`src/lib/conditions.ts` keeps forecast guidance separate from camera metadata. `src/lib/agent.ts` handles provider calls, bounded input, structured responses, and a local state-preserving planner. `src/lib/shop.ts` handles Shop MCP responses and monetary calculations. Client state lives in `src/components/outside-app.tsx`; the interactive map lives in `src/components/coastal-map.tsx`.

Gateway calls use its OpenAI-compatible chat completions endpoint. Direct Gemini is optional. Each model attempt has a timeout; at most three configured attempts are made. **Agent settings → Try provider fallback** skips the primary attempt and makes a real alternate request. Browser voice input uses the Web Speech recognition API, and optional spoken replies use `speechSynthesis`; Whisper, Gateway transcription, and a Jev evaluation integration are not configured.

## Evidence and scope

USGS publishes **still snapshots**, roughly every 30 minutes during daylight, with a 10–15 minute publication delay. The timestamp printed in each image is the capture reference. The API's `checkedAt`/`fetchedAt` indicate a source request; `lastModifiedAt` is the source file's HTTP update time. Those values are never substituted for capture time. `capturedAt` remains `null` when no machine-readable capture timestamp is available. Images older than two hours by file update time are labeled stale; an overnight image can therefore be stale even if the camera is operating normally.

NWS values are **hourly forecasts**, with their own forecast period and update time. They are not measurements from the beach camera. The application handles stale and unavailable sources explicitly. A still image cannot establish swimming safety, water quality, or future conditions. Current crowd levels are not independently measured.

The three destination pins are approximate. The dotted map line is a coastal guide, not road directions, a calculated itinerary, or an estimate of travel time. WebGL or tile failures show a labeled map preview.

Shop availability changes. Search can return partial results or no matching products. The bag cap covers the item subtotal; shipping and taxes are not estimated. Checkout is a demonstration with an explicit test-mode label. Saved trips exist only in the current browser and can become outdated. Gear photos are sent to the configured image provider for analysis; the app does not include the photos in saved trips.

Original sources:

- [USGS Santa Cruz cameras](https://www.usgs.gov/centers/pcmsc/science/using-video-imagery-study-coastal-change-santa-cruz-beaches)
- [USGS Sunset State Beach cameras](https://www.usgs.gov/centers/pcmsc/science/using-video-imagery-study-coastal-change-sunset-state-beach)
- [National Weather Service API](https://www.weather.gov/documentation/services-web-api)
- [Shop developer documentation](https://shop.dev/docs)
- [OpenFreeMap](https://openfreemap.org/) and [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)

## Deploy on Vercel

Import the GitHub repository **`yavol/outside`**, choose Next.js, and use **`main`** as the production branch. The Git remote is `origin` → `git@github.com:yavol/outside.git`. Add server environment variables in the Vercel project, then deploy. Vercel's automatic OIDC credential can be used when it is enabled and available to the project; otherwise configure an AI Gateway key. A direct Gemini key is optional.

After deployment, check `/api/health`, then exercise a planner reply, a camera analysis, catalog search, variant selection, and test checkout in the browser. A successful build or a provider flag alone does not verify those interactions. Deployment URLs and verification status should come from the actual Vercel deployment.
