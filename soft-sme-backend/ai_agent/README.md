# AI Agent Schema Introspection

The AI SQL tool now introspects the live PostgreSQL schema for the tables that the
LLM is allowed to query. The schema description that is injected into prompts is
rebuilt automatically and cached for a configurable TTL.

## Configuration

Set the following environment variables to control schema behaviour:

| Variable | Description |
| --- | --- |
| `AI_SQL_ALLOWED_TABLES` | Comma-separated list of tables that the SQL tool may introspect and query. Defaults to the previous hard-coded allowlist. |
| `AI_SQL_DENY_COLUMNS` | Optional comma-separated list of sensitive columns to hide from prompts. |
| `AI_SCHEMA_TTL_MINUTES` | Cache lifetime for schema metadata. Defaults to `15`. |
| `AI_FUZZY_FIELDS` | Comma-separated list of text columns that may use fuzzy fallback logic. Defaults to `vendor_name,customer_name,part_name`. |
| `AI_SQL_ALIAS_MAP` | JSON mapping of alias column names to canonical columns (e.g. `{ "address": ["street_address","city","province","postal_code"] }`). |
| `AI_SCHEMA_REFRESH_SECRET` | Optional shared secret that allows trusted callers to force a schema refresh. |
| `AI_SCHEMA_LISTEN_CHANNEL` | (Optional) PostgreSQL `LISTEN/NOTIFY` channel name if external triggers should force schema refreshes. |

## Manual refresh

The Node backend exposes `POST /api/agent/v2/schema/refresh`. Requests must come
from an authenticated admin or include the `x-refresh-secret` header that matches
`AI_SCHEMA_REFRESH_SECRET`. The backend forwards the refresh to the Python
agent, which rebuilds the schema cache immediately.

## Observability

Each SQL tool invocation logs telemetry to `/api/agent/v2/analytics/events`
including:

- `schema_version` and `schema_hash`
- `refresh_reason` and `retry_count`
- whether a fuzzy lookup ran (`used_fuzzy`) and any alias rewrites
- `rows_returned`

Additional counters emit when schema refresh-on-error, fuzzy fallbacks, and DDL
mismatch failures occur. These events allow dashboards and alerts to track
schema health.

