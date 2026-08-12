# Issue #164 — Infrastructure Setup Guide

## Overview

Two PRs implement the async media pipeline. This guide covers the infra pieces
that can't be deployed automatically via serverless framework.

**PRs:**
- Backend: https://github.com/pizza-to-the-polls/pizzabase/pull/189
- Frontend: https://github.com/pizza-to-the-polls/polls.pizza/pull/109

**Architecture:**
```
raw.polls.pizza (NEW, private)          reports.polls.pizza (EXISTING, public)
      │                                         ▲
      │  presigned upload                       │ WebP/JPEG/MP4 outputs
      │  raw_file_path                          │ file_path (primary)
      │                                         │ processed_file_path (variants)
      │  on-s3-upload-process-exif              │
      ├── extract EXIF → DB ────────────────────┤
      │                                         │
      │  on-media-format (sharp layer)          │
      ├── resize/transcode ─────────────────────┤
      │  strip metadata                         │
      └─────────────────────────────────────────┘
```

---

## 1. Create raw.polls.pizza S3 bucket

### 1a. Create the bucket

```bash
aws s3api create-bucket \
  --bucket raw.polls.pizza \
  --region us-west-2 \
  --create-bucket-configuration LocationConstraint=us-west-2
```

### 1b. Block all public access

```bash
aws s3api put-public-access-block \
  --bucket raw.polls.pizza \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

### 1c. Set lifecycle policy (delete after 365 days)

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket raw.polls.pizza \
  --lifecycle-configuration '{
    "Rules": [
      {
        "ID": "expire-after-365-days",
        "Status": "Enabled",
        "Expiration": { "Days": 365 }
      }
    ]
  }'
```

### 1d. Set CORS (needed for presigned browser uploads)

```bash
aws s3api put-bucket-cors \
  --bucket raw.polls.pizza \
  --cors-configuration '{
    "CORSRules": [
      {
        "AllowedOrigins": ["https://polls.pizza"],
        "AllowedMethods": ["POST", "PUT"],
        "AllowedHeaders": ["*"],
        "MaxAgeSeconds": 3600
      }
    ]
  }'
```

---

## 2. Create MediaConvert IAM role

### 2a. Create trust policy file

```bash
cat > /tmp/mediaconvert-trust.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "mediaconvert.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
```

### 2b. Create the role

```bash
aws iam create-role \
  --role-name MediaConvertRole \
  --assume-role-policy-document file:///tmp/mediaconvert-trust.json
```

### 2c. Attach S3 access policy

```bash
cat > /tmp/mediaconvert-s3-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:GetObjectVersion"],
      "Resource": "arn:aws:s3:::raw.polls.pizza/*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::reports.polls.pizza/*"
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name MediaConvertRole \
  --policy-name MediaConvertS3Access \
  --policy-document file:///tmp/mediaconvert-s3-policy.json
```

### 2d. Get the role ARN (save this for secrets step)

```bash
aws iam get-role --role-name MediaConvertRole --query 'Role.Arn' --output text
```

---

## 3. Set up sharp Lambda layer

### 3a. Check if a public layer exists

The `@img/sharp-lambda-layer` package publishes public layers. Check if one is
available for your region and Node version:

```bash
aws lambda list-layers --region us-west-2 | grep -i sharp
```

If a layer exists, grab its ARN. If not, create one:

### 3b. Create layer from scratch (only if no public layer available)

```bash
mkdir -p /tmp/sharp-layer/nodejs
cd /tmp/sharp-layer/nodejs
npm init -y
npm install sharp --platform=linux --arch=x64
cd /tmp/sharp-layer
zip -r /tmp/sharp-layer.zip nodejs

aws lambda publish-layer-version \
  --layer-name sharp \
  --zip-file fileb:///tmp/sharp-layer.zip \
  --compatible-runtimes nodejs22.x \
  --region us-west-2
```

### 3c. Get the layer ARN

```bash
aws lambda list-layer-versions \
  --layer-name sharp \
  --region us-west-2 \
  --query 'LayerVersions[0].LayerVersionArn' \
  --output text
```

**Note:** Update the layer ARN in `serverless.yml` if it differs from the
placeholder `arn:aws:lambda:us-west-2:${env:AWS_ACCOUNT_ID}:layer:sharp:1`.

