import json
import re
from flask import Flask, Request, Response, jsonify, request, make_response, render_template
import dotenv
from modules import db, instruments
from modules import llm_gemini as llm

import os

from modules.models import TurboTool
from psycopg2 import Error as PostgresError

app = Flask(__name__)

# ---------------- .Env Constants ----------------

dotenv.load_dotenv()

assert os.environ.get("DATABASE_URL"), "POSTGRES_CONNECTION_URL not found in .env file"
assert os.environ.get("GEMINI_API_KEY"), "GEMINI_API_KEY not found in .env file"


DB_URL = os.environ.get("DATABASE_URL")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
# Control whether to expose raw SQL in API responses. Default is off (do not expose).
EXPOSE_SQL = str(os.environ.get("EXPOSE_SQL", "false")).strip().lower() in ("1", "true", "yes", "on")
# Bump this when deploying changes to easily verify the running build
SERVER_VERSION = "2025-10-29.2"

# ---------------- Business Rules ----------------

# These rules guide how analytics should be calculated. They are injected
# into the LLM prompt so generated SQL consistently respects them.
BUSINESS_RULES_TEXT = (
    "Unless otherwise specified, interpret dates/times in the America/Denver time zone (MST/MDT).\n"
    "In all summaries and human-visible tables, format numeric values to two decimal places (e.g., 12.00).\n"
    "When filtering by user-provided values on textual columns (names, order numbers, part numbers, descriptions, statuses, etc.),\n"
    "perform case-insensitive, fuzzy 'contains' matching using ILIKE with wildcards around each term. Example: for input Corey, use\n"
    "column ILIKE '%Corey%'. For multiple words, require all tokens (AND), e.g., (col ILIKE '%corey%' AND col ILIKE '%mccormick%').\n"
    "Apply this to all relevant text fields unless the user explicitly requests exact match. Do not cast numeric/date fields to text.\n"
    "All textual comparisons must be case-insensitive; differences in upper/lowercase should never affect results.\n"
    "Hours/durations: compute at the shift grain and sum totals. Always use duration columns from attendance_shifts and time_entries unless the user explicitly asks for raw clock-in/out rows.\n"
    "Avoid join fan-out: reduce to one row per shift before aggregating.\n"
    "Data source guidance: prefer attendance_shifts for shift totals; use time_entries for entry-level detail or if shifts are missing. Use duration columns rather than deriving from timestamps.\n"
    "If using time_entries with a shift_id, aggregate to one row per shift (group by shift_id) summing duration. If no shift_id, aggregate per person + local_date by summing duration.\n"
    "Raw events: only when the user explicitly asks for exact clock_in/clock_out, return raw rows.\n"
)

# (Fuzzifier removed; rely on model instructions and examples.)

# ---------------- Cors Helper ----------------


def make_cors_response():
    # Set CORS headers for the preflight request
    response = make_response()
    response.headers.add("Access-Control-Allow-Origin", "*")
    response.headers.add("Access-Control-Allow-Headers", "Content-Type,Authorization")
    response.headers.add("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS")
    return response


# ---------------- Result summarization (lightweight, local) ----------------


def summarize_rows(json_str: str) -> str:
    """Create a concise, human-friendly summary from a JSON rows string.

    Rules:
    - If single row, single numeric column -> return "<col>: <value>".
    - If two columns and one looks like a name and another numeric, summarize top N.
    - Else, show row count and first few column headings.
    """
    try:
        data = json.loads(json_str)
        if not isinstance(data, list):
            return ""
        n = len(data)
        if n == 0:
            return "No rows returned."
        first = data[0]
        if isinstance(first, dict):
            cols = list(first.keys())
            # Single cell case
            if n == 1 and len(cols) == 1:
                k = cols[0]
                v = first[k]
                return f"{k}: {v}"
            # Two-column common pattern: name + value
            if len(cols) == 2:
                name_like = None
                value_like = None
                for c in cols:
                    lc = c.lower()
                    if any(x in lc for x in ["name", "title", "customer", "product", "status"]):
                        name_like = c
                    if any(x in lc for x in ["total", "count", "amount", "sum", "value", "qty", "quantity"]):
                        value_like = c
                if name_like and value_like:
                    # Build top lines
                    top = data[: min(5, n)]
                    parts = [f"{row.get(name_like)}: {row.get(value_like)}" for row in top]
                    more = "" if n <= 5 else f" (+{n-5} more)"
                    return f"Top results by {value_like} â€” " + "; ".join(parts) + more
            # Fallback generic summary
            return f"Returned {n} rows with columns: {', '.join(cols[:6])}{'...' if len(cols)>6 else ''}."
        return f"Returned {n} rows."
    except Exception:
        return ""


# ---------------- In-Process Runner ----------------


