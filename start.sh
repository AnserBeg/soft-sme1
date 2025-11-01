#!/usr/bin/env bash
set -euo pipefail

# Start the Python assistant in background and expose its base URL to Node
export ASSISTANT_PORT=${ASSISTANT_PORT:-5001}
export ASSISTANT_API_URL=${ASSISTANT_API_URL:-http://127.0.0.1:${ASSISTANT_PORT}}
python3 -u Aiven.ai/assistant_server.py &

# Start Node server on $PORT (Render provides PORT)
npm run start
