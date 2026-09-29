# Clip Factory — renderClip infrastructure setup guide

## Overview

The Clip Factory renderer (`renderClip` lambda, CLIP-002) packages a
moderated upload into a vertical social clip. It is the "CF-6" lambda that
`src/lib/clip-render.ts` (`invokeRenderClip`) fires via fire-and-forget
async invoke with payload `{ clipId }`.

**Architecture:**

```
reports.polls.pizza (EXISTING, processed)      pizzabase app lambda
      │  uploads/{id}_transcoded.mp4                  │
      │  (MediaConvert output, processed_file_path)   │ ClipsController.create
      ▼                                               ▼
  renderClip (ffmpeg layer)  ◄──── async invoke { clipId } ──── clip stays queued
      │  reads Clip.kit + Upload.processedFilePath             if invoke fails
      │  renders 1080x1920 clip + captions + poster + kit
      ▼
  s3://reports.polls.pizza/clips/{clipId}/
      ├── clip.mp4     (9:16, H.264/AAC, ≤90s, burned-in caption + lower third + end-card)
      ├── clip.srt     (sidecar captions)
      ├── poster.jpg   (first frame, 9:16 crop)
      └── kit.json     (publish kit: caption, hashtags, platforms, asset keys)

  On success: clips.status = 'ready', outputPaths = { video, captions, poster, kit }
  On failure: clips.status = 'rejected' + failureReason
  Over daily budget (RENDER_DAILY_BUDGET, default 50): clip stays queued, nothing renders
```

No new buckets, no new IAM policies (the function inherits the service's
global `s3:*` and DB statements). The only new infra is the **ffmpeg Lambda
layer** and its fonts.

---

## 1. Build the ffmpeg Lambda layer

`renderClip` runs the static ffmpeg binary from a Lambda layer at
`/opt/bin/ffmpeg`. The binary must include **libfreetype** (drawtext text
overlays — captions, lower third, end-card). The static builds from
johnvansickle.com include freetype; no libass is needed (captions are burned
in with `drawtext` + generated text files, not the `subtitles` filter).

`scripts/build-ffmpeg-layer.sh` automates this:

```bash
bash scripts/build-ffmpeg-layer.sh
```

The script:

1. Downloads the latest amd64 static ffmpeg build
   (johnvansickle.com/ffmpeg — GPL build with freetype/fontconfig).
2. Downloads the DejaVu Sans Bold TTF (used by every drawtext filter) into
   `/opt/fonts/`.
3. Zips `bin/ffmpeg` + `fonts/DejaVuSans-Bold.ttf` into `ffmpeg-layer.zip`.
4. Publishes it:

```bash
aws lambda publish-layer-version \
  --layer-name ffmpeg \
  --zip-file fileb://ffmpeg-layer.zip \
  --compatible-runtimes nodejs22.x \
  --region us-west-2
```

### 1a. Get the layer ARN and bump serverless.yml

```bash
aws lambda list-layer-versions \
  --layer-name ffmpeg \
  --region us-west-2 \
  --query 'LayerVersions[0].LayerVersionArn' \
  --output text
```

`serverless.yml` references
`arn:aws:lambda:us-west-2:${env:AWS_ACCOUNT_ID}:layer:ffmpeg:1`. Bump the
version suffix (or set the ARN directly) whenever the layer changes — the
same pattern as the `sharp` layer used by `on-media-format`.

### 1b. Verify the binary inside the layer

```bash
docker run --rm -v "$PWD:/work" --entrypoint /bin/bash \
  public.ecr.aws/lambda/nodejs:22 \
  -c "cp /work/ffmpeg-layer.zip /tmp/l.zip && cd /tmp && unzip -q l.zip && \
      /opt/bin/ffmpeg -version | head -2"
```

Expected: `ffmpeg version ...` with `--enable=libfreetype` in the
configuration line.

---

## 2. Lambda function configuration

Managed by serverless.yml (no manual steps):

