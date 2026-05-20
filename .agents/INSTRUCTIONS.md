# Charlie's Cleaners — AI Voice Agent
## Session Context for Fresh Starts

Read README.md for full architecture. This file has what README omits: state, gotchas, decisions, next steps.

---

## Current State (as of 2026-05-19)

**Branch:** `voice-agent`
**Voice server:** Working. Run `npm run dev` on a persistent machine with ngrok.
**Dashboard:** Code exists (`src/dashboard.ts` + `public/index.html`) — Vercel deploy not yet validated end-to-end.
**Notion Worker pollers:** Code exists (`src/index.ts`) — NOT deployed. `ntn deploy` not run yet.

### What's confirmed working
- Inbound calls (consumer + owner) — tested repeatedly, live
- Role detection via Supabase `callers` table (owner phone → OWNER_TOOLS, everyone else → CONSUMER_TOOLS)
- All 18 Notion tools executing correctly
- Clean call termination via `hangUp` tool → 3.5s delay → Twilio REST hangup
- Wi-Fi reconnect recovery — 8s buffer before `completeSession()`
- Anti-hallucination: `temperature=0`, strict "NEVER state unless from tool" prompt rules
- Outbound calls via `/outbound` route + `triggerPickupCall` tool — architecture correct; test against live data needed

### What's NOT done
- Notion Worker pollers (`callbackPoller`, `pickupPoller`) — not deployed to Notion Workers
- Dashboard Vercel deploy — not tested in prod
- Persistent voice server host — still on local + ngrok

---

## File Map (non-obvious parts)

| File | Role |
|------|------|
| `src/server.ts` | Express + WebSocket server (voice agent only) |
| `src/index.ts` | Notion Worker entry — `callbackPoller` + `pickupPoller` — deploy via `ntn deploy` |
| `src/dashboard.ts` | Vercel serverless — all `/api/dashboard/*` routes |
| `src/services/notion/worker.ts` | ALL Notion reads/writes — `callWorkerTool()` dispatcher |
| `src/services/gemini/liveSession.ts` | Gemini Live session lifecycle |
| `src/services/gemini/tools.ts` | `FunctionDeclaration[]` for Gemini + `executeTool()` |
| `src/services/gemini/systemPrompt.ts` | `CONSUMER_SYSTEM`, `OWNER_SYSTEM`, `buildOutboundSystem()` |
| `src/services/gemini/audioConverter.ts` | μ-law 8kHz ↔ PCM 16/24kHz |
| `src/routes/mediaStream.ts` | WebSocket handler — Twilio ↔ Gemini audio bridge |
| `public/index.html` | Dashboard SPA — vanilla HTML/JS, no build step |
| `CLAUDE.md` | Symlink → `.agents/INSTRUCTIONS.md` (this file) |

---

## Gotchas

**ngrok URL changes on every restart.**
- Update `TWILIO_WEBHOOK_BASE` and `BASE_URL` in `.env`
- Also update Twilio console voice webhook (inbound calls)
- Nodemon only watches `*.ts` — type `rs` in nodemon terminal after `.env` change
- `triggerPickupCall` in `worker.ts` reads `process.env.TWILIO_WEBHOOK_BASE` at call time — stale URL = Twilio 404 error = "application error" voice

**Notion `dataSources` API is non-standard (internal Notion API).**
- Used for queries: `(notion as any).dataSources.query({ data_source_id: ds("ORDERS_DATA_SOURCE_ID"), filter: {...} })`
- `ORDERS_DATA_SOURCE_ID`, `PRICING_DATA_SOURCE_ID`, `CALLBACKS_DATA_SOURCE_ID`, `ARCHIVE_DATA_SOURCE_ID` come from `ntn datasources resolve <db-id>`
- `CALLBACKS_DATABASE_ID` is raw Notion DB ID — used only for `notion.pages.create()` (creates new callback rows)
- Both IDs are needed; they are different values for the same DB

**STATUS in Callbacks DB is `rich_text` NOT `select`.**
- Fixed in commit `390e1ae`
- Filter: `{ property: "STATUS", rich_text: { equals: "Pending" } }` (not `select:`)
- Write: `{ rich_text: [{ type: "text", text: { content: "Pending" } }] }` (not `select:`)

