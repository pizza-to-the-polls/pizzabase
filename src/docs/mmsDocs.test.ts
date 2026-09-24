/**
 * MMS-006 regression guard: documentation must stay in sync with the
 * environment variables the MMS reply workflow actually consumes.
 *
 * These tests are deliberately file-content based (no DB, no HTTP): they
 * assert that
 *   1. every MMS env var is documented in .env.example with a comment,
 *   2. serverless.yml passes each var through to the Lambda environment,
 *   3. the operations runbook (docs/mms-reply-workflow.md) covers the
 *      behaviors called out in epic #255, and
 *   4. the prod webhook hostname documented in the runbook matches
 *      customDomain.domainName in serverless.yml.
 */

import { readFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..", "..");

const envExample = readFileSync(path.join(ROOT, ".env.example"), "utf8");
const runbook = readFileSync(
  path.join(ROOT, "docs", "mms-reply-workflow.md"),
  "utf8",
);
const serverlessYml = readFileSync(path.join(ROOT, "serverless.yml"), "utf8");

interface EnvVarDoc {
  key: string;
  value: string;
  comment: string | null;
}

/** Parse KEY=value pairs with the immediately preceding comment (if any). */
function parseEnvExample(content: string): Map<string, EnvVarDoc> {
  const docs = new Map<string, EnvVarDoc>();
  let lastComment: string | null = null;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("#")) {
      lastComment = line.replace(/^#+\s*/, "");
      continue;
    }
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) {
      docs.set(match[1], {
        key: match[1],
        value: match[2],
        comment: lastComment,
      });
      lastComment = null;
    }
  }
  return docs;
}

describe("MMS env var documentation (MMS-006)", () => {
  const MMS_ENV_VARS = [
    "TWILIO_AUTH_TOKEN",
    "MMS_SLACK_WEBHOOK_URL",
    "MMS_MATCH_WINDOW_DAYS",
  ] as const;

  describe(".env.example", () => {
    const docs = parseEnvExample(envExample);

    it.each(MMS_ENV_VARS)("documents %s", (key) => {
      expect(docs.has(key)).toBe(true);
    });

    it.each(MMS_ENV_VARS)("has a comment above %s", (key) => {
      expect(docs.get(key)!.comment).not.toBeNull();
      expect(docs.get(key)!.comment!.length).toBeGreaterThan(0);
    });

    it("defaults MMS_MATCH_WINDOW_DAYS to 30", () => {
      expect(docs.get("MMS_MATCH_WINDOW_DAYS")!.value).toBe("30");
    });

    it("leaves the secret vars empty (no committed credentials)", () => {
      expect(docs.get("TWILIO_AUTH_TOKEN")!.value).toBe("");
      expect(docs.get("MMS_SLACK_WEBHOOK_URL")!.value).toBe("");
    });

    it("marks Slack webhook optional (disabled when unset)", () => {
      expect(docs.get("MMS_SLACK_WEBHOOK_URL")!.comment).toMatch(
        /unset = feature disabled/i,
      );
    });
  });

  describe("serverless.yml", () => {
    it.each(MMS_ENV_VARS)("passes %s to the Lambda environment", (key) => {
      expect(serverlessYml).toMatch(
        new RegExp(`^\\s+${key}: \\$\\{env:${key}`, "m"),
      );
    });
  });

  describe("docs/mms-reply-workflow.md runbook", () => {
    it.each([
      "POST /twilio/inbound",
      "X-Twilio-Signature",
      "MMS_SLACK_WEBHOOK_URL",
      "MMS_MATCH_WINDOW_DAYS",
      "TWILIO_AUTH_TOKEN",
      "media_status",
      "BannedPhoneNumber",
      "fileHash|file_hash",
      "raw\\.polls\\.pizza",
      "media\\.polls\\.pizza",
      "Retool",
      "5 ?MB",
    ])("mentions %s", (pattern) => {
      expect(runbook).toMatch(new RegExp(pattern, "i"));
    });

    it("references epic #255", () => {
      expect(runbook).toMatch(/issues\/255/);
    });

    it("documents the Twilio console navigation path", () => {
      expect(runbook).toMatch(
        /Phone Numbers[\s\S]*Manage[\s\S]*Active numbers/,
      );
      expect(runbook).toMatch(/A MESSAGE COMES IN/);
      expect(runbook).toMatch(/\*\*Method:\*\*\s*`POST`/);
    });

    it("covers the staging checklist verification steps", () => {
      expect(runbook).toMatch(/source='mms'/);
      expect(runbook).toMatch(/STOP opt-out works/);
      expect(runbook).toMatch(/signature verification failed/i);
      expect(runbook).toMatch(/Bugsnag/);
    });

    it("documents the prod webhook URL from serverless.yml customDomain", () => {
      const domainMatch = serverlessYml.match(/^\s+domainName:\s*(\S+)/m);
      expect(domainMatch).not.toBeNull();
      const domain = domainMatch![1];
      expect(runbook).toContain(`https://${domain}/twilio/inbound`);
    });

    it("notes the ~4h Twilio media URL expiry", () => {
      expect(runbook).toMatch(/4 ?h/i);
    });
  });
});
