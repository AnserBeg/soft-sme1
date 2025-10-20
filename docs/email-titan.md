# Titan Mail Integration Guide

This document outlines how Titan Mail is integrated into the Soft SME agent email layer and how to configure it securely.

## Features

- IMAP-over-SSL search, listing, and message retrieval (`imap.titan.email`, port 993 by default)
- SMTP-over-SSL send, draft confirmation, and thread-aware replies (`smtp.titan.email`, port 465 by default)
- Region-aware host overrides for EU tenants (`imap0101.titan.email` / `smtp0101.titan.email`)
- Provider-agnostic tooling surfaced to the agent (`email_search`, `email_read`, `email_compose_draft`, `email_send`, `email_reply`)
- Mandatory confirmation token workflow before any outbound send
- Encryption at rest for stored credentials and drafts using `EMAIL_CONNECTION_SECRET`
- Enforcement of organization flags: `EMAIL_ENABLED`, `EMAIL_SEND_ENABLED`, `EMAIL_ALLOW_EXTERNAL`, `EMAIL_ATTACHMENT_MAX_MB`

## Environment Variables

| Variable | Description |
| --- | --- |
| `EMAIL_CONNECTION_SECRET` | 32-byte base64/hex key for libsodium secretbox encryption of credentials and drafts. Required. |
| `TITAN_IMAP_HOST_DEFAULT` *(optional)* | Override default IMAP hostname if different from `imap.titan.email`. |
| `TITAN_SMTP_HOST_DEFAULT` *(optional)* | Override default SMTP hostname if different from `smtp.titan.email`. |

## Region Hosts

| Region | IMAP Host | SMTP Host |
| --- | --- | --- |
| Global | `imap.titan.email` | `smtp.titan.email` |
| EU | `imap0101.titan.email` | `smtp0101.titan.email` |

Users can supply alternate hosts in the connect payload. Ports default to 993 (IMAPS) and 465 (SMTPS) and must allow TLS with certificate validation.

## Connecting Titan Mail

1. Ensure `EMAIL_CONNECTION_SECRET` is configured on the backend and database migrations for `agent_email_connections` and `agent_email_drafts` are applied.
2. Call `POST /api/email/connect/titan` with the authenticated user context and payload:

```json
{
  "host_imap": "imap.titan.email",
  "port_imap": 993,
  "host_smtp": "smtp.titan.email",
  "port_smtp": 465,
  "email": "agent@example.com",
  "password": "app-password"
}
```

3. The service performs TLS validation against IMAP and SMTP, stores credentials encrypted, and records `last_validated_at`.
4. To disconnect, call `POST /api/email/disconnect`.

## Agent Tools

The agent now exposes the following tools (all scoped to `provider: 'titan'`):

- `email_search` – search inbox using filters (`from:`, `to:`, `subject:`, `after:`, `before:`, `has:attachment`).
- `email_read` – fetch headers, plain text, sanitized HTML, and attachment metadata.
- `email_compose_draft` – create a draft and receive `{ draftId, preview.confirmToken }` for confirmation.
- `email_send` – send a draft once the user supplies the confirmation token.
- `email_reply` – reply/reply-all within a thread (sets `In-Reply-To`/`References`).

All send operations require the confirmation token to satisfy the `needs_confirmation` handshake.

## Confirmation Flow

1. Agent calls `email_compose_draft` with recipients, subject, and body.
2. Response contains a `draftId` and `preview.confirmToken` plus a UI hint linking to Titan webmail.
3. After human approval, agent invokes `email_send` with `{ draftId, confirm_token }`.
4. Draft is consumed and sent via SMTP; confirmation tokens expire after 15 minutes.

## Attachment Limits

`EMAIL_ATTACHMENT_MAX_MB` (default 25 MB) caps total attachment size per send. The agent validates attachments before calling Titan.

## Privacy & Security

- Credentials and drafts are encrypted using libsodium secretbox (`EMAIL_CONNECTION_SECRET`).
- Sensitive values are never logged; audit trails store sanitized metadata only.
- External recipients are blocked if `EMAIL_ALLOW_EXTERNAL=false` (recipient domain must match sender domain).
- All network traffic enforces TLS with certificate validation; failures produce user-friendly errors.

## Troubleshooting

- **TLS/Hostname errors** – verify DNS resolves to Titan and custom ports allow SSL. Use default hosts if unsure.
- **Confirmation token expired** – tokens expire after 15 minutes; re-compose the draft.
- **External send blocked** – update `EMAIL_ALLOW_EXTERNAL` in `global_settings` if business policy allows it.
- **Attachments rejected** – compress or remove files to stay under `EMAIL_ATTACHMENT_MAX_MB`.

## Local Development Setup

Install backend dependencies to populate `node_modules` and update `soft-sme-backend/package-lock.json` with the Titan packages (`imapflow`, `mailparser`, `sanitize-html`, `libsodium-wrappers`, `uuid`). From `soft-sme-backend/` run:

```bash
npm install
```

If the npm registry is not reachable from your environment, retry with an allowed mirror or download the tarballs manually and install them with `npm install ./path-to-tarball.tgz --save`. Unit tests rely on these dependencies being present.

## Migration Notes

Apply the new migrations:

```
psql -f migrations/20250901_create_agent_email_connections.sql
psql -f migrations/20250901_create_agent_email_drafts.sql
```

Existing Gmail or custom SMTP integrations remain unaffected. Titan is opt-in per user via the new connect endpoint.
