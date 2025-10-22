-- Aggregated entity resolution telemetry for Grafana dashboards
CREATE OR REPLACE VIEW agent_entity_resolution_match_stats AS
SELECT
  date_trunc('hour', occurred_at) AS bucket_hour,
  COALESCE(metadata->>'entity_type', 'unknown') AS entity_type,
  COUNT(*) FILTER (WHERE status IN ('canonical_exact_hit', 'fuzzy_auto_pick')) AS matched_count,
  COUNT(*) FILTER (WHERE status = 'fuzzy_disambiguate') AS disambiguate_count,
  COUNT(*) FILTER (WHERE status = 'fuzzy_no_match') AS no_match_count,
  COUNT(*) AS total_events,
  CASE
    WHEN COUNT(*) = 0 THEN 0
    ELSE ROUND(COUNT(*) FILTER (WHERE status IN ('canonical_exact_hit', 'fuzzy_auto_pick'))::numeric / COUNT(*), 4)
  END AS match_rate,
  AVG(NULLIF(metadata->>'top_score', '')::numeric) AS avg_top_score,
  AVG(NULLIF(metadata->>'candidate_count', '')::numeric) AS avg_candidate_count,
  AVG(NULLIF(metadata->>'took_ms', '')::numeric) AS avg_took_ms
FROM agent_event_logs
WHERE event_type = 'entity_resolution'
  AND status IN ('canonical_exact_hit', 'fuzzy_auto_pick', 'fuzzy_disambiguate', 'fuzzy_no_match')
GROUP BY 1, 2;
