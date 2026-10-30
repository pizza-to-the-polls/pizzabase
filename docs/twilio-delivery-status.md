# Twilio Delivery-Status Lookup Helper (#351)

A read-only CLI helper for ops investigations (pizza-eagle): query the Twilio
Messages API and report delivery status, error code, and direction for
outbound SMS messages.

## Why this exists

The SMS fleet's status-callback sync only mirrors `sent`/`failed`/`undelivered`
into Help Scout notes and a Slack channel; `queued` and `delivered` callbacks
are deliberately ignored. There is no way to query message history or delivery
error codes directly — until now.

## Scope

- **Read-only**: The script only ever issues `GET` requests against the
  `GET /2010-04-01/Accounts/{Sid}/Messages.json` endpoint. It never sends,
  updates, or deletes messages.
- **No new npm dependencies**: uses Node's built-in `fetch` and the `aws` CLI
  (already a dependency of ops tooling) for Secrets Manager access.
- **No changes to existing workflows**: purely additive tooling that runs
  locally; it is not part of any Lambda or deploy pipeline.

## Prerequisites

- Node 22 (`nvm use` — fetch is stable and built-in).
- `npm install` (deps from the repo root).
- AWS CLI configured with the `ptp-triage-readonly` profile (see
  `docs/ptp-triage-readonly-policy.json`), or the
  `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` env vars set for local dev.

## Provisioning the Twilio read-only API key

1. Log in to the Twilio Console and go to **Account → API Keys & Tokens**.
2. Click **Create API Key**.
3. Choose the **Read-only** scope (NOT "Full Access" or "Account"). A
   read-only key cannot send messages, update resources, or delete anything —
   even if the script itself were compromised.
4. Name it something like `pizza-eagle-readonly-delivery-status`.
5. Note the generated **Key SID** (`SKxxxx...`) and the **Secret** — the
   secret is shown only once.

## Storing in AWS Secrets Manager

Store the read-only key pair as a JSON secret under the `PizzaBase` naming
convention (this matches the IAM permissions in
`docs/ptp-triage-readonly-policy.json`):

```bash
aws secretsmanager create-secret --name PizzaBase/twilio/read-only \
  --secret-string '{"accountSid":"ACxxxx...","authToken":"SKxxxx...-secret"}'
```

- `accountSid` — the Twilio Account SID (`ACxxxx...`).
- `authToken` — the read-only API key's secret (`SKxxxx...`).
- The secret name `PizzaBase/twilio/read-only` is the default; override with
  `--secret-name` if needed.

## Rotating the key

1. Create a new read-only API key in the Twilio Console (step above).
2. Update the secret in AWS Secrets Manager:
   ```bash
   aws secretsmanager put-secret-value --secret-id PizzaBase/twilio/read-only \
     --secret-string '{"accountSid":"ACxxxx...","authToken":"SKxxxx...-new-secret"}'
   ```
3. Confirm the helper works with the new key (run a lookup below).
4. Revoke the old key in the Twilio Console once the new key is confirmed.

## Credential sources

Priority order:

1. `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` env vars (local dev / testing).
2. AWS Secrets Manager (`PizzaBase/twilio/read-only` by default).
3. Error with a clear message explaining what to do.

Never commit credentials to the repo and never pass them on the command line
as arguments — the `aws` CLI reads the secret from Secrets Manager and the
helper reads it from the subprocess stdout, so neither appears in process
listings or logs.

## Usage

```bash
# Lookup by recipient number (E.164 recommended; the script normalizes input)
npx ts-node scripts/twilio-delivery-status.ts --to "+15551234567"

# Narrow to a time window (ISO 8601)
npx ts-node scripts/twilio-delivery-status.ts --to "+15551234567" \
  --after 2024-11-01T00:00:00Z --before 2024-11-07T00:00:00Z

# Lookup by MessageSid
npx ts-node scripts/twilio-delivery-status.ts --sid SMa1b2c3d4e5f67890

# JSON output (for piping to jq)
npx ts-node scripts/twilio-delivery-status.ts --to "+15551234567" --json

# Dry run — prints the query plan, makes no API calls (safe for CI)
npx ts-node scripts/twilio-delivery-status.ts --to "+15551234567" --dry-run

# Override the secret name
npx ts-node scripts/twilio-delivery-status.ts --to "+15551234567" \
  --secret-name PizzaBase/twilio/custom
```

## Manual verification

1. Find a known recent outbound message in staging (e.g., from the Help Scout
   note or the Slack sync channel for a delivery you know happened).
2. Run:
   ```bash
   npx ts-node scripts/twilio-delivery-status.ts --to "+15551234567"
   ```
3. Compare the reported status (e.g., `Delivered`) against what Help
   Scout / Slack shows.
4. For a failed message, confirm the error code appears in the `Status`
   column, e.g. `Failed [code: 30006]` (carrier violation).

## Error code reference

- Twilio's official error code reference:
  https://www.twilio.com/docs/api/errors
- Common SMS delivery codes: `30006` (carrier violation), `30007`
  (carrier-filtered), `30005` (unknown destination).
