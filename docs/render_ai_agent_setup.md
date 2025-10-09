# Render Deployment Checklist for AI Agent Temporary Storage

This guide summarizes the steps required to keep the AI agent from exhausting temporary storage when deployed on Render.

## 1. Provision Adequate Disks

1. Create a **Persistent Disk** in Render that is large enough to hold all downloaded model artifacts, Python wheels, and caches (recommend starting with at least 20 GB for medium models).
2. Attach the disk to the service that runs the agent. Note the mount path (e.g., `/var/lib/render/ai-cache`).

## 2. Redirect Runtime Caches

Add the following environment variables to the Render service configuration so frameworks use the persistent disk instead of `/tmp`:

```bash
HF_HOME=/var/lib/render/ai-cache/huggingface
TRANSFORMERS_CACHE=/var/lib/render/ai-cache/huggingface
PIP_CACHE_DIR=/var/lib/render/ai-cache/pip
UV_CACHE_DIR=/var/lib/render/ai-cache/uv
XDG_CACHE_HOME=/var/lib/render/ai-cache
```

Create the directories during deploy by adding an init script, Render blueprint, or start command snippet such as:

```bash
mkdir -p "$HF_HOME" "$PIP_CACHE_DIR" "$UV_CACHE_DIR" "$XDG_CACHE_HOME"
```

## 3. Preload Critical Assets

When using Docker or Render Native environments:

- Extend the container image to download Hugging Face models and tokenizer files during the image build stage.
- Install Python dependencies (`pip install --no-cache-dir -r requirements.txt`) so wheels are baked into the image.
- If the agent relies on custom embeddings or knowledge bases, copy them into the image or persistent disk during build or a one-time migration job.

## 4. Maintain the Persistent Disk

- Periodically prune unused models or old cache entries (`huggingface-cli cache delete` or removing directories manually).
- Monitor disk utilization with Render's metrics; raise the disk size if sustained usage exceeds 80%.

## 5. Fallback Cleanup for `/tmp`

Keep a lightweight cleanup script that runs before agent start to remove stale files from `/tmp` in case the service accumulates temporary data during runtime:

```bash
find /tmp -maxdepth 1 -mindepth 1 -mtime +1 -exec rm -rf {} +
```

Run this either in the start command or as a scheduled job.

## 6. Validate After Deployment

1. Deploy the service and monitor the first boot logs to confirm assets are cached to the persistent disk path.
2. Ensure the agent process has read/write permissions to the mounted disk.
3. Confirm total write volume to `/tmp` stays well below the partition limit during load tests.

Following these steps prevents repeated downloads from consuming Render's ephemeral storage, keeping the AI agent stable across restarts.
