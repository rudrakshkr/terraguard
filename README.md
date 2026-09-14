# HillSense AI

**AI-powered disaster intelligence for mountain communities.**

HillSense AI is a disaster-intelligence and response copilot for hilly regions like Himachal
Pradesh. A reporter submits an incident with an **image, text, or voice** description; AI
classifies the incident, retrieves grounded safety guidance from a local knowledge base (RAG),
produces actionable recommendations, and generates a structured, downloadable incident report.
A **Command Center** dashboard maps incidents, charts severity, and manages response status.

> Engineering-Day prototype. Outputs are **decision support**, never official emergency
> instructions. Knowledge-base documents are **sample reference material**, not government
> publications. In a real emergency, call 112.

---

## Quick start

```bash
npm install
cp .env.example .env.local   # optional — add LLM_API_KEY for real AI
npm run dev                  # http://localhost:3000
```

**No API key? The app still works end-to-end.** A deterministic heuristic engine classifies
reports and BM25 lexical retrieval powers RAG — the UI clearly labels this as *Heuristic mode*.

**Default provider is Google Gemini (free tier).** Grab a key at
[aistudio.google.com/apikey](https://aistudio.google.com/apikey), then:

```bash
cp .env.example .env.local   # paste your Gemini key
npm run dev
```

Any other OpenAI-compatible provider (OpenAI, OpenRouter, Groq, Ollama) works by overriding
`LLM_BASE_URL` / `LLM_MODEL` — see `.env.example`.

## Running it live (phones, demo, production)

**Local dev** — nothing to configure; data persists in `.hillsense-*.json` files.

**On your phone over the same Wi-Fi** — open `http://<your-lan-ip>:3000` from the phone.
Note that browser geolocation requires HTTPS (or localhost), so use a tunnel for the full
"Use my location" experience.

**Deployed (two phones, judges, the real deal)** — the app is Vercel-ready. Serverless
instances share data through a storage backend detected automatically at runtime:

1. **Vercel Blob (recommended, zero extra setup):** `vercel link && vercel storage connect
   <store>` — done. Mutations are serialized through a create-only lease file, so
   concurrent users can never clobber each other's reports, confirmations, or sessions.
2. **Upstash Redis (alternative):** set `UPSTASH_REDIS_REST_URL` +
   `UPSTASH_REDIS_REST_TOKEN`; writes use Lua compare-and-set.

Then add `LLM_API_KEY` for live AI verification (and `SMS_PROVIDER_API_URL`/
`SMS_PROVIDER_API_KEY` only if you want real SMS OTP delivery), deploy, and open the URL
on any phone — all clients see the same live data. Locally (`npm run dev`) the plain
JSON-file store is used and none of this is required.

Run the storage test suite (both backends, concurrency-proven):

```bash
npm run test:kv
```

## The 60-second demo script

1. **Landing page** (`/`) — hero, how-it-works, example scenario pipeline.
2. **Report an Incident** (`/report`) — click **Scenario 1: Landslide — Kullu**, press
   **Analyze with AI**. Watch the pipeline steps, then the verdict: type, severity, confidence,
   risk factors, immediate actions, things to avoid — plus the *retrieved sources* panel showing
   exactly which knowledge-base passages grounded the recommendations.
3. Optionally attach a **photo** of a landslide (or record a **voice** description — English or
   हिन्दी) before analyzing.
4. **Save to Command Center** → opens the printable **Incident Report** → *Download PDF*.
5. **Command Center** (`/dashboard`) — stat cards, severity/type charts, the incident map with
   severity-colored markers (click one for a summary popup), filterable incidents table with
   live status changes (Open → Responding → Resolved).
6. **Ask HillSense** (`/ask`) — "What are the warning signs of a possible landslide?" — the
   answer cites its sources.
7. The three **demo scenarios** (Landslide / Flash Flood / Rockfall) exist precisely so the
   full pipeline can be shown even if the network or API is unavailable.

## Architecture

```
UI (Next.js App Router, React, TS, Tailwind)
  ↓
API routes  /api/analyze · /api/ask · /api/incidents · /api/incidents/:id · /api/rag-status
  ↓
Incident Analysis Service (lib/hillsense.ts)
  ├─ RAG Service (lib/rag.ts)        — chunk KB markdown → embed (API or local fallback)
  │                                    → cosine retrieval → context block
  ├─ Multimodal classification       — vision-capable LLM, strict JSON output
  ├─ Grounded recommendation pass    — recommendations conditioned on retrieved passages
  └─ Heuristic fallback (lib/fallback.ts) — deterministic classifier when AI is unavailable
  ↓
LLM (Google Gemini by default — free tier, via its OpenAI-compatible layer;
any OpenAI-compatible API works: OpenAI / OpenRouter / Groq / Ollama)
  ↓
Structured result → JSON-file persistence (.hillsense-incidents.json)
```

Report workflow: **user input → preprocessing (image downscale) → multimodal LLM → structured
classification → RAG retrieval → grounded recommendations → report generation → dashboard
persistence.**

### Design decisions

- **No LangChain, no vector DB, no external services.** Retrieval is ~150 lines of TypeScript
  over a tiny persisted vector store — trivially demonstrable and auditable.
- **Fail-soft everywhere.** Missing key, LLM timeout, provider 4xx/5xx, invalid image, RAG
  failure — every path degrades to a working, honestly-labelled mode. No stack traces in the UI.
- **Grounding is visible.** Every analysis and answer shows the retrieved passages with
  similarity scores, plus a "grounded in provided sources" indicator.
- **Persistence** is a JSON file — deliberately boring for a one-day demo. Swap `lib/store.ts`
  for SQLite/Postgres later without touching the UI.

## Knowledge base

`knowledge-base/*.md` — seven sample reference documents (landslide, flash flood, road blockage,
evacuation, preparedness, mountain travel, Himachal disaster management). Each is clearly headed
**"Sample reference material … Not an official government publication."** Retrieved chunks are
shown verbatim in the sources panel.

## Voice input

Browser Speech Recognition (Web Speech API) — no audio pipeline. Works in Chrome/Edge; the UI
gracefully explains and degrades to typing elsewhere. Choose English or हिन्दी before recording;
the transcription lands in the description box, editable before analysis.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server at `http://localhost:3000` |
| `npm run build && npm start` | Production build |
| `npm run lint` | ESLint |

## Troubleshooting

- **"Heuristic mode — no API key"** badge: add your Gemini key (`LLM_API_KEY`) to `.env.local` and restart.
- **Voice button disabled**: use Chrome/Edge, or type the description.
- **Map tiles blank**: Leaflet loads OpenStreetMap tiles live — check network access.
- **First AI call is slow**: the vector store builds once, then persists to `.hillsense-store.json`.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Recharts · Leaflet +
OpenStreetMap · jsPDF · OpenAI-compatible LLM API · RAG (embeddings + cosine retrieval)
