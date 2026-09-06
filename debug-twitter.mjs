import crypto from "crypto";
import { readFile } from "fs/promises";

// Load .env
const env = {};
try {
  const raw = await readFile(".env", "utf8");
  for (const line of raw.split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length) env[k.trim()] = v.join("=").replace(/^["']|["']$/g, "");
  }
} catch (e) {
  console.error("No .env found — put your Twitter creds in .env at /tmp/social-fixes");
  process.exit(1);
}

const {
  TWITTER_API_KEY,
  TWITTER_API_SECRET,
  TWITTER_ACCESS_TOKEN,
  TWITTER_ACCESS_SECRET,
} = env;

const missing = [];
for (const k of ["TWITTER_API_KEY","TWITTER_API_SECRET","TWITTER_ACCESS_TOKEN","TWITTER_ACCESS_SECRET"]) {
  if (!env[k]) missing.push(k);
}
if (missing.length) {
  console.error("Missing:", missing.join(", "));
  process.exit(1);
}

function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, "%21").replace(/\*/g, "%2A").replace(/'/g, "%27")
    .replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function oauthHeader(method, baseUrl, params = {}) {
  const oauthParams = {
    oauth_consumer_key: TWITTER_API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: TWITTER_ACCESS_TOKEN,
    oauth_version: "1.0",
  };
  const all = { ...params, ...oauthParams };
  const sorted = Object.keys(all).sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(all[k])}`)
    .join("&");
  const base = `${method.toUpperCase()}&${percentEncode(baseUrl)}&${percentEncode(sorted)}`;
  const key = `${percentEncode(TWITTER_API_SECRET)}&${percentEncode(TWITTER_ACCESS_SECRET)}`;
  const sig = crypto.createHmac("sha1", key).update(base).digest("base64");
  const headerParams = { ...oauthParams, oauth_signature: sig };
  return "OAuth " + Object.entries(headerParams)
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(", ");
}

// 1. Verify credentials first (cheaper than a tweet)
console.log("1. Verifying credentials...");
const verifyUrl = "https://api.twitter.com/2/users/me";
const verifyOAuth = oauthHeader("GET", verifyUrl);
const verifyRes = await fetch(verifyUrl, {
  headers: { Authorization: verifyOAuth },
});
console.log("   Status:", verifyRes.status);
const verifyBody = await verifyRes.text();
console.log("   Body:", verifyBody.substring(0, 300));

if (verifyRes.ok) {
  // 2. Post a test tweet
  console.log("\n2. Posting test tweet...");
  const tweetUrl = "https://api.twitter.com/2/tweets";
  const tweetOAuth = oauthHeader("POST", tweetUrl);
  const tweetRes = await fetch(tweetUrl, {
    method: "POST",
    headers: {
      Authorization: tweetOAuth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: "Pizzabase staging test — please ignore 🍕" }),
  });
  console.log("   Status:", tweetRes.status);
  console.log("   Body:", await tweetRes.text());
} else {
  console.log("\nCredentials failed — check the four values in .env");
  console.log("API Key length:", TWITTER_API_KEY.length);
  console.log("API Secret length:", TWITTER_API_SECRET.length);
  console.log("Access Token length:", TWITTER_ACCESS_TOKEN.length);
  console.log("Access Secret length:", TWITTER_ACCESS_SECRET.length);
}
