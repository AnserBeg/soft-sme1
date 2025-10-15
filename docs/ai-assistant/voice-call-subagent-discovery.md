# Voice/Call Subagent Discovery Notes

## Telephony entry points

| Surface | Path / Trigger | Description | Auth / Feature Flags | Downstream dependencies |
| --- | --- | --- | --- | --- |
| REST | `POST /api/voice/call-vendor` | Planner-triggered endpoint to open a vendor call session that returns LiveKit/Telnyx metadata. Wraps `VoiceService.initiateVendorCall` to seed `vendor_call_sessions`, enrich with purchase/vendor context, and optionally place a Telnyx call. | Protected by `authMiddleware`; gated by `ENABLE_VENDOR_CALLING`. Requires Telnyx env vars for auto-dial. | `purchasehistory`, `vendormaster`, `vendor_call_sessions`, Telnyx API, LiveKit SIP ingress. |
| REST | `POST /api/voice/vendor-call/webhook` | Provider webhook for streaming transcripts, captured email, and status updates. Persists via `VoiceService.recordVendorCallEvent`, updating transcripts/captured email/status and cascading to structured summaries. | Typically configured with provider signature validation (future hardening). | `vendor_call_events`, `vendor_call_sessions`, `agent_messages` (summary fan-out). |
| REST | `POST /api/voice/vendor-call/:sessionId/send-po` | Utility endpoint to email PO PDFs after the call. Leverages `VoiceService.sendPurchaseOrderEmail`. | Protected by `authMiddleware`. | `purchasehistory`, `purchaselineitems`, email delivery service (out of scope here). |
| REST | `GET /api/voice/vendor-call/:sessionId` | Fetches call session with optional event history for UI/analytics. | Protected by `authMiddleware`. | `vendor_call_sessions`, `vendor_call_events`. |
| WebSocket | `ws://.../api/voice/stream?session_id=...` | Twilio/Telnyx media stream ingress. `GeminiLiveBridge` buffers audio, calls Gemini Live, and invokes helper functions (`set_pickup_time`, etc.). | Enabled when Express WS instance is present and `ENABLE_VENDOR_CALLING` not disabled. Session-scoped auth should be layered via signed URLs. | `GeminiLiveBridge`, `vendor_call_sessions`, `purchasehistory`. |
| Service | `VoiceService` | Core orchestrator for session lifecycle—call initiation, event ingestion, post-call summaries, PO emailing. | Requires PostgreSQL pool and optional Telnyx/Google generative AI credentials. | DB tables above, Gemini API, Telnyx API. |
| Service | `GeminiLiveBridge` | Handles real-time transcription + function-calling from Gemini Live to update sessions and purchase orders. | Depends on Gemini Live credentials and stable WebSocket session. | `vendor_call_sessions`, `purchasehistory`. |

## Proposed call-handling contract

The planner should treat the voice subagent as a long-running workflow with explicit lifecycle hooks. Suggested contract:

```json
{
  "name": "voice_vendor_call",
  "input": {
    "purchaseId": "number",
    "agentSessionId": "number | null",
    "goals": ["capture_vendor_email", "confirm_pickup", "collect_part_notes"],
    "metadata": {
      "priority": "normal | urgent",
      "contactStrategy": "dial_out | wait_for_webhook"
    }
  },
  "output": {
    "sessionId": "number",
    "status": "initiated | connected | completed | failed",
    "structuredNotes": {
      "email": "string | null",
      "pickup_time": "string | null",
      "parts": [
        { "part_number": "string", "quantity": "number", "notes": "string | null" }
      ],
      "summary": "string | null",
      "next_steps": ["string"]
    },
    "transcriptUrl": "string | null",
    "events": [
      { "type": "status", "payload": { "status": "string", "at": "timestamp" } },
      { "type": "function_call", "payload": { "name": "string", "args": {} } },
      { "type": "telnyx_call_initiated", "payload": {} }
    ]
  },
  "callbacks": {
    "onStatusChange": {
      "status": "string",
      "timestamp": "ISO8601",
      "notes": "string | null"
    },
    "onStructuredUpdate": {
      "summary": "VoiceStructuredNotes",
      "source": "transcript | agent_manual | function_call"
    }
  }
}
```

### Planner invocation flow
1. Planner evaluates context and issues `voice_vendor_call` task with `purchaseId` + goals.
2. Subagent calls `POST /api/voice/call-vendor`, storing the returned `sessionId` and telephony metadata.
3. Subagent registers WebSocket/media stream listeners (or provides credentials to front-end agent) and subscribes to webhook updates.
4. As webhook events arrive, subagent emits `onStatusChange`/`onStructuredUpdate` callbacks to the orchestrator so the main conversation stays synchronized.
5. Upon completion, subagent returns the `output` payload with final notes + transcript pointer. Planner can follow up by triggering `send-po` if goals require.

This contract separates initiation from monitoring, allowing retries, circuit breakers, and dead-letter handling when telephony providers misbehave. It also makes the planner explicit about goals, so the subagent can adapt prompts/function calls in `GeminiLiveBridge` accordingly.

## Telemetry and observability requirements

To keep planner outputs observable and resilient:

- **Session lifecycle metrics**
  - Emit counters for `voice.session.started`, `voice.session.connected`, `voice.session.completed`, `voice.session.failed` tagged by provider (`telnyx`, `livekit`), agent, and purchase category.
  - Track durations (`voice.session.duration_seconds`) using timestamps from `vendor_call_sessions` to detect abnormal call lengths.
- **Event audit trail**
  - Persist every webhook event and Gemini function call in `vendor_call_events` with normalized schemas (ensure JSONB columns are validated). Add an index on `(session_id, created_at)` for replay efficiency.
  - Attach orchestrator correlation IDs so planner logs can be joined with telephony events.
- **Callback delivery logs**
  - When the voice subagent emits planner callbacks, log success/failure with retry metadata. Store in `agent_messages` or a dedicated `agent_callbacks` table to support replay.
- **Alerting hooks**
  - Define thresholds: e.g., >3 failed call initiations per hour triggers alert; no transcript ingestion within 2 minutes after `connected` triggers warning to operator.
- **Structured prompts + configuration checks**
  - Hash and log prompt versions used in `GeminiLiveBridge` so regressions are traceable.
  - Validate environment variables at startup (`TELNYX_API_KEY`, `LIVEKIT_SIP_INGRESS_NUMBER`, `GEMINI_API_KEY`) and surface health endpoints for missing deps.

Together, these telemetry layers ensure that even when providers drop calls or webhooks lag, the orchestrator can detect issues quickly and retry or escalate.

## Next steps

1. Implement voice subagent skeleton that conforms to the contract (task orchestration, retry policy, callback dispatch).
2. Add schema migrations for telemetry enhancements (indexes, callback log table, provider configuration health table).
3. Integrate planner policy to decide between voice vs. email outreach based on vendor metadata and past call success.