| Setting               | Value                            | Why                                                                                              |
| --------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `timeout`             | 900s                             | Worst-case encode headroom (a 90s clip renders in ~1–3 min at 3009MB).                           |
| `memorySize`          | 3009MB                           | ffmpeg encode throughput; also grants ~3GB heap for the source buffer.                           |
| `layers`              | ffmpeg layer (above)             | Static ffmpeg + DejaVu font.                                                                     |
| `FFMPEG_PATH`         | `/opt/bin/ffmpeg`                | Binary location inside the layer.                                                                |
| `RENDER_FONT_FILE`    | `/opt/fonts/DejaVuSans-Bold.ttf` | Font for all drawtext filters.                                                                   |
| `RENDER_DAILY_BUDGET` | `50` (env override)              | Daily cost guardrail: max clips that reach `ready` per UTC day. Over budget → clip stays queued. |

`/tmp` usage at these settings: source MP4 (≤90s transcode ≈ 60MB) + output
MP4/SRT/poster ≈ 150MB total — comfortably inside the default 512MB
ephemeral storage. If the limit is ever raised (longer clips), set
`ephemeralStorageSize` on the function or raise memory further.

### 2a. Environment variables / secrets

| Variable              | Source                                          |
| --------------------- | ----------------------------------------------- |
| `RENDER_DAILY_BUDGET` | GitHub secret (optional; defaults to `50`)      |
| `AWS_ACCOUNT_ID`      | Already required by the sharp layer ARN pattern |

No new secrets are strictly required — `RENDER_DAILY_BUDGET` falls back to
`50` when unset. To make it configurable per deploy, add
`RENDER_DAILY_BUDGET: ${{ secrets.RENDER_DAILY_BUDGET }}` to the deploy step
env in `.github/workflows/deploy.yml`.

---

## 3. How a render flows (operational reference)

1. `POST /clips` (ClipsController) validates the upload is clean + ready,
   creates the Clip with `status: queued` and a kit
   (`caption`, `hashtags`, `city`, `state`, `reportedAt`, `shortUrlSlug`),
   then fires `invokeRenderClip(clipId)` without awaiting.
2. `renderClip` loads the clip **and skips unless status is queued**
   (double-invoke idempotency; `POST /clips/:id/requeue` is the way back in).
3. Budget check: `count(clips where status='ready' and updated_at > start of
UTC day)` ≥ `RENDER_DAILY_BUDGET` → log + leave queued.
4. `queued → rendering`. All later validation failures (no kit, no processed
   MP4, unmappable source URL) throw into the shared catch and land the clip in
   `rejected` — the only valid exit besides `ready` once rendering has started.
5. Source MP4 downloaded from `processed_file_path.mp4` (CDN or path-style
   URL → S3 key in `reports.polls.pizza`).
6. Duration check from the MP4 `mvhd` box (same parser as the media
   pipeline): duration > 90s or undetectable → `rejected` + failureReason.
   (The upload-side check is 90s at upload time; this is defense in depth.)
7. ffmpeg runs twice (args built by the pure `src/lib/clipTemplate.ts`):
   poster extraction, then the main render — 1080x1920 center-crop,
   burned-in caption (bottom third, max 2 lines), `CITY, ST` + `reported
H:MM AM/PM` lower third, 2s dark branded end-card composited over the
   tail (with the short-URL slug when kit.shortUrlSlug is present).
8. Bundle uploaded to `clips/{clipId}/` and the clip is marked `ready` with
   `outputPaths = { video, captions, poster, kit }` (bare S3 keys).

---

## 4. Local smoke test (real ffmpeg, no AWS)

CI never runs ffmpeg — `src/lib/clipTemplate.test.ts` pins the ffmpeg
arguments as golden-args tests, and `src/lambdas/__tests__/renderClip.test.ts`
mocks the S3/ffmpeg boundaries. To verify the actual pixels locally:

### 4a. Prerequisites