def run_prompt(base_prompt: str) -> dict:
    """Run the SQL agent pipeline in-process (no Flask request object).

    Returns a dict like the HTTP API: {
        'prompt': str,
        'results': str(JSON array),
        'summary': str,
        optionally 'sql': str when EXPOSE_SQL is enabled
    }
    """
    with instruments.PostgresAgentInstruments(DB_URL, "prompt-endpoint") as (
        agent_instruments,
        db,
    ):
        # Skip expensive "similar tables" scan. Proceed with TABLE_INVENTORY/TABLE_COLUMNS only.
        similar_tables = ""

        # Build prompt with a compact table inventory so users need not know table names
        inv_block = llm.add_cap_ref(
            "",
            "Use this inventory of tables and their descriptions to decide which tables to query.",
            "TABLE_INVENTORY",
            agent_instruments.table_inventory,
        )

        cols_block = llm.add_cap_ref(
            "",
            "Columns and comments for all tables in the active schema. Use this to choose exact columns.",
            "TABLE_COLUMNS",
            agent_instruments.columns_inventory,
        )

        # Inject business rules so generated SQL consistently applies them
        rules_block = llm.add_cap_ref(
            "",
            "Business rules to apply in all calculations and reports. Treat as authoritative.",
            "BUSINESS_RULES",
            BUSINESS_RULES_TEXT,
        )

        # Provide concrete examples so the model reliably follows fuzzy/exact matching rules
        matching_examples = (
            "Examples of matching to follow strictly:\n"
            "- Names (fuzzy): p.name ILIKE '%Corey%'\n"
            "- Full name (exact if quoted): p.name ILIKE 'Corey McCormick'\n"
            "- Order numbers (fuzzy): soh.sales_order_number ILIKE '%SO-2025-00079%'\n"
            "- Parts (fuzzy on either field): part_number ILIKE '%89191%' OR part_description ILIKE '%bolt%'\n"
            "- Status (fuzzy): status ILIKE '%open%'\n"
        )
        examples_block = llm.add_cap_ref(
            "",
            "Reference examples for case-insensitive matching behavior.",
            "MATCHING_EXAMPLES",
            matching_examples,
        )

        # Canonical field preferences to avoid wrong-column filters (e.g., parts)
        canonical_prefs = (
            "When filtering by user-visible IDs/codes, prefer these canonical fields and joins:\n"
            "- Parts: JOIN inventory i ON i.part_id = purchaselineitems.part_id (or source part_id),\n"
            "         and filter by i.canonical_part_number (fallback: line-item part_number/description).\n"
            "- Sales orders: salesorderhistory.sales_order_number.\n"
            "- Purchase orders: purchasehistory.purchase_number.\n"
            "- Employees: profiles.name.\n"
            "Always pick the canonical column first when available; only fallback to raw/free-text fields if needed.\n"
        )
        canonical_block = llm.add_cap_ref(
            "",
            "Canonical field and join preferences for consistent filtering.",
            "CANONICAL_PREFERENCES",
            canonical_prefs,
        )

        # Part number resolution strategy
        part_resolution = (
            "When a user provides a 'part number', assume it may refer to either the canonical number (inventory.canonical_part_number) "
            "or a vendor/raw number stored on transactional rows (e.g., purchaselineitems.part_number) or descriptions.\n"
            "Resolution strategy (use this pattern):\n"
            "1) Build candidate_parts as distinct part_id by UNION of matches across canonical, line-item part_number, and descriptions (case-insensitive, fuzzy contains unless quoted).\n"
            "2) Use candidate_parts.part_id to drive the main query, joining inventory/purchasehistory/etc., to avoid filtering the wrong column.\n"
            "3) If multiple parts match, either aggregate across them or list them separately; if a single exact quoted value matches, prefer exact equality on that field.\n\n"
            "Example pattern (replace Q with the user token; apply multi-word AND within each field, OR across fields):\n"
            "WITH candidate_parts AS (\n"
            "  SELECT DISTINCT i.part_id FROM inventory i WHERE i.canonical_part_number ILIKE '%Q%'\n"
            "  UNION\n"
            "  SELECT DISTINCT pli.part_id FROM purchaselineitems pli WHERE pli.part_number ILIKE '%Q%'\n"
            "  UNION\n"
            "  SELECT DISTINCT i.part_id FROM inventory i WHERE COALESCE(i.part_description,'') ILIKE '%Q%'\n"
            "), main AS (\n"
            "  SELECT ph.purchase_date::date AS purchase_date, SUM(pli.quantity) AS qty\n"
            "  FROM purchaselineitems pli\n"
            "  JOIN candidate_parts cp ON cp.part_id = pli.part_id\n"
            "  JOIN purchasehistory ph ON ph.purchase_id = pli.purchase_id\n"
            "  GROUP BY ph.purchase_date::date\n"
            ") SELECT purchase_date, ROUND(qty::numeric, 2) AS quantity FROM main ORDER BY purchase_date;\n"
        )
        part_resolution_block = llm.add_cap_ref(
            "",
            "How to resolve user-supplied part numbers across canonical and raw fields.",
            "PART_RESOLUTION",
            part_resolution,
        )

        # Examples for per-shift hours using duration columns
        hours_examples = (
            "Patterns for hours calculations (copy these shapes):\n\n"
            "-- Attendance (preferred): sum duration\n"
            "SELECT asf.profile_id, SUM(COALESCE(asf.duration, 0)) AS total_hours\n"
            "FROM attendance_shifts asf\n"
            "GROUP BY asf.profile_id;\n\n"
            "-- Time entries with shift_id: aggregate to one row per shift first, summing duration\n"
            "WITH entry_shifts AS (\n"
            "  SELECT te.shift_id, te.profile_id, COALESCE(SUM(te.duration), 0) AS shift_hours\n"
            "  FROM time_entries te\n"
            "  GROUP BY te.shift_id, te.profile_id\n"
            ") SELECT profile_id, SUM(shift_hours) AS total_hours FROM entry_shifts GROUP BY profile_id;\n\n"
            "-- Time entries without shift_id: approximate per person+local_date by summing duration\n"
            "WITH person_day AS (\n"
            "  SELECT te.profile_id, (MIN(te.clock_in) AT TIME ZONE 'America/Denver')::date AS local_date,\n"
            "         COALESCE(SUM(te.duration), 0) AS day_hours\n"
            "  FROM time_entries te\n"
            "  GROUP BY te.profile_id\n"
            ") SELECT profile_id, SUM(day_hours) AS total_hours FROM person_day GROUP BY profile_id;\n\n"
            "-- Raw events request: only when explicitly asked, return exact clock_in/clock_out rows\n"
            "SELECT p.name, te.clock_in, te.clock_out FROM time_entries te JOIN profiles p ON p.id = te.profile_id;\n"
        )
        hours_block = llm.add_cap_ref(
            "",
            "Examples for per-shift hours using duration and raw events.",
            "HOURS_EXAMPLES",
            hours_examples,
        )

        # Compose final prompt
        prompt_text = f"Fulfill this database query: {base_prompt}. "
        prompt_text = inv_block + cols_block + rules_block + examples_block + canonical_block + part_resolution_block + prompt_text

        # Model instruction set
        sql_only_instructions = (
            "You're an elite Postgres SQL developer. Return only one safe, single-statement SELECT or WITH query "
            "in standard Postgres syntax, targeting the provided TABLE_INVENTORY/TABLE_COLUMNS (and TABLE_DEFINITIONS if present). "
            "Do not include explanations, markdown, backticks, or comments. Include a sensible LIMIT only if results would be extremely large, "
            "otherwise return all rows requested by the user. Respect BUSINESS_RULES, including fuzzy case-insensitive 'contains' matching "
            "(use ILIKE with surrounding wildcards) for user-specified filters on textual columns; for multi-word inputs require all tokens with AND. "
            "If the user encloses a value in single or double quotes, treat it as an exact text match (no wildcards), preferably case-insensitive (e.g., name ILIKE 'Corey McCormick'). "
            "All textual comparisons must be case-insensitive; uppercase/lowercase differences must not affect results."
        )

        strong_instructions = (
            sql_only_instructions
            + " Always apply the following BUSINESS_RULES exactly as written.\n\nBUSINESS_RULES:\n"
            + BUSINESS_RULES_TEXT
        )

        # Generate SQL and execute
        sql_response = llm.prompt(
            prompt_text,
            model="gemini-2.5-flash",
            instructions=strong_instructions,
        )

        try:
            agent_instruments.run_sql(sql_response)
            agent_instruments.validate_run_sql()
        except PostgresError as e:
            err_payload = {"error": str(e)}
            if EXPOSE_SQL:
                err_payload["sql"] = sql_response
            # Reraise as generic exception for CLI to surface
            raise PostgresError(json.dumps(err_payload))

        sql_query = open(agent_instruments.sql_query_file).read()
        sql_query_results = open(agent_instruments.run_sql_results_file).read()

        # Summarize
        llm_summary = ""
        try:
            preview_text = sql_query_results
            if isinstance(preview_text, str) and len(preview_text) > 20000:
                preview_text = preview_text[:20000] + "\n... (truncated)"

            summ_prompt = llm.add_cap_ref(
                (
                    "Summarize for a non-technical user and render the full result as a simple plain-text table. "
                    "No markdown, no code fences. First output a single line starting with 'Headline: ' that states the key takeaway. "
                    "Then output a table with a header row of column names and one row per result. "
                    "Use clean spacing so columns are readable; include all rows provided in the preview. "
                    "If there are many columns, prefer the most informative 4–6 (names, dates, totals, quantities, amounts)."
                ),
                "Here is a JSON preview of the rows returned by the query.",
                "RESULT_PREVIEW",
                preview_text,
            )
            llm_summary = llm.prompt(
                summ_prompt,
                model="gemini-2.5-flash",
                instructions=(
                    "You are a precise data analyst. Output plain text only (no markdown, no code fences). "
                    "First: one line 'Headline: ...'. Then: a plain-text table with aligned columns and all rows from the preview. "
                    "Do not include the SQL query or any code. Format all numeric values to two decimal places (e.g., 12.00)."
                ),
            )
        except Exception:
            llm_summary = ""

        summary = llm_summary or summarize_rows(sql_query_results)

        if isinstance(summary, str):
            s = summary.replace("```", "").strip()
            pattern_label = re.compile(r"(?im)^\s*(sql\b.*:|--\s*sql\b|query\s*:)")
            m = pattern_label.search(s)
            if m:
                s = s[: m.start()].rstrip()
            pattern_sql = re.compile(r"(?im)^\s*(select|with|insert|update|delete|create|drop)\b")
            m2 = pattern_sql.search(s)
            if m2:
                s = s[: m2.start()].rstrip()
            summary = s

        response_obj = {
            "prompt": base_prompt,
            "results": sql_query_results,
            "summary": summary,
        }
        if EXPOSE_SQL:
            response_obj["sql"] = sql_query

        return response_obj


