import { execFileSync } from "child_process";

// Types
interface TwilioMessage {
  sid: string;
  to: string;
  from: string;
  dateCreated: string;
  date_sent?: string;
  date_created?: string;
  status: string;
  "error-code": string | null;
  "message-sid": string | null;
  direction: string;
}

interface Credentials {
  accountSid: string;
  authToken: string;
}

interface TwilioParams {
  to?: string;
  sid?: string;
  after?: string;
  before?: string;
}

interface TwilioMessagesResponse {
  messages: TwilioMessage[];
  next_page_uri?: string | null;
}

// Library Functions

/**
 * Normalizes a phone number string by stripping non-digit/non-plus characters.
 */
export function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

/**
 * Maps Twilio status values to human-readable strings.
 */
export function formatTwilioStatus(
  status: string,
  errorCode?: string | null,
): string {
  switch (status.toLowerCase()) {
    case "queued":
      return "Queued";
    case "sending":
      return "Sending";
    case "sent":
      return "Sent";
    case "delivered":
      return "Delivered";
    case "undelivered":
      return "Undelivered";
    case "failed": {
      const code = errorCode || "UNKNOWN";
      return `Failed [code: ${code}]`;
    }
    default:
      return status;
  }
}

/**
 * Formats the Twilio error code.
 */
export function formatTwilioError(code: string | null): string {
  if (code === null || code === undefined || code === "") {
    return "—";
  }
  return code;
}

/**
 * Renders the table of message rows for human-readable CLI output.
 */
export function formatMessageTable(messages: TwilioMessage[]): string {
  const header = [
    "MessageSID".padEnd(36),
    "Direction".padEnd(14),
    "Status".padEnd(28),
    "Error".padEnd(8),
    "Date Sent",
  ];
  const lines = [header.join("  "), "-".repeat(105)];
  for (const m of messages) {
    lines.push(
      [
        (m.sid ?? "").padEnd(36),
        (m.direction ?? "").padEnd(14),
        formatTwilioStatus(m.status, m["error-code"]).padEnd(28),
        formatTwilioError(m["error-code"]).padEnd(8),
        m.date_sent ?? m.dateCreated ?? "",
      ].join("  "),
    );
  }
  return lines.join("\n");
}

/**
 * Renders the "no messages found" notice for human-readable CLI output.
 */
export function formatNoMessagesFound(identifier: string): string {
  return `No messages found for ${identifier}.`;
}

/**
 * Signature of `child_process.execFileSync`, injected so tests can mock the
 * AWS CLI subprocess call without redefining module properties.
 */
type ExecFileSyncFn = (
  file: string,
  args: string[],
  options: { encoding: string },
) => string | Buffer;

/**
 * Fetches Twilio credentials from environment variables or AWS Secrets Manager
 * (via the `aws` CLI). The subprocess function is injectable for testing.
 */
export async function fetchTwilioCredentials(
  { secretName }: { secretName?: string } = {},
  execFileFn: ExecFileSyncFn = execFileSync,
): Promise<Credentials> {
  const SID = process.env.TWILIO_ACCOUNT_SID;
  const TOKEN = process.env.TWILIO_AUTH_TOKEN;

  if (SID && TOKEN) {
    console.log("Using Twilio credentials from environment variables.");
    return { accountSid: SID, authToken: TOKEN };
  }

  const defaultSecretName = "PizzaBase/twilio/read-only";
  const nameToUse = secretName || defaultSecretName;

  try {
    console.log(
      `Attempting to fetch credentials from AWS Secrets Manager: ${nameToUse}`,
    );

    // execFileSync (not shell string) so the secret name is never interpolated
    // through a shell — the argv array is passed directly to the aws binary.
    const secretJson = execFileFn(
      "aws",
      [
        "secretsmanager",
        "get-secret-value",
        "--secret-id",
        nameToUse,
        "--query",
        "SecretString",
        "--output",
        "text",
      ],
      { encoding: "utf-8" },
    );
    const secret = JSON.parse(String(secretJson));

    // Secrets Manager returns { accountSid, authToken } or just a string containing them.
    // Assuming the secret structure is {"accountSid": "...", "authToken": "..."}
    const accountSid = secret.accountSid || secret.TWILIO_ACCOUNT_SID;
    const authToken = secret.authToken || secret.TWILIO_AUTH_TOKEN;

    if (accountSid && authToken) {
      console.log(
        "Successfully fetched Twilio credentials from AWS Secrets Manager.",
      );
      return { accountSid, authToken };
    } else {
      throw new Error(
        "Secrets retrieved, but SID or Auth Token were missing in the secret value.",
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("command not found") ||
        error.message.includes("ENOENT") ||
        (error as NodeJS.ErrnoException).code === "ENOENT")
    ) {
      throw new Error(
        `AWS CLI not found. Please ensure the 'aws' command is available on the system PATH to use Secrets Manager, or set TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN environment variables.`,
      );
    }
    throw new Error(
      `Failed to retrieve credentials from AWS Secrets Manager (${nameToUse}). Error: ${error.message}`,
    );
  }
}

/**
 * Queries the Twilio Messages API for messages matching the criteria.
 * Handles pagination and formats the response.
 * @returns Array of TwilioMessage objects
 */
export async function queryTwilioMessages(
  accountSid: string,
  authToken: string,
  params: TwilioParams,
): Promise<TwilioMessage[]> {
  const allMessages: TwilioMessage[] = [];
  const baseEndpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  const parts: string[] = ["PageSize=1000"];
  if (params.sid) {
    parts.push(`MessageSid=${encodeURIComponent(params.sid)}`);
  }
  if (params.to) {
    parts.push(`To=${encodeURIComponent(params.to)}`);
  }
  if (params.after) {
    parts.push(`DateSent%3E=${params.after}`);
  }
  if (params.before) {
    parts.push(`DateSent%3C=${params.before}`);
  }
  let url: string | null = `${baseEndpoint}?${parts.join("&")}`;

  let page = 0;
  while (url) {
    page += 1;
    console.log(
      `[API Call] Fetching page ${page} from URL: ${url.slice(0, 150)}...`,
    );

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        let errorData: { message?: string } = {};
        try {
          errorData = JSON.parse(errorBody);
        } catch {
          // Ignore non-JSON error body
        }
        throw new Error(
          `Twilio API Error: ${response.status} - ${errorData.message || "Unknown error"}. Details: ${errorBody}`,
        );
      }

      const data = (await response.json()) as TwilioMessagesResponse;
      const messages: TwilioMessage[] = data.messages || [];
      allMessages.push(...messages);

      // Twilio pages are 0-indexed and expose the full next page URI when
      // more results remain. Follow it (never guessed) until exhausted.
      const nextUri: string | null = data.next_page_uri ?? null;
      url = nextUri ? `https://api.twilio.com${nextUri}` : null;
    } catch (error) {
      console.error("Twilio Message Query Error:", error);
      // Re-throw structured error
      throw new Error(`Failed to query messages from Twilio: ${error.message}`);
    }
  }

  return allMessages;
}
