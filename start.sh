#!/usr/bin/env bash
set -euo pipefail

# Start the Python assistant in background on localhost:5001
export ASSISTANT_PORT=${ASSISTANT_PORT:-5001}
python3 -u Aiven.ai/assistant_server.py &

# Start Node server on $PORT (Render provides PORT)
npm run start

