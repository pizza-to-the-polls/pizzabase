import {
  formatMessageTable,
  formatNoMessagesFound,
  normalizePhone,
  formatTwilioStatus,
  formatTwilioError,
  fetchTwilioCredentials,
  queryTwilioMessages,
} from "./deliveryStatus";

const TWILIO_ACCOUNT_SID_ENV = "TWILIO_ACCOUNT_SID";
const TWILIO_AUTH_TOKEN_ENV = "TWILIO_AUTH_TOKEN";

const ACCOUNT_SID = "AC1234567890abcdef1234567890abcd";
const AUTH_TOKEN = "test-read-only-token";

const fetchMock = global.fetch as jest.Mock;

describe("normalizePhone", () => {
  it("strips dashes, parens, and spaces, keeps +", () => {
    expect(normalizePhone("(555) 123-4567")).toBe("5551234567");
    expect(normalizePhone("+1 (555) 123-4567")).toBe("+15551234567");
    expect(normalizePhone("+1-555-123-4567")).toBe("+15551234567");
  });

  it("passes a clean E.164 number through unchanged", () => {
    expect(normalizePhone("+15551234567")).toBe("+15551234567");
  });

  it("does not add a + prefix to bare 10-digit numbers", () => {
    // Intentional: normalization is only formatting cleanup, not
    // canonicalization. Country code inference is out of scope.
    expect(normalizePhone("5551234567")).toBe("5551234567");
  });
});

describe("formatTwilioStatus", () => {
  it.each([
    ["queued", "Queued"],
    ["sending", "Sending"],
    ["sent", "Sent"],
    ["delivered", "Delivered"],
    ["undelivered", "Undelivered"],
  ])("maps %s to %s", (status, expected) => {
    expect(formatTwilioStatus(status)).toBe(expected);
  });

  it("maps failed with an error code to 'Failed [code: NNNN]'", () => {
    expect(formatTwilioStatus("failed", "30006")).toBe("Failed [code: 30006]");
  });

  it("maps failed without an error code to 'Failed [code: UNKNOWN]'", () => {
    expect(formatTwilioStatus("failed")).toBe("Failed [code: UNKNOWN]");
    expect(formatTwilioStatus("failed", null)).toBe("Failed [code: UNKNOWN]");
  });

  it("returns unknown statuses raw", () => {
    expect(formatTwilioStatus("some-new-status")).toBe("some-new-status");
  });
});

describe("formatTwilioError", () => {
  it("returns an em dash for null", () => {
    expect(formatTwilioError(null)).toBe("—");
  });

  it("returns the code as-is for a present code", () => {
    expect(formatTwilioError("30006")).toBe("30006");
  });

  it("returns an em dash for an empty string", () => {
    expect(formatTwilioError("")).toBe("—");
  });
});

