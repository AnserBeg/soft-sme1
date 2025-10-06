# CORS Failures After Rollback Deployments

When a rollback deployment is performed without changing the application codebase, CORS failures can still appear because the runtime configuration that controls the list of allowed origins is environment-driven.

## Why Rollbacks Can Break CORS

The backend Express application builds its allowed CORS origin list at startup. In addition to several hard-coded localhost and tunnel domains, it expects the production origin to be provided through the `CORS_ORIGIN` environment variable. 【F:soft-sme-backend/src/app.ts†L43-L78】

If the runtime environment (Render, Docker, etc.) does not provide `CORS_ORIGIN` or the value no longer matches the exact origin of the frontend (including protocol and subdomain), the domain will be excluded from `allowedOrigins`, and the middleware will reject the request with a CORS error. Because rollback deployments often restore container images but not environment variables, any drift or removal of `CORS_ORIGIN` in the deployment settings will persist across rollbacks and continue to block the frontend. 【F:soft-sme-backend/src/app.ts†L43-L78】【F:soft-sme-backend/env.example†L15-L18】

## What to Check

1. **Environment variable value** – Confirm that the deployment's `CORS_ORIGIN` matches the current frontend domain exactly (including HTTPS and subdomains). Empty or stale values result in the origin being filtered out. 【F:soft-sme-backend/src/app.ts†L43-L66】
2. **Multiple domains** – If you are serving from more than one domain, add each domain to the configuration or introduce a comma-separated list handler before redeploying. 【F:soft-sme-backend/src/app.ts†L43-L66】
3. **Temporary tunnels** – Requests through Cloudflare tunnel URLs remain allowed, so if tunnel traffic succeeds while the main domain fails, it confirms a misconfigured `CORS_ORIGIN`. 【F:soft-sme-backend/src/app.ts†L52-L60】

Updating the environment configuration and redeploying is sufficient to restore CORS access—no code changes are necessary.
