### Setup (Gemini adapter)
- Copy .env.sample to .env and fill in the values
  - `cp .env.sample .env`
  - Set `GEMINI_API_KEY` and `DATABASE_URL`
- Create python environment
  - `python -m venv venv`
- Activate python environment
  - macOS/Linux: `source venv/bin/activate`
  - Windows PowerShell: `venv\Scripts\Activate.ps1`
- Install dependencies
  - `pip install -r requirements.txt`
- Run the server
  - `python api/index.py`

### Notes
- This adapter uses Google GenAI (`google-genai`) instead of OpenAI.
- The endpoint `POST /prompt` expects JSON `{ "prompt": "natural language question" }`.
- Tool use is done via Gemini automatic function calling to execute SQL safely via Postgres.
