import os
import sys
import argparse
import time
import random
from typing import List

try:
    # Google GenAI SDK (pip install google-genai)
    from google import genai
    from google.genai import types
    from google.genai.errors import APIError
except Exception as e:
    print("google-genai is not installed. Run: pip install -U google-genai", file=sys.stderr)
    raise

# Optional DB tools; import if available to enable tool mode
try:
    from db_tools import list_tables, get_schema_slice, run_select_readonly
    HAS_DB_TOOLS = True
except Exception:
    HAS_DB_TOOLS = False


DEFAULT_MODEL = "gemini-2.5-flash"


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Console chatbot using Google GenAI (Gemini API)")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"Model name (default: {DEFAULT_MODEL})")
    parser.add_argument(
        "--system",
        default="You are a helpful, concise assistant.",
        help="System instruction to steer behavior.",
    )
    parser.add_argument("--no-history", action="store_true", help="Do not retain prior turns; each input is independent.")
    parser.add_argument(
        "--multiline",
        action="store_true",
        help="Enable multiline user input (finish with a single '.' line).",
    )
    parser.add_argument(
        "--db-tools",
        action="store_true",
        help="Enable read-only DB tools (list_tables, get_schema_slice, run_select_readonly).",
    )
    parser.add_argument(
        "--tool-mode",
        choices=["auto", "any", "none"],
        default="auto",
        help="Function calling mode: auto/any/none (requires --db-tools).",
    )
    parser.add_argument("--temperature", type=float, default=0.0, help="Sampling temperature (default 0.0)")
    parser.add_argument(
        "--thinking",
        type=int,
        default=0,
        help="Thinking budget for 2.5 models (0 disables; >=128 for pro).",
    )
    parser.add_argument("--retries", type=int, default=3, help="Max API retries on transient errors (default 3)")
    parser.add_argument("--retry-backoff", type=float, default=1.2, help="Base backoff seconds (default 1.2)")
    return parser.parse_args(argv)


def read_env_api_key() -> str:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print(
            "Environment variable GEMINI_API_KEY is not set.\n"
            "Set it for this session, e.g.:\n"
            "  PowerShell: $Env:GEMINI_API_KEY='YOUR_KEY'\n"
            "  bash: export GEMINI_API_KEY='YOUR_KEY'",
            file=sys.stderr,
        )
    return api_key


def prompt_lines() -> str:
    print("Enter your message. End with a single '.' on its own line:")
    lines: List[str] = []
    while True:
        try:
            line = input()
        except EOFError:
            break
        if line.strip() == ".":
            break
        lines.append(line)
    return "\n".join(lines).strip()


