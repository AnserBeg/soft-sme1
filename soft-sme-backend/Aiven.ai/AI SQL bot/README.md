# Console Gemini Chatbot (Python)

A minimal console chatbot powered by Google GenAI (Gemini API).

## Prerequisites

- Python 3.9+
- Gemini API key from Google AI Studio

## Install

```bash
pip install -U google-genai psycopg[binary] sqlglot
```

## Set API key (per session)

- PowerShell (Windows):

```powershell
$Env:GEMINI_API_KEY = "YOUR_API_KEY"
```

- bash (macOS/Linux):

```bash
export GEMINI_API_KEY="YOUR_API_KEY"
```

## Run

```bash
python chat.py
```

### Common options

- `--model` Model name (default: `gemini-2.5-flash`)
- `--system` System instruction to steer behavior
- `--no-history` Send independent prompts without prior turns
- `--multiline` Type multi-line prompts (end with a single `.` line)
- `--db-tools` Enable read-only DB tools and Gemini function calling
- `--tool-mode auto|any|none` Control function calling behavior (requires `--db-tools`)
- `--temperature` Sampling temperature (default 0.0)
- `--thinking` Thinking budget for 2.5 models (0 disables)

### Commands in chat

- `/help` Show commands
- `/clear` Clear conversation history
- `/exit` Quit

## Database integration (read-only)

Set your connection string as `DATABASE_URL` and optionally `DB_SCHEMA` (`public` by default):

- PowerShell (Windows):

```powershell
$Env:DATABASE_URL = "postgresql://<user>:<pass>@<host>/<db>"
$Env:DB_SCHEMA = "public"   # optional
```

- bash (macOS/Linux):

```bash
export DATABASE_URL="postgresql://<user>:<pass>@<host>/<db>"
export DB_SCHEMA="public"   # optional
```

Run with DB tools enabled (includes a focused default system prompt if none provided):

```bash
python chat.py --db-tools --model gemini-2.5-pro
```

### What the DB tools do

- `list_tables()` returns `{ table_name, table_comment }` for the active schema.
- `get_schema_slice(tables|keywords)` returns a compact JSON slice with columns, types, comments, PKs, and FKs.
- `run_select_readonly(sql, params?)` safely executes a single SELECT with auto-LIMIT and returns `{columns, rows}`.

System prompt behavior
- When `--db-tools` is enabled and no `--system` is provided, the app uses a default instruction that forces tool execution after proposing SQL, requires COUNT(*) for totals, prefers WHERE IN over INNER JOIN for counts, and normalizes name comparisons using LOWER(TRIM(...)). It also instructs the model to always include the exact SQL executed in the final response.

Safety
- Session sets `default_transaction_read_only=on` and an 8s `statement_timeout` where supported.
- SQL linter enforces single-statement, SELECT/WITH only, denies DDL/DML/admin tokens, and auto-LIMITs.
- Tools are read-only; do not grant write privileges to the DB role.
