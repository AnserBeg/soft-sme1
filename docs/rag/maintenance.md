# Maintenance and Update Guidelines

Keep the RAG corpus consistent as new features ship or fixes land. Apply these guardrails whenever documentation changes are made.

## Chunking & Formatting Rules

- Use clear heading hierarchy (H1/H2/H3) for deterministic chunk splits.
- Include Summary, Key Validations, Troubleshooting, and FAQs sections for every major topic.
- Favor bullet lists and tables for dense data to reduce token count.
- Avoid embedding large code blocks unless necessary; link to source instead.

## Update Workflow

1. Update the relevant source documentation (module guide, API reference, etc.).
2. Reflect the change in the corresponding RAG summary file (`docs/rag/*.md`).
3. Run ingestion dry-run to confirm chunk diffs and spot-check search relevance.
4. Submit PR with updated docs and ingestion notes.

## Exclusion Rules

- Omit secrets, API keys, customer-specific data, and environment-specific overrides.
- Mask personal data before committing docs.
- Avoid redundant historical logs; summarize impacts in troubleshooting sections instead.

## Review Checklist

- [ ] Headings follow naming conventions.
- [ ] Links resolve locally.
- [ ] New workflows documented in data-model and module summaries.
- [ ] AI automation contracts updated when backend endpoints change.

## Communication & Ownership

- Assign module owners (inventory, purchasing, sales, time tracking, settings, AI) to review quarterly.
- Track documentation updates in `docs/tasks/` or equivalent sprint notes.
- Notify ingestion operators via deployment channel before large corpus updates.

## Versioning & Rollback

- Tag releases in Git when major documentation overhauls occur.
- Archive previous embeddings snapshots for rollback.
- Document rollback steps in `DEPLOYMENT_CHECKLIST.md` if ingestion fails.