def main(argv: List[str]) -> int:
    args = parse_args(argv)

    # The client picks up GEMINI_API_KEY automatically if set
    _ = read_env_api_key()
    client = genai.Client()

    model = args.model
    # If DB tools are enabled and no custom system given, use a focused default
    default_db_system = (
        "You are a read-only Postgres data analyst. "
        "Workflow: (1) call list_tables to get an inventory, (2) call get_schema_slice only for relevant tables, "
        "(3) propose exactly one parameterized SELECT/WITH query, then immediately call run_select_readonly to execute it. "
        "Always return a concise natural-language summary and include the exact SQL executed when short. "
        "Rules: SELECT/WITH only; never infer totals from previews—use COUNT(*) for counts; prefer WHERE IN over INNER JOIN for counts to avoid dropping orphan rows; "
        "normalize name comparisons using LOWER(TRIM(...)). "
        "Minimize tool rounds: if table and columns are already known, skip list_tables/get_schema_slice and go straight to run_select_readonly; "
        "call get_schema_slice at most once per session unless the user requests different tables. "
        "After any tool call: produce a single-sentence, user-facing answer using only the tool result. "
        "If the result is a single numeric aggregate, respond with that number in a clear sentence. "
        "If the exact SQL is short, append it as ' SQL: <code>'. Otherwise omit it. "
        "Do not propose additional queries or call tools again in the same turn."
    )
    system_instruction = (
        args.system.strip()
        if args.system.strip()
        else (default_db_system if ("--db-tools" in sys.argv or "--db-tools" in argv) else "You are a helpful, concise assistant.")
    )

    print(f"Model: {model}")
    print("Type /exit to quit, /help for commands.\n")

    # When tools are enabled, keep structured history to preserve thought signatures
    contents: List[types.Content] = []
    # Text-mode fallback history for non-tool usage
    history: List[dict] = []
    system_preface = system_instruction if system_instruction else None

    def _should_retry(exc: Exception) -> bool:
        msg = str(exc).lower()
        retriable_markers = [
            "unavailable",
            "overloaded",
            "rate limit",
            "429",
            "503",
            "deadline",
            "internal",
            "temporarily",
            "retry",
        ]
        return any(m in msg for m in retriable_markers)

    def generate_with_retries(contents_obj, config_obj):
        attempt = 0
        while True:
            try:
                return client.models.generate_content(model=model, contents=contents_obj, config=config_obj)
            except APIError as e:
                attempt += 1
                if attempt > args.retries or not _should_retry(e):
                    raise
                # Longer backoff specifically for 429 rate limits
                base = args.retry_backoff
                if "429" in str(e) or "rate limit" in str(e).lower():
                    base = max(base, 2.5)
                delay = base * (2 ** (attempt - 1))
                delay = delay * (0.8 + 0.4 * random.random())
                print(f"Transient API error, retrying in {delay:.1f}s...", file=sys.stderr)
                time.sleep(delay)
            except Exception as e:
                # Non-API exceptions are not retried unless clearly transient
                attempt += 1
                if attempt > args.retries or not _should_retry(e):
                    raise
                base = args.retry_backoff
                if "429" in str(e) or "rate limit" in str(e).lower():
                    base = max(base, 2.5)
                delay = base * (2 ** (attempt - 1))
                delay = delay * (0.8 + 0.4 * random.random())
                print(f"Transient error, retrying in {delay:.1f}s...", file=sys.stderr)
                time.sleep(delay)

    while True:
        try:
            if args.multiline:
                user_text = prompt_lines()
            else:
                user_text = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if not user_text:
            continue

        # Commands
        if user_text.lower() in {"/exit", ":q", ":quit"}:
            break
        if user_text.lower() in {"/help", "?"}:
            print("Commands: /exit, /help, /clear")
            continue
        if user_text.lower() == "/clear":
            history.clear()
            print("History cleared.")
            continue

        # With DB tools enabled, use function calling flow and structured contents
        if args.db_tools and HAS_DB_TOOLS:
            # Build config
            tool_list: List[object] = [list_tables, get_schema_slice, run_select_readonly]
            # Function calling config
            if args.tool_mode == "none":
                tool_cfg = types.ToolConfig(
                    function_calling_config=types.FunctionCallingConfig(mode="NONE")
                )
            elif args.tool_mode == "any":
                tool_cfg = types.ToolConfig(
                    function_calling_config=types.FunctionCallingConfig(mode="ANY")
                )
            else:
                tool_cfg = types.ToolConfig(
                    function_calling_config=types.FunctionCallingConfig(mode="AUTO")
                )

            think_cfg = None
            # Only include thinking config if user requested > 0.
            # For pro models, enforce minimum 128 as per docs.
            if args.thinking and args.thinking > 0:
                budget = args.thinking
                if "pro" in model and budget < 128:
                    budget = 128
                think_cfg = types.ThinkingConfig(thinking_budget=budget)

            config = types.GenerateContentConfig(
                system_instruction=system_instruction,
                tools=tool_list,
                tool_config=tool_cfg,
                temperature=args.temperature,
                thinking_config=think_cfg,
            )

            # Prepare structured history
            user_part = types.Part.from_text(text=user_text)
            if args.no_history:
                contents = [types.Content(role="user", parts=[user_part])]
            else:
                contents.append(types.Content(role="user", parts=[user_part]))

            try:
                response = generate_with_retries(contents, config)
                # Progress logging for tool calls
                try:
                    parts = response.candidates[0].content.parts
                    had_tool_call = False
                    for p in parts:
                        if getattr(p, "function_call", None):
                            fn = p.function_call
                            print(f"[tool] Calling {fn.name} with args: {dict(fn.args)}")
                            # Local preview for run_select_readonly results
                            if fn.name == "run_select_readonly":
                                try:
                                    # Import locally to avoid circulars at module load
                                    from db_tools import run_select_readonly as _run
                                    # Support args as dict-like
                                    tool_res = _run(sql=fn.args.get("sql", ""), params=fn.args.get("params"))
                                    if isinstance(tool_res, dict) and tool_res.get("error"):
                                        print(f"[tool][local] error: {tool_res['error']}")
                                    else:
                                        cols = tool_res.get("columns", [])
                                        rows = tool_res.get("rows", [])
                                        preview = rows[:5]
                                        print(f"[tool][local] columns: {cols}")
                                        print(f"[tool][local] preview ({len(preview)} rows): {preview}")
                                    had_tool_call = True
                                except Exception as _e:
                                    print(f"[tool][local] preview failed: {_e}")
                except Exception:
                    pass

                text = (response.text or "").strip()
                if not text:
                    print("[tool] Executed tool call(s); awaiting model response...")
                    # Finalization retry if a tool call happened but no text was produced
                    try:
                        if 'had_tool_call' in locals() and had_tool_call:
                            delay = args.retry_backoff * (0.8 + 0.4 * random.random())
                            time.sleep(delay)
                            # Minimal micro-prompt to nudge summarization only
                            micro_contents = contents + [
                                types.Content(role="user", parts=[types.Part.from_text(text="Summarize the last tool result in one sentence for the user. If it is a single count, respond '<name> has <N>'. If SQL is short, append ' SQL: <code>'.")])
                            ]
                            response2 = generate_with_retries(micro_contents, config)
                            text2 = (response2.text or "").strip()
                            if text2:
                                response = response2
                                text = text2
                    except Exception as _e:
                        print(f"[tool] Finalization retry failed: {_e}")

                # Preserve model turn (with potential thought signature) if keeping history
                if not args.no_history:
                    contents.append(response.candidates[0].content)
            except Exception as e:
                print(f"Error from API: {e}")
                continue
        else:
            # Text-only fallback using simple transcript
            if args.no_history:
                prompt = user_text if not system_preface else f"{system_preface}\n\nUser: {user_text}"
            else:
                if not history:
                    transcript = f"System: {system_instruction}\n\nUser: {user_text}"
                else:
                    transcript = "".join(
                        f"{turn['role'].capitalize()}: {turn['text']}\n\n" for turn in history
                    ) + f"User: {user_text}"
                prompt = transcript
            try:
                response = generate_with_retries(prompt, None)
                # Progress logging for tool calls (text mode usually none, but safe)
                try:
                    parts = response.candidates[0].content.parts
                    for p in parts:
                        if getattr(p, "function_call", None):
                            fn = p.function_call
                            print(f"[tool] Calling {fn.name} with args: {dict(fn.args)}")
                except Exception:
                    pass
                text = (response.text or "").strip()
                if not text:
                    print("[tool] Executed tool call(s); awaiting model response...")
            except Exception as e:
                print(f"Error from API: {e}")
                continue

        if not text:
            print("(No response)")
        else:
            print(f"AI: {text}\n")

        if not args.no_history and not (args.db_tools and HAS_DB_TOOLS):
            # Append user and assistant turns into simplified history (text mode only)
            if not history and system_instruction:
                history.append({"role": "system", "text": system_instruction})
            history.append({"role": "user", "text": user_text})
            history.append({"role": "assistant", "text": text})

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