describe("formatMessageTable", () => {
  it("renders a header, separator, and one row per message", () => {
    const table = formatMessageTable([
      {
        sid: "SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        to: "+15551234567",
        from: "+15559876543",
        dateCreated: "2024-11-05T12:00:00Z",
        date_sent: "2024-11-05T12:00:00Z",
        status: "delivered",
        "error-code": null,
        "message-sid": null,
        direction: "outbound-api",
      },
    ]);
    const lines = table.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("MessageSID");
    expect(lines[0]).toContain("Direction");
    expect(lines[0]).toContain("Status");
    expect(lines[0]).toContain("Error");
    expect(lines[0]).toContain("Date Sent");
    expect(lines[1]).toMatch(/^-+$/);
    expect(lines[2]).toContain("SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(lines[2]).toContain("outbound-api");
    expect(lines[2]).toContain("Delivered");
    expect(lines[2]).toContain("—");
  });

  it("shows the error code for failed messages", () => {
    const table = formatMessageTable([
      {
        sid: "SMbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        to: "+15551234567",
        from: "+15559876543",
        dateCreated: "2024-11-05T12:00:00Z",
        status: "failed",
        "error-code": "30006",
        "message-sid": null,
        direction: "outbound-api",
      },
    ]);
    expect(table).toContain("Failed [code: 30006]");
    expect(table).toContain("30006");
  });

  it("renders no rows for an empty message list", () => {
    const table = formatMessageTable([]);
    expect(table.split("\n")).toHaveLength(2);
  });
});

describe("formatNoMessagesFound", () => {
  it("includes the number that was looked up", () => {
    expect(formatNoMessagesFound("+15551234567")).toBe(
      "No messages found for +15551234567.",
    );
  });
});

describe("fetchTwilioCredentials", () => {
  const originalSid = process.env[TWILIO_ACCOUNT_SID_ENV];
  const originalToken = process.env[TWILIO_AUTH_TOKEN_ENV];

  // Plain jest.fn() injected as the execFileSync dependency — no module
  // property redefinition, which fails under ESM namespace objects.
  const execFileFn: jest.Mock = jest.fn(() => {
    throw new Error("not configured");
  });

  beforeEach(() => {
    delete process.env[TWILIO_ACCOUNT_SID_ENV];
    delete process.env[TWILIO_AUTH_TOKEN_ENV];
    execFileFn.mockReset();
    execFileFn.mockImplementation(() => {
      throw new Error("not configured");
    });
  });

  afterAll(() => {
    if (originalSid !== undefined) {
      process.env[TWILIO_ACCOUNT_SID_ENV] = originalSid;
    }
    if (originalToken !== undefined) {
      process.env[TWILIO_AUTH_TOKEN_ENV] = originalToken;
    }
  });

  it("returns env vars when both are set", async () => {
    process.env[TWILIO_ACCOUNT_SID_ENV] = ACCOUNT_SID;
    process.env[TWILIO_AUTH_TOKEN_ENV] = AUTH_TOKEN;

    const creds = await fetchTwilioCredentials(undefined, execFileFn);

    expect(creds).toEqual({ accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN });
    expect(execFileFn).not.toHaveBeenCalled();
  });

  it("falls back to AWS Secrets Manager when env vars are missing", async () => {
    const secretJson = JSON.stringify({
      accountSid: ACCOUNT_SID,
      authToken: AUTH_TOKEN,
    });
    execFileFn.mockReturnValue(Buffer.from(secretJson));

    const creds = await fetchTwilioCredentials(
      { secretName: "PizzaBase/twilio/custom" },
      execFileFn,
    );

    expect(creds).toEqual({ accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN });
    expect(execFileFn).toHaveBeenCalledWith(
      "aws",
      expect.arrayContaining([
        "secretsmanager",
        "get-secret-value",
        "--secret-id",
        "PizzaBase/twilio/custom",
      ]),
      expect.anything(),
    );
  });

  it("uses the default secret name when none is given", async () => {
    execFileFn.mockReturnValue(
      Buffer.from(
        JSON.stringify({ accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN }),
      ),
    );

    await fetchTwilioCredentials(undefined, execFileFn);

    expect(execFileFn).toHaveBeenCalledWith(
      "aws",
      expect.arrayContaining(["--secret-id", "PizzaBase/twilio/read-only"]),
      expect.anything(),
    );
  });

  it("throws a clear error when neither source is available", async () => {
    execFileFn.mockImplementation(() => {
      throw new Error("spawnSync aws ENOENT");
    });

    await expect(fetchTwilioCredentials(undefined, execFileFn)).rejects.toThrow(
      /AWS CLI not found|set TWILIO_ACCOUNT_SID/,
    );
  });

  it("throws when the secret value is missing fields", async () => {
    execFileFn.mockReturnValue(
      Buffer.from(JSON.stringify({ accountSid: ACCOUNT_SID })),
    );

    await expect(fetchTwilioCredentials(undefined, execFileFn)).rejects.toThrow(
      /Failed to retrieve credentials|SID or Auth Token/,
    );
  });
});

describe("queryTwilioMessages", () => {
  it("calls the correct URL with Basic auth and the To filter", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          messages: [],
          next_page_uri: null,
        }),
    });

    await queryTwilioMessages(ACCOUNT_SID, AUTH_TOKEN, {
      to: "+15551234567",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(
      `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
    );
    expect(url).toContain("To=%2B15551234567");
    expect(url).toContain("PageSize=1000");
    expect(init.method).toBe("GET");
    const expectedAuth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString(
      "base64",
    );
    expect(init.headers["Authorization"]).toBe(`Basic ${expectedAuth}`);
  });

  it("passes DateSent window params as query params", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ messages: [], next_page_uri: null }),
    });

    await queryTwilioMessages(ACCOUNT_SID, AUTH_TOKEN, {
      to: "+15551234567",
      after: "2024-11-01T00:00:00Z",
      before: "2024-11-07T00:00:00Z",
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("DateSent%3E=2024-11-01T00:00:00Z");
    expect(url).toContain("DateSent%3C=2024-11-07T00:00:00Z");
  });

  it("passes a MessageSid when provided", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ messages: [], next_page_uri: null }),
    });

    await queryTwilioMessages(ACCOUNT_SID, AUTH_TOKEN, {
      sid: "SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("MessageSid=SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(url).not.toContain("To=");
  });

  it("parses the returned messages", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          messages: [
            {
              sid: "SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              to: "+15551234567",
              from: "+15559876543",
              date_sent: "2024-11-05T12:00:00Z",
              status: "delivered",
              "error-code": null,
              direction: "outbound-api",
            },
          ],
          next_page_uri: null,
        }),
    });

    const messages = await queryTwilioMessages(ACCOUNT_SID, AUTH_TOKEN, {
      to: "+15551234567",
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].sid).toBe("SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(messages[0].status).toBe("delivered");
    expect(messages[0]["error-code"]).toBeNull();
  });

  it("follows next_page_uri across pages until exhausted", async () => {
    const pageOne = {
      ok: true,
      json: () =>
        Promise.resolve({
          messages: [{ sid: "SM1", status: "delivered", "error-code": null }],
          next_page_uri: `/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json?PageSize=1&Page=1&To=%2B15551234567`,
        }),
    };
    const pageTwo = {
      ok: true,
      json: () =>
        Promise.resolve({
          messages: [{ sid: "SM2", status: "failed", "error-code": "30006" }],
          next_page_uri: null,
        }),
    };
    fetchMock.mockResolvedValueOnce(pageOne).mockResolvedValueOnce(pageTwo);

    const messages = await queryTwilioMessages(ACCOUNT_SID, AUTH_TOKEN, {
      to: "+15551234567",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.sid)).toEqual(["SM1", "SM2"]);
    // The second request must follow Twilio's own next_page_uri
    const [secondUrl] = fetchMock.mock.calls[1];
    expect(secondUrl).toContain("Page=1");
  });

  it("returns an empty array when no messages match", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ messages: [], next_page_uri: null }),
    });

    const messages = await queryTwilioMessages(ACCOUNT_SID, AUTH_TOKEN, {
      to: "+15550000000",
    });

    expect(messages).toEqual([]);
  });

  it("throws a structured error on non-2xx responses", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () =>
        Promise.resolve(
          JSON.stringify({ message: "Authentication failed", code: 20001 }),
        ),
    });

    await expect(
      queryTwilioMessages(ACCOUNT_SID, "bad-token", { to: "+15551234567" }),
    ).rejects.toThrow(/Twilio API Error: 401/);
  });

  it("throws on invalid JSON responses", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.reject(new Error("Unexpected token < in JSON")),
    });

    await expect(
      queryTwilioMessages(ACCOUNT_SID, AUTH_TOKEN, { to: "+15551234567" }),
    ).rejects.toThrow(/Failed to query messages from Twilio/);
  });

  it("always issues GET requests (read-only enforcement)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: [], next_page_uri: null }),
    });

    await queryTwilioMessages(ACCOUNT_SID, AUTH_TOKEN, {
      to: "+15551234567",
    });

    for (const call of fetchMock.mock.calls) {
      expect(call[1].method).toBe("GET");
    }
  });
});
