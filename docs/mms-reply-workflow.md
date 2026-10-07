# MMS Reply Workflow — Operations Runbook

One-time configuration and deployment verification for the MMS reply workflow.

**References:**

- Epic: https://github.com/pizza-to-the-polls/pizzabase/issues/255 (MMS reply media)
- Inbound webhook: https://github.com/pizza-to-the-polls/pizzabase/issues/259 (MMS-003)
- Slack notify: https://github.com/pizza-to-the-polls/pizzabase/issues/258 (MMS-004)
- This doc: https://github.com/pizza-to-the-polls/pizzabase/issues/260 (MMS-006)
- Infra for the underlying media pipeline: [issue-164-infra-setup.md](issue-164-infra-setup.md)

---

## 1. Architecture summary

```
Pizza recipient's phone
      │  replies to a follow-up text with a photo/video (MMS)
      ▼
Twilio  ──POST /twilio/inbound──►  API (base.polls.pizza)
      │                                 │
      │                    1. verifyTwilioSignature (X-Twilio-Signature)
      │                       → 403 + Bugsnag on failure
      │                    2. ban check (BannedPhoneNumber) / STOP opt-out
      │                    3. Report.findRecentFulfilledByPhone
      │                       (window = MMS_MATCH_WINDOW_DAYS, default 30)
      │                       → no match: polite reply, media NOT stored
      │                                 │
      │                                 ▼
      │                    download media bytes (Twilio URLs expire ~4h!)
      │                                 │
      │                                 ▼
      │                    PutObject → raw.polls.pizza (private)
      │                                 │
      │                    S3 ObjectCreated trigger (existing pipeline)
      │                    on-s3-upload-process-exif → on-media-format
      │                    → on-mediaconvert-complete (videos)
      │                                 │
      │                                 ▼
      │                    Upload.media_status → 'ready'
      │                    zapNewMmsUpload (ZAP_NEW_MMS_UPLOAD)
      │                       → Zapier → internal channel
      │                                 │
      ▼                                 ▼
TwiML reply ("Thanks for sharing! 🍕")   Retool: GET /reports/:id/media
```

