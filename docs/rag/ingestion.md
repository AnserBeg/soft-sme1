# RAG Ingestion Lifecycle

Operational runbook for building and validating the Soft SME knowledge base.

## Prerequisites

- Install dependencies listed in `setup_rag_system.bat` (Node, Python, vector DB client).
- Ensure access to documentation directories (`docs/`, root-level guides, `docs/ai-assistant/`).
- Provision vector database credentials (Azure Cognitive Search, Pinecone, or Supabase Vector) per environment runbooks.

## Initialization Steps

1. **Clone Repository:** Retrieve the latest documentation and scripts.
2. **Normalize Content:** Verify each doc follows chunk-friendly headings (H1/H2) and includes summaries, validations, troubleshooting, FAQs.
3. **Configure Embeddings:** Update embedding provider keys in `.env` according to deployment checklists.
4. **Seed Vector Store:** Run the Python ingestion script (`soft-sme-backend/rag_agent/rag_documentation_setup.py` or `setup_rag_system.bat`). It automatically walks `docs/rag/` for markdown files and loads them into the vector database unless you override `--docs-dir`.
5. **Verify Counts:** Confirm expected document and chunk counts vs. baseline metrics stored in ops dashboard.

## Validation & Quality Gates

- **Search Spot Checks:** Run sample queries (inventory sync, PO recalculation, AI planner schema) to confirm relevant answers.
- **Chunk Integrity:** Inspect embedding chunks to avoid exceeding token limits; adjust headings or tables as needed.
- **Broken Link Scan:** Ensure references resolve by running `npm run docs:check` (if available) or manual grep.
- **Sensitive Data Review:** Cross-check for PII/financial data before ingestion; mask or redact per data governance policy.

## Deployment Workflows

- **Development:** Local vector DB (e.g., SQLite/pgvector) for quick iteration.
- **Staging:** Mirror production schema with limited dataset for preflight checks.
- **Production:** High-availability vector DB with scheduled ingestion jobs (cron or CI pipeline).

## Monitoring & Alerts

- Track ingestion job status via CI logs or observability stack.
- Set thresholds for embedding drift (vector count delta, stale docs) and alert operations.
- Maintain runbook updates in `DEPLOYMENT_CHECKLIST.md` when ingestion steps change.

## Sample Queries

- "How do I convert a quote to a sales order?"
- "What are the time tracking approval rules?"
- "How do AI agents authenticate with the backend?"

Document the query results to baseline expected behavior and catch regressions during future updates.