# ---------------- Minimal Web UI ----------------


@app.route("/ui", methods=["GET"])
def ui():
    return render_template("ui.html")


# ---------------- Self Correcting Assistant ----------------


def self_correcting_assistant(
    db: db.PostgresManager,
    agent_instruments: instruments.AgentInstruments,
    tools: TurboTool,
    error: PostgresError,
):
    # reset db - to unblock transactions
    db.roll_back()

    all_table_definitions = db.get_table_definitions_for_prompt()

    print(f"Loaded all table definitions")

    # ------ File prep

    file_path = agent_instruments.self_correcting_table_def_file

    # write all_table_definitions to file
    with open(file_path, "w") as f:
        f.write(all_table_definitions)

    files_to_upload = [file_path]

    sql_query = open(agent_instruments.sql_query_file).read()

    # ------ Prompts

    output_file_path = agent_instruments.run_sql_results_file

    diagnosis_prompt = f"Given the table_definitions.sql file, the following SQL_ERROR, and the SQL_QUERY, describe the most likely cause of the error. Think step by step.\n\nSQL_ERROR: {error}\n\nSQL_QUERY: {sql_query}"

    generation_prompt = (
        f"Based on your diagnosis, generate a new SQL query that will run successfully."
    )

    run_sql_prompt = "Use the run_sql function to run the SQL you've just generated."

    assistant_name = "SQL Self Correction"

    # Self-correction assistant via OpenAI Assistants is not available in this Gemini adapter.
    # For now, skip this path or implement a Gemini-based planner if needed.
    raise NotImplementedError("Self-correction assistant is not implemented for Gemini.")

    print(f"Generated Assistant: {assistant_name}")

    file_ids = turbo4_assistant.upsert_files(files_to_upload)

    print(f"Uploaded files: {file_ids}")

    print(f"Running Self Correction Assistant...")

    (
        turbo4_assistant.set_instructions(
            "You're an elite SQL developer. You generate the most concise and performant SQL queries. You review failed queries and generate new SQL queries to fix them."
        )
        .enable_retrieval()
        .equip_tools(tools)
        .make_thread()
        # 1/3 STEP PATTERN: diagnose
        .add_message(diagnosis_prompt, file_ids=file_ids)
        .run_thread()
        .spy_on_assistant(agent_instruments.make_agent_chat_file(assistant_name))
        # 2/3 STEP PATTERN: generate
        .add_message(generation_prompt)
        .run_thread()
        .spy_on_assistant(agent_instruments.make_agent_chat_file(assistant_name))
        # 3/3 STEP PATTERN: execute
        .add_message(run_sql_prompt)
        .run_thread(toolbox=[tools[0].name])
        .spy_on_assistant(agent_instruments.make_agent_chat_file(assistant_name))
        # clean up, logging, reporting, cost
        .run_validation(agent_instruments.validate_file_exists(output_file_path))
        .spy_on_assistant(agent_instruments.make_agent_chat_file(assistant_name))
        .get_costs_and_tokens(agent_instruments.make_agent_cost_file(assistant_name))
    )

    pass