---

## 4. Add GitHub Secrets

Go to: https://github.com/pizza-to-the-polls/pizzabase/settings/secrets/actions

Add these secrets:

| Secret | Value |
|--------|-------|
| `RAW_UPLOADS_BUCKET` | `raw.polls.pizza` |
| `MEDIACONVERT_ROLE_ARN` | `arn:aws:iam::ACCOUNT_ID:role/MediaConvertRole` |
| `AWS_ACCOUNT_ID` | Your AWS account ID (for layer ARN resolution) |

The existing `UPLOAD_S3_BUCKET` secret (already set to `reports.polls.pizza`)
doesn't need to change — it stays as the processed/public bucket.

---

## 5. Update deploy.yml

Add the new secrets to the deploy step in `.github/workflows/deploy.yml`:

```yaml
      - name: deploy to aws
        uses: serverless/github-action@v4.0.0
        with:
          args: deploy --stage prod
        env:
          # ... existing secrets ...

          RAW_UPLOADS_BUCKET: ${{ secrets.RAW_UPLOADS_BUCKET }}
          MEDIACONVERT_ROLE_ARN: ${{ secrets.MEDIACONVERT_ROLE_ARN }}
          AWS_ACCOUNT_ID: ${{ secrets.AWS_ACCOUNT_ID }}
```

---

## 6. Verify serverless.yml Lambda triggers

The serverless.yml references `raw.polls.pizza` with `existing: true` for S3
triggers. Serverless Framework won't create the bucket — it just wires the
trigger to the existing one. This is correct since we created it in step 1.

```yaml
on-s3-upload-process-exif:
  events:
    - s3:
        bucket: raw.polls.pizza
        event: s3:ObjectCreated:*
        existing: true

on-media-format:
  events:
    - s3:
        bucket: raw.polls.pizza
        event: s3:ObjectCreated:*
        existing: true
```

---

## 7. Deploy

Once the PRs are merged to `feature/async-media-pipeline`:

```bash
# Merge integration branch to master
git checkout master
git merge feature/async-media-pipeline
git push origin master
```

The `deploy.yml` workflow will:
1. Run tests
2. Build TypeScript
3. Run pre-deploy health check
4. Deploy via serverless (main app + 3 new Lambdas)
5. Run DB migrations
6. Run post-deploy health check (auto-rollback on failure)

---

## 8. Post-deploy verification

### 8a. Verify Lambdas exist

```bash
aws lambda list-functions --region us-west-2 \
  --query "Functions[?starts_with(FunctionName, 'pizzabase-prod-on-')].FunctionName"
```

Expected: `pizzabase-prod-on-s3-upload-process-exif`,
`pizzabase-prod-on-media-format`, `pizzabase-prod-on-mediaconvert-complete`

### 8b. Test upload flow

```bash
# Request a presigned URL
curl -X POST https://base.polls.pizza/upload \
  -H 'Content-Type: application/json' \
  -d '{
    "fileHash": "test-hash-'$(date +%s)'",
    "fileName": "test.jpg",
    "address": "123 Main St, Portland, OR 97204"
  }'
```

### 8c. Check EXIF endpoint still works for old uploads

```bash
curl -H 'Authorization: Basic <api-key>' \
  https://base.polls.pizza/uploads/<existing-file-name>/exif
```

### 8d. Check DB migration ran

```bash
# Connect to DB and verify new columns exist on uploads table
# Expected columns: raw_file_path, media_status, processed_file_path,
# exif_extracted, exif_scrubbed, exif_data, moderation_status,
# moderation_score, raw_bucket
```

---

## Summary

| # | Item | Manual? | Time |
|---|------|---------|------|
| 1 | `raw.polls.pizza` bucket + CORS + lifecycle | Yes (or add CloudFormation to serverless.yml) | 5 min |
| 2 | MediaConvert IAM role | Yes (one-time) | 3 min |
| 3 | sharp Lambda layer | One-time (public layer may already exist) | 5 min |
| 4 | GitHub Secrets (3 new) | Yes | 2 min |
| 5 | deploy.yml update | Yes (edit + commit) | 2 min |
| 6 | Verify + deploy | Automated via GitHub Actions | — |
| **Total** | | | **~17 min** |
