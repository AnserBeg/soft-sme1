# Entity Resolution Telemetry

## Event Fields

The orchestrator emits `entity_resolution` events with the following statuses:

- `canonical_exact_hit` – canonical part number lookup resolved the entity without ambiguity.
- `fuzzy_auto_pick` – the highest scoring fuzzy match exceeded the auto-pick threshold.
- `fuzzy_disambiguate` – multiple candidates were returned and surfaced for manual selection.
- `fuzzy_no_match` – no candidates were returned from the fuzzy search API.

Each event includes the following metrics to support Grafana dashboards:

| Field | Description |
| --- | --- |
| `entity_type` | Customer, vendor, or part entity category. |
| `query_len` | Length of the original query string supplied by the LLM. |
| `top_score` | Highest fuzzy score (1.0 for canonical matches). |
| `candidate_count` | Number of candidates returned by the resolver. |
| `took_ms` | Milliseconds spent evaluating the lookup (API round trip or canonical query). |

## Aggregated View

The migration `20250331013000_create_entity_resolution_metrics_view.sql` publishes the
`agent_entity_resolution_match_stats` view for Grafana. It aggregates match rates and
average scores per hour and entity type:

```sql
SELECT
  bucket_hour,
  entity_type,
  match_rate,
  matched_count,
  disambiguate_count,
  no_match_count,
  avg_top_score,
  avg_candidate_count,
  avg_took_ms
FROM agent_entity_resolution_match_stats
ORDER BY bucket_hour DESC, entity_type;
```

Import this query into Grafana using the PostgreSQL data source to visualize entity
resolution accuracy and latency trends.