# ---------------- Primary Endpoint ----------------


@app.route("/prompt", methods=["POST", "OPTIONS"])
def prompt():
    # Set CORS headers for the main request
    response = make_cors_response()
    if request.method == "OPTIONS":
        return response

    # Get access to db, state, and functions
    with instruments.PostgresAgentInstruments(DB_URL, "prompt-endpoint") as (
        agent_instruments,
        db,
    ):
        # ---------------- Build Prompt ----------------

        base_prompt = request.json["prompt"]

        # Lightweight heuristics previously used to handle specific date patterns have been removed.
        def _parse_single_date(text: str):
            import datetime as _dt
            t = (text or "").strip()
            if not t:
                return None
            # Try a few common patterns
            patterns = [
                "%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%b %d %Y", "%B %d %Y",
                "%d %b %Y", "%d %B %Y", "%Y %b %d", "%Y %B %d",
            ]
            # Find a candidate substring that looks like a date
            # If none extracted, attempt whole text parses against formats containing month names.
            # Simple month name + day + year extraction
            try:
                import re as _re
                m = _re.search(r"(\b\d{4}-\d{2}-\d{2}\b)", t)
                if m:
                    return m.group(1)
                m2 = _re.search(r"\b(\d{1,2}/\d{1,2}/\d{2,4})\b", t)
                if m2:
                    cand = m2.group(1)
                    for fmt in ["%m/%d/%Y", "%m/%d/%y"]:
                        try:
                            return _dt.datetime.strptime(cand, fmt).date().isoformat()
                        except Exception:
                            pass
                m3 = _re.search(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2}\s+\d{4}\b", t, flags=_re.IGNORECASE)
                if m3:
                    # Extract the full token around it
                    # Find the full match with month name, day, year
                    m4 = _re.search(r"\b([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{4})\b", t)
                    if m4:
                        month, day, year = m4.group(1), m4.group(2), m4.group(3)
                        for fmt in ["%b %d %Y", "%B %d %Y"]:
                            try:
                                return _dt.datetime.strptime(f"{month} {day} {year}", fmt).date().isoformat()
                            except Exception:
                                pass
            except Exception:
                pass
            # Last resort: try parsing the entire text with a few formats
            for fmt in patterns:
                try:
                    return _dt.datetime.strptime(t, fmt).date().isoformat()
                except Exception:
                    continue
            return None

        def _is_hours_by_person_query(text: str) -> bool:
            s = (text or "").lower()
            if "hour" not in s:
                return False
            if "work" not in s and "worked" not in s:
                return False
            # Look for by-person framing
            return any(x in s for x in ["each person", "per person", "by person", "each employee", "by employee"]) 

        # Skip expensive "similar tables" scan. Proceed with TABLE_INVENTORY/TABLE_COLUMNS only.
        similar_tables = ""

        print("similar_tables", similar_tables)

        print(f"base_prompt: {base_prompt}")

        # Build prompt with a compact table inventory so users need not know table names
        inv_block = llm.add_cap_ref(
            "",
            "Use this inventory of tables and their descriptions to decide which tables to query.",
            "TABLE_INVENTORY",
            agent_instruments.table_inventory,
        )

        cols_block = llm.add_cap_ref(
            "",
            "Columns and comments for all tables in the active schema. Use this to choose exact columns.",
            "TABLE_COLUMNS",
            agent_instruments.columns_inventory,
        )

        # Inject business rules so generated SQL consistently applies them
        rules_block = llm.add_cap_ref(
            "",
            "Business rules to apply in all calculations and reports. Treat as authoritative.",
            "BUSINESS_RULES",
            BUSINESS_RULES_TEXT,
        )

        # Provide concrete examples so the model reliably follows fuzzy/exact matching rules
        matching_examples = (
            "Examples of matching to follow strictly:\n"
            "- Names (fuzzy): p.name ILIKE '%Corey%'\n"
            "- Full name (exact if quoted): p.name ILIKE 'Corey McCormick'\n"
            "- Order numbers (fuzzy): soh.sales_order_number ILIKE '%SO-2025-00079%'\n"
            "- Parts (fuzzy on either field): part_number ILIKE '%89191%' OR part_description ILIKE '%bolt%'\n"
            "- Status (fuzzy): status ILIKE '%open%'\n"
        )
        examples_block = llm.add_cap_ref(
            "",
            "Reference examples for case-insensitive matching behavior.",
            "MATCHING_EXAMPLES",
            matching_examples,
        )

        # Canonical field preferences to avoid wrong-column filters (e.g., parts)
        canonical_prefs = (
            "When filtering by user-visible IDs/codes, prefer these canonical fields and joins:\n"
            "- Parts: JOIN inventory i ON i.part_id = purchaselineitems.part_id (or source part_id),\n"
            "         and filter by i.canonical_part_number (fallback: line-item part_number/description).\n"
            "- Sales orders: salesorderhistory.sales_order_number.\n"
            "- Purchase orders: purchasehistory.purchase_number.\n"
            "- Employees: profiles.name.\n"
            "Always pick the canonical column first when available; only fallback to raw/free-text fields if needed.\n"
        )
        canonical_block = llm.add_cap_ref(
            "",
            "Canonical field and join preferences for consistent filtering.",
            "CANONICAL_PREFERENCES",
            canonical_prefs,
        )

        # Part number resolution strategy: handle user-supplied part numbers that may be canonical or vendor/raw
        part_resolution = (
            "When a user provides a 'part number', assume it may refer to either the canonical number (inventory.canonical_part_number) "
            "or a vendor/raw number stored on transactional rows (e.g., purchaselineitems.part_number) or descriptions.\n"
            "Resolution strategy (use this pattern):\n"
            "1) Build candidate_parts as distinct part_id by UNION of matches across canonical, line-item part_number, and descriptions (case-insensitive, fuzzy contains unless quoted).\n"
            "2) Use candidate_parts.part_id to drive the main query, joining inventory/purchasehistory/etc., to avoid filtering the wrong column.\n"
            "3) If multiple parts match, either aggregate across them or list them separately; if a single exact quoted value matches, prefer exact equality on that field.\n\n"
            "Example pattern (replace Q with the user token; apply multi-word AND within each field, OR across fields):\n"
            "WITH candidate_parts AS (\n"
            "  SELECT DISTINCT i.part_id FROM inventory i WHERE i.canonical_part_number ILIKE '%Q%'\n"
            "  UNION\n"
            "  SELECT DISTINCT pli.part_id FROM purchaselineitems pli WHERE pli.part_number ILIKE '%Q%'\n"
            "  UNION\n"
            "  SELECT DISTINCT i.part_id FROM inventory i WHERE COALESCE(i.part_description,'') ILIKE '%Q%'\n"
            "), main AS (\n"
            "  SELECT ph.purchase_date::date AS purchase_date, SUM(pli.quantity) AS qty\n"
            "  FROM purchaselineitems pli\n"
            "  JOIN candidate_parts cp ON cp.part_id = pli.part_id\n"
            "  JOIN purchasehistory ph ON ph.purchase_id = pli.purchase_id\n"
            "  GROUP BY ph.purchase_date::date\n"
            ") SELECT purchase_date, ROUND(qty::numeric, 2) AS quantity FROM main ORDER BY purchase_date;\n"
        )
        part_resolution_block = llm.add_cap_ref(
            "",
            "How to resolve user-supplied part numbers across canonical and raw fields.",
            "PART_RESOLUTION",
            part_resolution,
        )

        """
        # Legacy hours examples (no longer used)
        hours_examples_legacy = (
            "Patterns for hours calculations (copy these shapes):\n\n"
            "-- Attendance (preferred): duration is paid (already net of lunch) → just sum duration\n"
            "SELECT asf.profile_id, SUM(COALESCE(asf.duration, 0)) AS total_hours\n"
            "FROM attendance_shifts asf\n"
            "GROUP BY asf.profile_id;\n\n"
            "-- Attendance (fallback if duration missing): derive from times, deduct 0.5 once per shift that overlaps noon\n"
            "WITH shifts AS (\n"
            "  SELECT asf.profile_id,\n"
            "         (asf.clock_in AT TIME ZONE 'America/Denver')::date AS local_date,\n"
            "         asf.clock_in AT TIME ZONE 'America/Denver' AS cin_local,\n"
            "         asf.clock_out AT TIME ZONE 'America/Denver' AS cout_local,\n"
            "         EXTRACT(EPOCH FROM ((asf.clock_out AT TIME ZONE 'America/Denver') - (asf.clock_in AT TIME ZONE 'America/Denver'))) / 3600.0 AS raw_hours\n"
            "  FROM attendance_shifts AS asf\n"
            "), shifts_with_deduction AS (\n"
            "  SELECT s.profile_id, s.local_date,\n"
            "         CASE WHEN s.cin_local < (s.local_date + TIME '12:30')::timestamp\n"
            "                    AND s.cout_local > (s.local_date + TIME '12:00')::timestamp\n"
            "              THEN GREATEST(s.raw_hours - 0.5, 0) ELSE s.raw_hours END AS paid_hours\n"
            "  FROM shifts s\n"
            ") SELECT profile_id, SUM(paid_hours) AS total_hours FROM shifts_with_deduction GROUP BY profile_id;\n\n"
            "-- Time entries: if shift_id exists, group to one row per shift first\n"
            "WITH entry_shifts AS (\n"
            "  SELECT te.shift_id, te.profile_id,\n"
            "         MIN(te.clock_in AT TIME ZONE 'America/Denver') AS cin_local,\n"
            "         MAX(COALESCE(te.clock_out, now()) AT TIME ZONE 'America/Denver') AS cout_local,\n"
            "         COALESCE(SUM(te.duration), 0) AS raw_hours\n"
            "  FROM time_entries te GROUP BY te.shift_id, te.profile_id\n"
            "), shifts_with_deduction AS (\n"
            "  SELECT es.profile_id,\n"
            "         CASE WHEN es.cin_local::date IS NOT NULL THEN es.cin_local::date ELSE (es.cout_local::date) END AS local_date,\n"
            "         CASE WHEN es.cin_local < ( (es.cin_local::date) + TIME '12:30')::timestamp\n"
            "                    AND es.cout_local > ( (es.cin_local::date) + TIME '12:00')::timestamp\n"
            "              THEN GREATEST(es.raw_hours - 0.5, 0) ELSE es.raw_hours END AS paid_hours\n"
            "  FROM entry_shifts es\n"
            ") SELECT profile_id, SUM(paid_hours) AS total_hours FROM shifts_with_deduction GROUP BY profile_id;\n\n"
            "-- Time entries without shift_id: approximate per person+local_date (deduct once per day)\n"
            "WITH person_day AS (\n"
            "  SELECT te.profile_id,\n"
            "         (MIN(te.clock_in) AT TIME ZONE 'America/Denver')::date AS local_date,\n"
            "         MIN(te.clock_in AT TIME ZONE 'America/Denver') AS cin_local,\n"
            "         MAX(COALESCE(te.clock_out, now()) AT TIME ZONE 'America/Denver') AS cout_local,\n"
            "         COALESCE(SUM(te.duration), 0) AS raw_hours\n"
            "  FROM time_entries te GROUP BY te.profile_id\n"
            "), person_day_with_deduction AS (\n"
            "  SELECT pd.profile_id, pd.local_date,\n"
            "         CASE WHEN pd.cin_local < (pd.local_date + TIME '12:30')::timestamp\n"
            "                    AND pd.cout_local > (pd.local_date + TIME '12:00')::timestamp\n"
            "              THEN GREATEST(pd.raw_hours - 0.5, 0) ELSE pd.raw_hours END AS paid_hours\n"
            "  FROM person_day pd\n"
            ") SELECT profile_id, SUM(paid_hours) AS total_hours FROM person_day_with_deduction GROUP BY profile_id;\n\n"
            "-- Raw events request (no deduction): return exact clock_in/clock_out rows\n"
            "SELECT p.name, te.clock_in, te.clock_out FROM time_entries te JOIN profiles p ON p.id = te.profile_id;\n"
        )
        """
        # Override hours_examples to ensure we always use duration columns and never mention breaks
        hours_examples = (
            "Patterns for hours calculations (copy these shapes):\n\n"
            "-- Attendance (preferred): sum duration\n"
            "SELECT asf.profile_id, SUM(COALESCE(asf.duration, 0)) AS total_hours\n"
            "FROM attendance_shifts asf\n"
            "GROUP BY asf.profile_id;\n\n"
            "-- Time entries with shift_id: aggregate to one row per shift first, summing duration\n"
            "WITH entry_shifts AS (\n"
            "  SELECT te.shift_id, te.profile_id, COALESCE(SUM(te.duration), 0) AS shift_hours\n"
            "  FROM time_entries te\n"
            "  GROUP BY te.shift_id, te.profile_id\n"
            ") SELECT profile_id, SUM(shift_hours) AS total_hours FROM entry_shifts GROUP BY profile_id;\n\n"
            "-- Time entries without shift_id: approximate per person+local_date by summing duration\n"
            "WITH person_day AS (\n"
            "  SELECT te.profile_id, (MIN(te.clock_in) AT TIME ZONE 'America/Denver')::date AS local_date,\n"
            "         COALESCE(SUM(te.duration), 0) AS day_hours\n"
            "  FROM time_entries te\n"
            "  GROUP BY te.profile_id\n"
            ") SELECT profile_id, SUM(day_hours) AS total_hours FROM person_day GROUP BY profile_id;\n\n"
            "-- Raw events request: only when explicitly asked, return exact clock_in/clock_out rows\n"
            "SELECT p.name, te.clock_in, te.clock_out FROM time_entries te JOIN profiles p ON p.id = te.profile_id;\n"
        )

        hours_block = llm.add_cap_ref(
            "",
            "Examples for per-shift hours using duration and raw events.",
            "HOURS_EXAMPLES",
            hours_examples,
        )

        prompt = f"Fulfill this database query: {base_prompt}. "
        # Drop TABLE_DEFINITIONS block to reduce prompt size; rely on inventory + columns
        prompt = inv_block + cols_block + rules_block + examples_block + canonical_block + part_resolution_block + prompt

        # ---------------- Run 2 Agent Team - Generate SQL & Results ----------------

        # New: single-call pipeline (generate SQL -> execute locally) to reduce RPM
        sql_only_instructions = (
            "You're an elite Postgres SQL developer. Return only one safe, single-statement SELECT or WITH query "
            "in standard Postgres syntax, targeting the provided TABLE_INVENTORY/TABLE_COLUMNS (and TABLE_DEFINITIONS if present). "
            "Do not include explanations, markdown, backticks, or comments. Include a sensible LIMIT only if results would be extremely large, "
            "otherwise return all rows requested by the user. Respect BUSINESS_RULES, including fuzzy case-insensitive 'contains' matching "
            "(use ILIKE with surrounding wildcards) for user-specified filters on textual columns; for multi-word inputs require all tokens with AND. "
            "If the user encloses a value in single or double quotes, treat it as an exact text match (no wildcards), preferably case-insensitive (e.g., name ILIKE 'Corey McCormick'). "
            "All textual comparisons must be case-insensitive; uppercase/lowercase differences must not affect results."
        )

        # Strongly inject BUSINESS_RULES into the model's system instructions so they aren't ignored.
        strong_instructions = (
            sql_only_instructions
            + " Always apply the following BUSINESS_RULES exactly as written.\n\nBUSINESS_RULES:\n"
            + BUSINESS_RULES_TEXT
        )

        # Always generate SQL via the model according to BUSINESS_RULES
        sql_response = llm.prompt(
            prompt,
            model="gemini-2.5-flash",
            instructions=strong_instructions,
        )
        # Debug preview of generated SQL
        try:
            print("SQL before:", (sql_response[:1200] if isinstance(sql_response, str) else str(type(sql_response))))
        except Exception:
            pass

        # Fuzzifier disabled: rely on prompt instructions + examples only
        # if isinstance(sql_response, str):


        try:
            print("SQL after:", (sql_response[:1200] if isinstance(sql_response, str) else str(type(sql_response))))
        except Exception:
            pass

        # Enforce fuzzy matching on simple text filters to ensure partial, case-insensitive matches
        # Fuzzifier removed: execute the model's SQL as generated
        # Execute SQL locally (read-only enforced by DB role). No second LLM call needed.
        try:
            agent_instruments.run_sql(sql_response)
            agent_instruments.validate_run_sql()
        except PostgresError as e:
            print(f"PostgresError executing SQL: {e}")
            # Do not include SQL in error responses unless explicitly enabled
            err_payload = {"error": str(e)}
            if EXPOSE_SQL:
                err_payload["sql"] = sql_response
            return jsonify(err_payload), 400

        # ---------------- Read result files and respond ----------------

        sql_query = open(agent_instruments.sql_query_file).read()
        sql_query_results = open(agent_instruments.run_sql_results_file).read()

        # Optional model-based summarization (always on per request)
        llm_summary = ""
        try:
            # Build a compact prompt including a small preview of the results
            preview_text = sql_query_results
            # Keep payload modest: allow larger previews before truncation
            if isinstance(preview_text, str) and len(preview_text) > 20000:
                preview_text = preview_text[:20000] + "\n... (truncated)"

            summ_prompt = llm.add_cap_ref(
                (
                    "Summarize for a non-technical user and render the full result as a simple plain-text table. "
                    "No markdown, no code fences. First output a single line starting with 'Headline: ' that states the key takeaway. "
                    "Then output a table with a header row of column names and one row per result. "
                    "Use clean spacing so columns are readable; include all rows provided in the preview. "
                    "If there are many columns, prefer the most informative 4â€“6 (names, dates, totals, quantities, amounts)."
                ),
                "Here is a JSON preview of the rows returned by the query.",
                "RESULT_PREVIEW",
                preview_text,
            )
            llm_summary = llm.prompt(
                summ_prompt,
                model="gemini-2.5-flash",
                instructions=(
                    "You are a precise data analyst. Output plain text only (no markdown, no code fences). "
                    "First: one line 'Headline: ...'. Then: a plain-text table with aligned columns and all rows from the preview. "
                    "Do not include the SQL query or any code. Format all numeric values to two decimal places (e.g., 12.00)."
                ),
            )
        except Exception:
            llm_summary = ""

        # Local heuristic summary as fallback if LLM summary missing
        summary = llm_summary or summarize_rows(sql_query_results)

        # Strip accidental code fences and any appended SQL snippets if present
        if isinstance(summary, str):
            s = summary.replace("```", "").strip()
            # 1) Remove labeled SQL sections like "SQL used:", "-- SQL", or "Query:"
            pattern_label = re.compile(r"(?im)^\s*(sql\b.*:|--\s*sql\b|query\s*:)")
            m = pattern_label.search(s)
            if m:
                s = s[: m.start()].rstrip()
            # 2) Remove raw SQL blocks that start without a label (e.g., lines starting with SELECT/WITH/etc.)
            pattern_sql = re.compile(r"(?im)^\s*(select|with|insert|update|delete|create|drop)\b")
            m2 = pattern_sql.search(s)
            if m2:
                s = s[: m2.start()].rstrip()
            summary = s

        # Build response object without exposing SQL by default
        response_obj = {
            "prompt": base_prompt,
            "results": sql_query_results,
            "summary": summary,
        }
        if EXPOSE_SQL:
            response_obj["sql"] = sql_query

        print("response_obj", response_obj)

        response.data = json.dumps(response_obj)

        return response


if __name__ == "__main__":
    port = 3000
    print(f"Starting server on port {port}")
    print(f"INDEX_FILE: {__file__}")
    print(f"EXPOSE_SQL is {'ON' if EXPOSE_SQL else 'OFF'}")
    print(f"SERVER_VERSION: {SERVER_VERSION}")
    # Disable Flask debug reloader to ensure prints/logging come from the single running process
    app.run(debug=False, use_reloader=False, port=port)


