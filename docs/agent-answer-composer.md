# Agent Answer Composer

The Answer Composer standardizes how SQL and related tools return data to the orchestrator and how the agent forms a final reply for users. This document describes the shared envelope structure, output expectations, telemetry, and configuration knobs.

## Tool result envelope

All read-only tools that surface structured data should return a JSON object with the following shape:

```json
{
  "type": "success" | "disambiguation" | "empty" | "error",
  "source": "database" | "doc" | "action",
  "query": {
    "entity_type": "vendor",
    "entity_name": "Parts for Truck Inc",
    "order_number": "PO-1001",
    "filters": [ { "field": "status", "value": "open" } ]
  },
  "rows": [ /* tabular result set when type === "success" */ ],
  "total_rows": 1,
  "candidates": [ /* disambiguation options when type === "disambiguation" */ ],
  "attempts": {
    "exact": true,
    "fuzzy": true,
    "schema_refreshed": false
  },
  "error": { "code": "PERMISSION_DENIED", "message": "User cannot read vendormaster" }
}
```

Notes:

- `query` captures the normalized inputs the tool used. Extra keys (e.g. `part_identifier`) are allowed.
- `rows` and `total_rows` are only meaningful for `success` envelopes.
- `candidates` is only required for `disambiguation` envelopes and should include the `id`, a human friendly `display_name`, and any lightweight context (city, status, etc.).
- `attempts` flags indicate which fallbacks the tool tried. Set `exact` when an exact lookup ran, `fuzzy` for partial/ILIKE queries, and `schema_refreshed` if the tool invoked a schema refresh retry.
- `error` should contain a stable `code` plus a non-sensitive message when `type === "error"`.

## Envelope examples

### Success

```json
{
  "type": "success",
  "source": "database",
  "query": { "entity_type": "vendor", "entity_name": "Parts for Truck Inc" },
  "rows": [
    {
      "vendor_id": 42,
      "vendor_name": "Parts for Truck Inc",
      "contact_person": "Mira Patel",
      "telephone_number": "555-0100",
      "email": "sales@parts.com"
    }
  ],
  "total_rows": 1,
  "attempts": { "exact": true, "fuzzy": false, "schema_refreshed": false }
}
```

### Disambiguation

```json
{
  "type": "disambiguation",
  "source": "database",
  "query": { "entity_type": "vendor", "entity_name": "Parts" },
  "candidates": [
    { "id": 42, "display_name": "Parts for Truck Inc", "city": "Calgary" },
    { "id": 77, "display_name": "Parts 4 Trucks Incorporated", "city": "Edmonton" }
  ],
  "attempts": { "exact": true, "fuzzy": true, "schema_refreshed": false }
}
```

### Empty

```json
{
  "type": "empty",
  "source": "database",
  "query": { "entity_type": "vendor", "entity_name": "Acme Parts" },
  "attempts": { "exact": true, "fuzzy": true, "schema_refreshed": true }
}
```

### Error

```json
{
  "type": "error",
  "source": "database",
  "query": { "entity_type": "vendor", "entity_name": "Parts" },
  "attempts": { "exact": true, "fuzzy": false, "schema_refreshed": false },
  "error": { "code": "PERMISSION_DENIED", "message": "Blocked by row level security" }
}
```

## What the Answer Composer does

- Transforms the envelope into a final user-facing message.
- Creates compact table previews for success responses (first _N_ rows and common columns).
- Numbers disambiguation options (up to the configured limit) and prompts the user to pick one.
- Adds a “What I tried” footnote for empty results based on the `attempts` flags.
- Suggests next actions when appropriate (e.g. create an order, retry with a longer search term, or add a missing record).
- Categorizes error responses (permissions vs schema refresh vs generic system failure).

### “What I tried”

The composer looks at `attempts` and emits bullet points for each `true` flag:

- `exact` → “Tried exact match.”
- `fuzzy` → “Also tried a partial (fuzzy) match.”
- `schema_refreshed` → “Refreshed schema and retried.”

If a flag is `false`, it is omitted. When `fuzzy` is `false`, the composer also recommends trying a longer or more specific name.

### Capabilities-driven guidance

Capabilities are injected from environment variables and control whether the composer offers to create new records:

- `AGENT_CAN_CREATE_VENDOR`
- `AGENT_CAN_CREATE_CUSTOMER`
- `AGENT_CAN_CREATE_PART`

If a capability is `true`, the “Next steps” section invites the user to ask the agent to create the entity. If `false`, the composer points to the manual UI path (e.g. “Vendors → Add New”).

## Telemetry

Every composed response records:

```json
{
  "response_mode": "success" | "disambiguation" | "empty" | "error",
  "attempts": { "exact": true, "fuzzy": false, "schema_refreshed": false },
  "candidates_count": 3,
  "provided_next_steps": true
}
```

This payload is written to `agent_event_logs` via the analytics logger. Additionally, when an empty response occurs after a fuzzy attempt, the `empty_with_fuzzy_attempted` counter is incremented to highlight residual misses.

## Configuration

| Environment variable | Purpose | Default |
| --- | --- | --- |
| `AGENT_CAN_CREATE_VENDOR` | Allows the composer to offer vendor creation instructions | `false` |
| `AGENT_CAN_CREATE_CUSTOMER` | Allows the composer to offer customer creation instructions | `false` |
| `AGENT_CAN_CREATE_PART` | Allows the composer to offer part creation instructions | `false` |
| `AI_RESPONSE_DISAMBIG_LIMIT` | Maximum number of disambiguation options displayed | `5` |
| `AI_RESPONSE_TABLE_PREVIEW_LIMIT` | Maximum number of rows shown in the table preview | `5` |

Tuning these values does not require a restart, but ensure they are present in the orchestrator process environment before launch.
