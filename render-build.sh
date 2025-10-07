#!/usr/bin/env bash
set -euo pipefail

cat <<'MSG'
This project now deploys via the Dockerfile at the repository root.
Please switch your Render service to the Docker runtime and clear any
custom build or start commands so Render uses the Docker image instead
of render-build.sh.

See render.yaml for an example Docker-based configuration.
MSG

exit 1
