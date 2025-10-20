# AI Assistant Changelog

## Schema Introspection Refresh

- Dynamic schema cache replaces the static prompt snippet. The cache includes a
  stable `schema_hash` and timestamped `schema_version`.
- SQL tool prompts now embed the current schema version/hash and automatically
  retry once if a DDL mismatch is detected, refreshing the schema cache before
  retrying.
- Added fuzzy lookup fallbacks for vendor/customer/part name filters and alias
  rewrites for legacy column terminology.
- Introduced `/api/agent/v2/schema/refresh` (admin or shared-secret protected)
  so operators can rebuild the schema cache on demand.
- Telemetry records schema version/hash, refresh reasons, retry counts, fuzzy
  usage, alias rewrites, and rows returned. Counters emit for refresh-on-error,
  fuzzy fallbacks, empty fuzzy results, and DDL mismatch failures.
- Configuration variables documented in `soft-sme-backend/ai_agent/README.md`.
