import os
import sys
from google import genai
from google.genai import types

MODEL = os.getenv('GEMINI_MODEL', 'gemini-2.5-flash')


def get_client():
    # Prefer explicit api_key to avoid env visibility surprises
    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key:
        print("GEMINI_API_KEY not set. In PowerShell set with:")
        print("  $env:GEMINI_API_KEY=\"YOUR_API_KEY\"")
        sys.exit(1)
    try:
        return genai.Client(api_key=api_key)
    except Exception as e:
        print(f"Failed to create Gemini client: {e}")
        sys.exit(1)


def make_config(system_instruction: str | None, thinking_budget: int | None = None, temperature: float | None = None):
    kwargs = {}
    if system_instruction:
        kwargs['system_instruction'] = system_instruction
    if thinking_budget is not None:
        kwargs['thinking_config'] = types.ThinkingConfig(thinking_budget=int(thinking_budget))
    if temperature is not None:
        kwargs['temperature'] = float(temperature)
    return types.GenerateContentConfig(**kwargs) if kwargs else None


def chat_loop(system_prompt: str | None = None, stream: bool = False):
    client = get_client()
    chat = client.chats.create(model=MODEL, config=make_config(system_prompt))

    print(f"Connected to Gemini chat. Model: {MODEL}")
    print("Type 'exit' or Ctrl+C to quit.\n")

    while True:
        try:
            user = input("You: ").strip()
            if not user:
                continue
            if user.lower() in {"exit", ":q", "quit"}:
                print("Bye!")
                break

            if stream:
                resp_stream = chat.send_message_stream(user)
                print("AI: ", end="", flush=True)
                text_accum = []
                for chunk in resp_stream:
                    chunk_text = getattr(chunk, 'text', '')
                    if chunk_text:
                        text_accum.append(chunk_text)
                        print(chunk_text, end="", flush=True)
                print("\n")
            else:
                resp = chat.send_message(user)
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
    # CLI: python ai.py [--stream] [system instruction words...]
    stream_flag = False
    args = sys.argv[1:]
    if args and args[0] in ("--stream", "-s"):
        stream_flag = True
        args = args[1:]
    system_msg = " ".join(args) if args else None
    chat_loop(system_msg, stream=stream_flag)