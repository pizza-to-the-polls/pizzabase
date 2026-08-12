# Getting API Credentials for Social Posting

## BlueSky / AT Protocol

### 1. Create an app password

BlueSky uses **app passwords**, not your account password. This is a per-app
token that can be revoked independently.

1. Log into your BlueSky account at https://bsky.app
2. Go to **Settings** → **Privacy and Security** → **App Passwords**
   (or directly: https://bsky.app/settings/app-passwords)
3. Click **Add App Password**
4. Name it something descriptive like `Pizzabase`
5. Copy the generated password — **it is shown only once**

### 2. Environment variables

| Variable | Value |
|----------|-------|
| `BSKY_PDS_URL` | `https://bsky.social` (default PDS — only change if using a custom PDS) |
| `BSKY_HANDLE` | Your full handle, e.g. `polls.pizza` (without the `@`) |
| `BSKY_APP_PASSWORD` | The app password from step 5 (format: `xxxx-xxxx-xxxx-xxxx`) |

### 3. Test it

```bash
curl -X POST https://bsky.social/xrpc/com.atproto.server.createSession \
  -H "Content-Type: application/json" \
  -d '{"identifier": "polls.pizza", "password": "xxxx-xxxx-xxxx-xxxx"}'
```

You should get back a JSON response with `accessJwt`, `refreshJwt`, `did`, and
`handle`. If you get a 401, the credentials are wrong.

### 4. Set in AWS / SSM

The `serverless.yml` already references these:

```yaml
BSKY_PDS_URL: ${env:BSKY_PDS_URL}
BSKY_HANDLE: ${env:BSKY_HANDLE}
BSKY_APP_PASSWORD: ${env:BSKY_APP_PASSWORD}
```

Set them in the appropriate AWS SSM Parameter Store or GitHub environment
secrets for the deployment pipeline.

---

## Twitter / X

Twitter requires **OAuth 1.0a User Context** tokens (not OAuth 2.0) because
the v1.1 media upload API (needed for images and videos) does not support
OAuth 2.0.

### 1. Get a developer account

1. Go to https://developer.x.com
2. Sign up for a developer account (free tier is fine for posting)
3. You may need to verify a phone number and describe your use case

### 2. Create a project and app

1. Go to the **Developer Portal** → **Projects & Apps**
2. Create a new **Project** (name it `Polls.pizza` or `Pizzabase`)
3. Within the project, create a new **App**
4. Set the app permissions to **Read and Write** (needed for posting)

### 3. Generate OAuth 1.0a tokens

In your app's **Keys and Tokens** tab:

1. Note the **API Key** (consumer key) and **API Key Secret** (consumer secret)
   — these are generated automatically when the app is created
2. Under **Access Token and Secret**, click **Generate** if not already present
3. Copy the **Access Token** and **Access Token Secret**

These four values are long-lived and do not expire unless revoked.

### 4. Environment variables

| Variable | Description | Source |
|----------|-------------|--------|
| `TWITTER_API_KEY` | Consumer key / API key | From app's Keys and Tokens |
| `TWITTER_API_SECRET` | Consumer secret / API key secret | From app's Keys and Tokens |
| `TWITTER_ACCESS_TOKEN` | OAuth 1.0a access token | From app's Access Token section |
| `TWITTER_ACCESS_SECRET` | OAuth 1.0a token secret | From app's Access Token section |

### 5. Test it

The OAuth 1.0a signature generation is built into the `twitter.ts` module, so
you can't easily test with `curl`. Instead, deploy to staging and trigger a
test order, or write a small Node script using the `twitter.ts` module directly.

### 6. Set in AWS / SSM

```yaml
TWITTER_API_KEY: ${env:TWITTER_API_KEY}
TWITTER_API_SECRET: ${env:TWITTER_API_SECRET}
TWITTER_ACCESS_TOKEN: ${env:TWITTER_ACCESS_TOKEN}
TWITTER_ACCESS_SECRET: ${env:TWITTER_ACCESS_SECRET}
```

Set these alongside the BlueSky credentials in SSM or GitHub secrets.

---

## Threads (Meta / Instagram)

Threads uses the Instagram Graph API with OAuth 2.0. It's simpler than
Twitter's OAuth 1.0a — just a long-lived access token.

### 1. Create a Meta developer app

1. Go to https://developers.facebook.com
2. Create a new **App** (type: "Business" or "Something else" → "Consumer")
3. Name it `Polls.pizza` or `Pizzabase`
4. From the app dashboard, add the **Threads API** product:
   - Go to **Add Product** → find **Threads** → click **Set Up**

### 2. Get a Threads user access token

The easiest way to get a long-lived token for your own account:

1. Go to **Graph API Explorer** (https://developers.facebook.com/tools/explorer/)
2. Select your app from the dropdown
3. Under **User or Page**, select **Get User Access Token**
4. In the permissions dialog, add:
   - `threads_basic`
   - `threads_content_publish`
   - `threads_manage_insights` (optional)
5. Click **Generate Access Token**
6. Copy the short-lived token
7. Exchange it for a long-lived token (60 days):

```bash
curl -X GET "https://graph.threads.net/v1.0/access_token?\
  grant_type=th_exchange_token&\
  client_secret=YOUR_APP_SECRET&\
  access_token=SHORT_LIVED_TOKEN"
```

This returns a long-lived token valid for ~60 days.

### 3. Get your Threads user ID

```bash
curl -X GET "https://graph.threads.net/v1.0/me?\
  fields=id,username,threads_profile_picture_url&\
  access_token=LONG_LIVED_TOKEN"
```

Note the `id` field — this is your `THREADS_USER_ID`.

### 4. Environment variables

| Variable | Description | Source |
|----------|-------------|--------|
| `THREADS_ACCESS_TOKEN` | Long-lived access token | From step 2 |
| `THREADS_USER_ID` | Your Threads user ID | From step 3 |

### 5. Test it

```bash
# Post a simple text thread
curl -X POST "https://graph.threads.net/v1.0/YOUR_USER_ID/threads" \
  -H "Authorization: Bearer YOUR_LONG_LIVED_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello from Pizzabase test!", "media_type": "TEXT"}'
```

### 6. Set in AWS / SSM

```yaml
THREADS_ACCESS_TOKEN: ${env:THREADS_ACCESS_TOKEN}
THREADS_USER_ID: ${env:THREADS_USER_ID}
```

### 7. Token refresh

Long-lived tokens last ~60 days. You can refresh them before they expire:

```bash
curl -X GET "https://graph.threads.net/v1.0/refresh_access_token?\
  grant_type=th_refresh_token&\
  access_token=CURRENT_LONG_LIVED_TOKEN"
```

There's no auto-refresh in the module yet — tokens should be rotated manually
or via a scheduled job. Token expiry will surface as auth errors to Bugsnag.

---

## Quick reference card

```
AWS SSM or GitHub Secrets needed:

# BlueSky
BSKY_PDS_URL=https://bsky.social
BSKY_HANDLE=polls.pizza
BSKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx

# Twitter
TWITTER_API_KEY=xxxxxxxxxxxxxxxx
TWITTER_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWITTER_ACCESS_TOKEN=xxxxxxxxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxx
TWITTER_ACCESS_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# Threads
THREADS_ACCESS_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxx
THREADS_USER_ID=1234567890
```

---

## Revocation

- **BlueSky**: Go to Settings → App Passwords → delete the `Pizzabase` password
- **Twitter**: Go to Developer Portal → App → Keys and Tokens → Regenerate
  (this invalidates the old tokens immediately)
- **Threads**: Go to Meta Developer Portal → App → Roles → remove the user,
  or go to Facebook/Instagram Settings → Security → Apps and Websites → remove