- A local `ffmpeg` with freetype (macOS: `brew install ffmpeg`; Debian:
  `apt install ffmpeg`), OR Docker.
- A sample phone video (portrait or landscape MP4, ≤90s), e.g.
  `sample.mp4`.

### 4b. Run the render smoke script

`scripts/renderClipSmoke.ts` builds the same plan the lambda would, writes
the caption/lower-third/end-card text files, and runs your local ffmpeg:

```bash
npx ts-node scripts/renderClipSmoke.ts sample.mp4 "The line is around the block!"
```

Output lands in a fresh `/tmp/clip-smoke-*` directory: `clip.mp4`,
`clip.srt`, `poster.jpg`. Open `clip.mp4` and check:

- 1080x1920 (9:16), source center-cropped;
- caption in the bottom third (≤2 lines);
- `CITY, ST` + `reported H:MM AM/PM` lower third above the caption;
- last ~2s replaced by the dark "Pizza to the Polls / polls.pizza" end-card.

### 4c. Run inside Docker (matches the Lambda layer environment)

```bash
docker run --rm -v "$PWD:/work" -w /work public.ecr.aws/lambda/nodejs:22 \
  bash -c "cd /tmp && unzip -q /work/ffmpeg-layer.zip && \
    npx --prefix /work ts-node --prefix /work /work/scripts/renderClipSmoke.ts \
    /work/sample.mp4"
```

(With `FFMPEG_PATH=/opt/bin/ffmpeg` if your shell doesn't inherit it — the
script honors `FFMPEG_PATH`.)

---

## 5. Post-deploy verification

### 5a. Verify the function exists

```bash
aws lambda list-functions --region us-west-2 \
  --query "Functions[?FunctionName=='pizzabase-prod-renderClip'].FunctionName"
```

### 5b. Smoke-test a render end-to-end

```bash
# 1. Create a clip (needs a clean, ready upload id and the API key)
curl -X POST https://base.polls.pizza/clips \
  -H 'Authorization: Basic <api-key>' \
  -H 'Content-Type: application/json' \
  -d '{"uploadId": 42, "city": "Portland", "state": "OR",
       "reportedAt": "2024-11-05T14:30:00Z", "captionText": "Long lines!"}'

# 2. Watch the logs
aws logs tail /aws/lambda/pizzabase-prod-renderClip --region us-west-2 --follow

# 3. Check the bundle landed
aws s3 ls s3://reports.polls.pizza/clips/<clipId>/
#   → clip.mp4, clip.srt, poster.jpg, kit.json

# 4. Check the clip reached ready
curl -H 'Authorization: Basic <api-key>' \
  https://base.polls.pizza/clips/<clipId>
#   → status: "ready", outputPaths populated
```

### 5c. Exercise the guardrails

- **Budget:** set `RENDER_DAILY_BUDGET=0` for the stage, create a clip → it
  stays `queued`, function logs "budget exhausted".
- **Duration:** point a clip at a >90s source (or invoke directly with a
  crafted upload) → `rejected` with "exceeds the 90s clip limit".
- **Double-invoke:** `aws lambda invoke --function-name
pizzabase-prod-renderClip --payload '{"clipId":<id>}'` twice → second run
  logs "not queued — skipping".

---

## Summary

| #         | Item                                          | Manual?                                         | Time        |
| --------- | --------------------------------------------- | ----------------------------------------------- | ----------- |
| 1         | ffmpeg Lambda layer (static build + font)     | Yes (one-time, `scripts/build-ffmpeg-layer.sh`) | 10 min      |
| 2         | serverless.yml function config                | Automated                                       | —           |
| 3         | Optional: `RENDER_DAILY_BUDGET` GitHub secret | Yes                                             | 1 min       |
| 4         | Local smoke test of the render                | Yes (documented above)                          | 5 min       |
| 5         | Deploy + post-deploy verification             | Automated / above                               | 5 min       |
| **Total** |                                               |                                                 | **~20 min** |
