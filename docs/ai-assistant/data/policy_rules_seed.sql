-- Seed policy rules supporting the deterministic safety subagent evaluation layer.
-- Run these statements in the ai_guardrails schema (e.g., via pgAdmin) to backfill core guardrails.

insert into ai_guardrails.policy_rules (
    name,
    severity,
    policy_tags,
    message,
    resolution,
    requires_manual_review,
    fallback_step,
    match_all_keywords,
    match_any_keywords,
    match_pending_action_slugs,
    priority,
    company_id
) values (
    'privacy_email_export_block',
    'block',
    array['privacy', 'export'],
    'Request exposes personally identifiable information without an approved ticket.',
    'Escalate to compliance queue before fulfilling.',
    true,
    'create-compliance-task',
    array['customer', 'email'],
    array[]::text[],
    array[]::text[],
    100,
    null
) on conflict (name) do update set
    severity = excluded.severity,
    policy_tags = excluded.policy_tags,
    message = excluded.message,
    resolution = excluded.resolution,
    requires_manual_review = excluded.requires_manual_review,
    fallback_step = excluded.fallback_step,
    match_all_keywords = excluded.match_all_keywords,
    match_any_keywords = excluded.match_any_keywords,
    match_pending_action_slugs = excluded.match_pending_action_slugs,
    priority = excluded.priority,
    company_id = excluded.company_id;

insert into ai_guardrails.policy_rules (
    name,
    severity,
    policy_tags,
    message,
    resolution,
    requires_manual_review,
    fallback_step,
    match_all_keywords,
    match_any_keywords,
    match_pending_action_slugs,
    priority,
    company_id
) values (
    'finance_wire_warn',
    'warn',
    array['finance'],
    'Potential financial transfer detected. Confirm dual authorization before proceeding.',
    'Confirm finance approval before executing payment steps.',
    false,
    null,
    array[]::text[],
    array['wire transfer', 'routing number', 'bank account'],
    array[]::text[],
    90,
    null
) on conflict (name) do update set
    severity = excluded.severity,
    policy_tags = excluded.policy_tags,
    message = excluded.message,
    resolution = excluded.resolution,
    requires_manual_review = excluded.requires_manual_review,
    fallback_step = excluded.fallback_step,
    match_all_keywords = excluded.match_all_keywords,
    match_any_keywords = excluded.match_any_keywords,
    match_pending_action_slugs = excluded.match_pending_action_slugs,
    priority = excluded.priority,
    company_id = excluded.company_id;