**Key decisions (epic #255):**

- **Twilio is not the media store.** The `MediaUrl{N}` links Twilio sends are
  short-lived signed S3 redirects that expire after roughly 4 hours. The
  webhook downloads the bytes immediately and writes them to the private
  `raw.polls.pizza` bucket.
- **Only processed/scrubbed URLs are shared.** Everything leaves the system as
  EXIF-scrubbed CDN URLs on `media.polls.pizza` (re-encoded WebP/JPEG or
  transcoded MP4). Raw bucket paths never appear in Slack or Retool.
- **Notifications ride Zapier.** Web uploads keep using `zapNewUpload`;
  MMS-origin uploads fire `ZAP_NEW_MMS_UPLOAD` when the pipeline finishes,
  and the Zap on the other end posts to the internal channel. There is no
  separate Slack webhook — staging reuses the existing `STAGING_ZAP_ALL`
  catch-all, and Retool consumes `GET /reports/:idOrAddress/media`.

---

## 2. Environment variables

See `.env.example` at the repo root. All four are passed through in
`serverless.yml`'s `provider.environment` block.

- `TWILIO_AUTH_TOKEN` (**required**) — auth token for
  `verifyTwilioSignature` on `POST /twilio/inbound`. Unset → every inbound
  request is rejected with 403.
- `ZAP_NEW_MMS_UPLOAD` (optional) — Zapier catch hook URL fired by
  `zapNewMmsUpload` when MMS media finishes processing. Unset → no-op
  (feature disabled). Staging wires this to the existing `STAGING_ZAP_ALL`
  catch-all; prod gets its own secret.
- `MMS_MATCH_WINDOW_DAYS` (optional) — days after pizza delivery during
  which an MMS reply is matched to a fulfilled report
  (`Report.findRecentFulfilledByPhone`). Defaults to 30.
- `TWILIO_MEDIA_EXTRA_HOSTS` (optional) — extra comma-separated hosts the
  webhook may fetch `MediaUrl`s from, on top of the Twilio-only allowlist.
  **Staging-only test convenience** (the staging deploy sets it to
  `test-videos.co.uk` for public sample videos); prod leaves
  it unset so the default Twilio-only SSRF policy applies.

---

## 3. Twilio console setup

Configure the **phone number that sends the follow-up texts** (the same number
recipients will reply to).

1. Log in to the [Twilio Console](https://console.twilio.com/).
2. Navigate: **Phone Numbers → Manage → Active numbers**.
3. Click the Pizza to the Polls phone number for the environment you're
   configuring.
4. Scroll to the **Messaging Configuration** section and find the field
   **"A MESSAGE COMES IN"**.
5. Set:
   - **Configure With / type:** `Webhook`
   - **Method:** `POST` (Twilio POSTs `application/x-www-form-urlencoded`
     form fields — the app parses them, see `app.ts`)
   - **URL:**
     - prod: `https://base.polls.pizza/twilio/inbound`
     - staging: `https://<staging-api-domain>/twilio/inbound`

The prod hostname comes from `customDomain.domainName` in `serverless.yml`
(`base.polls.pizza` at time of writing). Staging deploys with a different
`--stage` don't get that domain — run `npx serverless info --stage <stage>`
and use the printed Service Endpoint (an `execute-api` URL), keeping the
`/twilio/inbound` path.

> **Note:** Twilio signs the exact URL it POSTs to. The hostname in the
> console must match what the API actually receives (including the custom
> domain, not an internal `execute-api` hostname for prod), otherwise
> signature verification rejects every request.

---

## 4. Notification routing (Zapier)

There is no dedicated Slack webhook. MMS media notifications ride the same
`ZAP_*` hook infrastructure as every other event:

1. When an MMS-origin upload finishes the pipeline, the app POSTs to the
   `ZAP_NEW_MMS_UPLOAD` hook with `{ hook, upload, location, report, order,
mediaLinks }` — `mediaLinks` holds the processed/scrubbed
   `media.polls.pizza` URLs (never raw paths), `location` the full address,
   and `order` (when the matched report has one) the order details: pizzas
   sent (`pizzas`), `restaurant`, `orderType`, `createdAt`/`cancelledAt`.
2. **Staging needs no new setup**: the deploy workflow maps
   `ZAP_NEW_MMS_UPLOAD` to the existing `STAGING_ZAP_ALL` catch-all. Add a
   path in that Zap (filter on `hook == "ZAP_NEW_MMS_UPLOAD"`) posting
   `mediaLinks` to the internal channel.
3. **Prod**: create (or extend) a Zapier catch-hook Zap, add the same
   filter + post, and put its URL in the `ZAP_NEW_MMS_UPLOAD` secret.
4. The integration is optional by design: with the env var unset, the notify
   step is a silent no-op. Only pending/clean MMS uploads notify —
   flagged/rejected media is reviewed by a human in Retool and never posted.

---

## 5. Deployment checklist (staging first)

1. **Create the GitHub secrets** for the stage (the deploy workflows pass them
   through to the Lambda env — staging reads `STAGING_TWILIO_AUTH_TOKEN`; the
   `ZAP_NEW_MMS_UPLOAD` notify is wired to the existing `STAGING_ZAP_ALL`
   automatically; prod additionally reads `ZAP_NEW_MMS_UPLOAD`):
   - `TWILIO_AUTH_TOKEN` value from Twilio Console → Account Info → Auth Token
     (account-level; staging and prod secrets hold the same value unless the
     environments use separate Twilio accounts)
   - prod's `ZAP_NEW_MMS_UPLOAD` value = the catch-hook URL from §4
   - `MMS_MATCH_WINDOW_DAYS` can stay unset (30-day default).
2. **Deploy to staging** (GitHub Actions deploy workflow with
   `--stage <staging>`).
3. **Point the staging Twilio number** at the staging webhook URL per §3.
4. **Send a test MMS** (a photo of a pizza works) to the staging number from a
   phone whose number matches the `contactInfo` of a recent fulfilled report
   in the staging DB.
5. **Verify, in order:**
   - [ ] An `Upload` row was created with `source='mms'` and
         `source_phone` set to the sender.
   - [ ] `media_status` reaches `ready` (check the
         `on-s3-upload-process-exif` / `on-media-format` CloudWatch logs).
   - [ ] The Zap posts a message to the internal channel containing `media.polls.pizza`
         links (processed CDN URLs, not raw bucket paths).
   - [ ] **STOP opt-out works:** text `STOP` to the number, confirm the
         opt-out reply arrives and a `BannedPhoneNumber` row was created with
         `bannedBy='twilio-webhook'`. Further messages get the opted-out
         reply.
   - [ ] **Signature rejection logs to Bugsnag:** send a request with a
         missing/garbage `X-Twilio-Signature` header (e.g.
         `curl -X POST https://<staging-api-domain>/twilio/inbound`) and
         confirm a "signature verification failed" error appears in Bugsnag
         and the endpoint returns 403.
6. Repeat the Twilio console + env steps for prod.

---

## 6. Operational notes

- **5 MB media limit.** Attachments larger than 5 MB are skipped with a
  polite reply ("We couldn't save files over 5MB."). This matches the US/Canada
  MMS carrier limit enforced by Twilio; the controller also enforces it
  (`MAX_MEDIA_BYTES` in `src/controller/TwilioInboundController.ts`).
- **Deduplication by fileHash.** Every stored attachment is SHA-256 hashed;
  `file_hash` is a unique column on `uploads`. Re-sending the same photo does
  not create a second upload or a second pipeline run — `createFromMms`
  recognizes the duplicate and skips the S3 put.
- **Bans live in `BannedPhoneNumber`.** The STOP keyword set is
  `STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`. Banned numbers get the
  opted-out reply and are otherwise ignored. Bans can be managed via the
  `/banned-phone-numbers` endpoints.
- **Orphan replies are not stored.** If no fulfilled report matches the
  sender within the match window, the sender gets a polite reply ("we
  couldn't match this to a recent pizza delivery") and nothing is persisted —
  no Upload row, no S3 object.
- **Only media types the pipeline can process are stored.** The MIME allowlist
  (JPEG/PNG/GIF/WebP/HEIC/HEIF/MP4/MOV/WebM) mirrors the extensions the
  format/transcode lambdas handle; anything else is skipped.

---

## 7. Retool

Retool consumes processed media through `GET /reports/:id/media` — see the
Retool wiring doc from MMS-005 for the panel setup and auth. Retool never
touches raw bucket paths; it renders the same scrubbed CDN URLs that the
Slack notification contains.