**Supabase schema is applied. All columns exist.**
- `call_sessions`: `call_sid`, `caller_phone`, `caller_role`, `messages`, `turn_count`, `status`, `is_outbound`, `outbound_context`, `created_at`, `updated_at`
- `callers`: at least `phone_number`, `role`, `name`
- Owner phone seeded: `OWNER_PHONE_NUMBER` in `.env` must match the `callers` table row

**`createSession()` swallows Supabase errors silently.**
- `supabase.from().insert()` returns `{ error }` but `createSession` never checks it
- If insert fails, `getSession()` returns null, WebSocket closes, Twilio plays "application error"
- Safe for now (schema is correct), but worth adding `.throwOnError()` before shipping

**`NODE_ENV=development` skips Twilio request signature validation.**
- Never deploy to prod with `NODE_ENV=development`
- Set to `production` and ensure `TWILIO_WEBHOOK_BASE` exactly matches the Twilio webhook URL (including protocol, no trailing slash) or signature validation will fail

**Gemini model name:** `gemini-3.1-flash-live-preview`
- Voice: `Aoede`
- VAD: `START_SENSITIVITY_LOW` + `END_SENSITIVITY_LOW` + `silenceDurationMs: 700`
- `temperature: 0` — do not raise; hallucination risk is real at higher values

**Opening cue sent via `liveSession.sendRealtimeInput({ text: "..." })`** — not `sendClientContent`. If Gemini waits for caller to speak instead of greeting, switch to `sendClientContent`.

**`ARCHIVE_DATA_SOURCE_ID` is set in `.env` and `config.ts` but not used in any tool yet.** It's seeded for a future "show closed orders" feature.

---

## Decisions Made

| Decision | What | Why |
|----------|------|-----|
| Gemini 3.1 Flash Live | Voice model | Native audio-in/audio-out, no STT/TTS roundtrip, native tool use |
| Aoede voice | TTS voice | Warmest/most natural for customer service |
| `temperature=0` | Gemini config | Hallucination on order data caused real UX bugs in testing |
| 3.5s hangup delay | After `hangUp` tool | Goodbye audio must play before REST hangup or caller hears silence |
| 8s reconnect window | Wi-Fi drops | Twilio reconnects within ~4s; 8s gives buffer before `completeSession()` |
| `rich_text` for STATUS | Callbacks DB | Actual Notion DB schema — `select` type was never set |
| No `getOrderByPhone` auto-call | System prompt | Was auto-calling on every inbound → hallucinated data when no match |
| `dataSources.query` not `databases.query` | Notion API | Notion public API doesn't support the same filter operators; internal API required |
| Supabase for sessions | Not Notion | Low-latency key-value for call state; Notion has rate limits and latency |

---

## Next Build Steps (in order)

1. **Test outbound flow end-to-end**: owner calls in → says "call the customer for ORD-XXXX" → `triggerPickupCall` fires → customer receives call. Verify Notion `NOTIFIED_AT` stamped.

2. **Deploy dashboard to Vercel**: `vercel deploy` from project root. Set all env vars in Vercel dashboard. Test `/api/dashboard/orders`, `/api/dashboard/callbacks`, approve flow.

3. **Deploy Notion Worker pollers**: `ntn workers env push && ntn deploy`. Verify `callbackPoller` auto-dials after STATUS flips to "Approved". Verify `pickupPoller` runs every 10 min.

4. **Persistent voice server host**: Railway / Render / EC2. Remove ngrok. Update `TWILIO_WEBHOOK_BASE` to stable URL. Set `NODE_ENV=production`.

5. **Add Supabase error surfacing in `createSession`**: add `.throwOnError()` or check `r.error` and throw — prevents silent session-not-found failures.

---

## Running Locally

```bash
npm run dev                    # starts on port 3000, watches src/**/*.ts
# in separate terminal:
ngrok http 3000                # copy the https URL
# update .env: TWILIO_WEBHOOK_BASE=https://<new-url>
# update .env: BASE_URL=https://<new-url>
# type `rs` in nodemon terminal to restart with new env
# update Twilio console: Voice webhook → https://<new-url>/voice (POST)
```

**Owner phone:** `OWNER_PHONE_NUMBER` in `.env`. Call the Twilio number from this phone to get owner tools.

**Trigger outbound manually** (for testing):
```bash
curl -X POST http://localhost:3000/outbound \
  -H "Content-Type: application/json" \
  -d '{"phone":"+1XXXXXXXXXX","customerName":"John Smith","orderId":"ORD-0010"}'
```
