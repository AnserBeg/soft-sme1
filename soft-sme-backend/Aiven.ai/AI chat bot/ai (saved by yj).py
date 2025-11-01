import os
import sys
import pathlib
from google import genai
from google.genai import types

MODEL = os.getenv('GEMINI_MODEL', 'gemini-2.5-flash')
DOC_PATH = r'C:\Users\mirza\AI chat bot\AIVEN ERP Documentation.pdf'


def get_client():
    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key:
        print("GEMINI_API_KEY not set. In PowerShell set with:")
        print("  $env:GEMINI_API_KEY=\"YOUR_API_KEY\"")
        sys.exit(1)
    return genai.Client(api_key=api_key)


def load_local_pdf_part(path: str):
    p = pathlib.Path(path)
    if not p.exists():
        raise FileNotFoundError(f"PDF not found: {p}")
    data = p.read_bytes()
    return types.Part.from_bytes(data=data, mime_type='application/pdf')


def make_config(system_instruction: str | None, thinking_budget: int | None = None, temperature: float | None = None):
    kwargs = {}
    if system_instruction:
        kwargs['system_instruction'] = system_instruction
    if thinking_budget is not None:
        kwargs['thinking_config'] = types.ThinkingConfig(thinking_budget=int(thinking_budget))
    if temperature is not None:
        kwargs['temperature'] = float(temperature)
    return types.GenerateContentConfig(**kwargs) if kwargs else None


AIVEN_SYSTEM_INSTRUCTION = """
You are AIven Assistant, an in-app AI guide for the AIven Software.
Your job is to use the provided AIven User Guide document to help users:

- Understand how to use each part of the system (tasks, settings, HR, inventory, quotes, sales, purchasing, returns, etc.).
- Explain how to perform actions step-by-step in simple, clear language.
- Describe why certain features or processes are designed that way (for example, why margin factors are multipliers, or why stock and supply are tracked differently).

Rules for responses:
- Always base your answers on the user guide.
- Keep explanations short, simple, and actionable.
- Use the same button and page names as in the document.
- If something isn’t in the guide, say so and offer the closest related explanation.
- When possible, give both the “how” and the “why.”
"""


def chat_over_pdf(doc_path: str, system_prompt: str | None = None, stream: bool = False):
    client = get_client()
    pdf_part = load_local_pdf_part(doc_path)

    # System instruction defaults to AIven Assistant guidance unless overridden via CLI
    preamble = system_prompt or AIVEN_SYSTEM_INSTRUCTION

    chat = client.chats.create(
        model=MODEL,
        config=make_config(preamble),
    )

    print(f"Connected to Gemini chat over PDF. Model: {MODEL}")
    print(f"PDF: {doc_path}")
    print("Type 'exit' or Ctrl+C to quit.\n")

    while True:
        try:
            user = input("You: ").strip()
            if not user:
                continue
            if user.lower() in {"exit", ":q", "quit"}:
                print("Bye!")
                break

            parts = [pdf_part, user]
            if stream:
                resp_stream = chat.send_message_stream(parts)
                print("AI: ", end="", flush=True)
                for chunk in resp_stream:
                    chunk_text = getattr(chunk, 'text', '')
                    if chunk_text:
                        print(chunk_text, end="", flush=True)
                print("\n")
            else:
                resp = chat.send_message(parts)
                text = getattr(resp, 'text', None)
                if not text:
                    try:
                        text = resp.candidates[0].content.parts[0].text
                    except Exception:
                        text = "<no text in response>"
                print(f"AI: {text}\n")

        except KeyboardInterrupt:
            print("\nBye!")
            break
        except EOFError:
            print("\nBye!")
            break
        except Exception as e:
            print(f"Error: {e}")


if __name__ == "__main__":
    # CLI: python "ai (saved by yj).py" [--stream] [--doc "C:\\path\\to\\doc.pdf"] [system instruction...]
    stream_flag = False
    doc_path = DOC_PATH
    args = sys.argv[1:]
    while args and args[0] in ("--stream", "-s", "--doc"):
        if args[0] in ("--stream", "-s"):
            stream_flag = True
            args = args[1:]
        elif args[0] == "--doc":
            if len(args) < 2:
                print("--doc requires a path")
                sys.exit(2)
            doc_path = args[1]
            args = args[2:]
    system_msg = " ".join(args) if args else None
    chat_over_pdf(doc_path, system_msg, stream=stream_flag)