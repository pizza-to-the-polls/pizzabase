#!/usr/bin/env npx ts-node
/**
 * Read-only Twilio delivery-status lookup helper (#351).
 *
 * Queries the Twilio Messages API (GET only) and reports message status,
 * error code, and direction for a recipient number, time window, or
 * MessageSid. Intended for ops investigations (pizza-eagle) — never sends,
 * updates, or deletes anything.
 *
 * Usage:
 *   npx ts-node scripts/twilio-delivery-status.ts --to +15551234567
 *   npx ts-node scripts/twilio-delivery-status.ts --to +15551234567 --after 2024-11-01 --before 2024-11-07
 *   npx ts-node scripts/twilio-delivery-status.ts --sid SMa1b2c3d4e5f67890
 *   npx ts-node scripts/twilio-delivery-status.ts --to +15551234567 --json
 *   npx ts-node scripts/twilio-delivery-status.ts --to +15551234567 --dry-run
 */
import {
  fetchTwilioCredentials,
  formatMessageTable,
  formatNoMessagesFound,
  normalizePhone,
  queryTwilioMessages,
} from "../src/lib/twilio/deliveryStatus";

interface CliArgs {
  to?: string;
  sid?: string;
  after?: string;
  before?: string;
  json?: boolean;
  dryRun?: boolean;
  secretName?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "--to":
        args.to = next;
        i++;
        break;
      case "--sid":
        args.sid = next;
        i++;
        break;
      case "--after":
        args.after = next;
        i++;
        break;
      case "--before":
        args.before = next;
        i++;
        break;
      case "--secret-name":
        args.secretName = next;
        i++;
        break;
      case "--json":
        args.json = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function credentialSource(): string {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    return "env vars (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)";
  }
  return "AWS Secrets Manager";
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (!args.to && !args.sid) {
    console.error(
      "At least one of --to <number> or --sid <messageSid> is required.",
    );
    return 1;
  }

  const to = args.to ? normalizePhone(args.to) : undefined;

  if (args.dryRun) {
    console.log("Dry run — no requests will be made (neither Twilio nor AWS).");
    console.log(`Credential source: ${credentialSource()}`);
    console.log(
      "Twilio endpoint:    GET https://api.twilio.com/2010-04-01/Accounts/{ACCOUNT_SID}/Messages.json",
    );
    console.log("Query params:");
    if (to) {
      console.log(`  To=${to}`);
    }
    if (args.sid) {
      console.log(`  MessageSid=${args.sid}`);
    }
    if (args.after) {
      console.log(`  DateSent>=${args.after}`);
    }
    if (args.before) {
      console.log(`  DateSent<=${args.before}`);
    }
    console.log("  PageSize=1000");
    return 0;
  }

  const creds = await fetchTwilioCredentials({ secretName: args.secretName });

  const messages = await queryTwilioMessages(
    creds.accountSid,
    creds.authToken,
    {
      to,
      sid: args.sid,
      after: args.after,
      before: args.before,
    },
  );

  if (args.json) {
    console.log(JSON.stringify(messages, null, 2));
    return 0;
  }

  if (messages.length === 0) {
    console.log(formatNoMessagesFound(to ?? args.sid ?? ""));
    return 0;
  }

  console.log(formatMessageTable(messages));
  console.log(`\n${messages.length} message(s) found.`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: Error) => {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    });
}
