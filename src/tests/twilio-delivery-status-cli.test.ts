import { parseArgs, main } from "../../scripts/twilio-delivery-status";
import {
  formatMessageTable,
  formatNoMessagesFound,
} from "../lib/twilio/deliveryStatus";

const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

afterEach(() => {
  logSpy.mockClear();
  errorSpy.mockClear();
});

describe("scripts/twilio-delivery-status parseArgs", () => {
  it("parses --to, --after, --before, --json, and --dry-run", () => {
    const args = parseArgs([
      "--to",
      "+15551234567",
      "--after",
      "2024-11-01",
      "--before",
      "2024-11-07",
      "--json",
      "--dry-run",
    ]);
    expect(args).toEqual({
      to: "+15551234567",
      after: "2024-11-01",
      before: "2024-11-07",
      json: true,
      dryRun: true,
    });
  });

  it("parses --sid and --secret-name", () => {
    const args = parseArgs([
      "--sid",
      "SMa1b2c3d4e5f67890",
      "--secret-name",
      "PizzaBase/twilio/custom",
    ]);
    expect(args).toEqual({
      sid: "SMa1b2c3d4e5f67890",
      secretName: "PizzaBase/twilio/custom",
    });
  });

  it("throws on unknown arguments", () => {
    expect(() => parseArgs(["--bogus", "value"])).toThrow(/Unknown argument/);
  });
});

describe("scripts/twilio-delivery-status main", () => {
  it("returns 1 when neither --to nor --sid is given", async () => {
    const code = await main([]);
    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("At least one of"),
    );
  });

  it("dry run prints the query plan and makes no requests", async () => {
    const fetchMock = global.fetch as jest.Mock;
    const code = await main(["--to", "+15551234567", "--dry-run"]);

    expect(code).toBe(0);
    const output = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Dry run");
    expect(output).toContain("To=+15551234567");
    expect(output).toContain("PageSize=1000");
    expect(output).toContain("GET https://api.twilio.com");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("dry run with --sid shows MessageSid and no To param", async () => {
    const code = await main(["--sid", "SMa1b2c3d4e5f67890", "--dry-run"]);
    expect(code).toBe(0);
    const output = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("MessageSid=SMa1b2c3d4e5f67890");
    expect(output).not.toContain("To=");
  });
});

describe("deliveryStatus formatting helpers", () => {
  const messages = [
    {
      sid: "SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      to: "+15551234567",
      from: "+15559876543",
      dateCreated: "2024-11-05T12:00:00Z",
      date_sent: "2024-11-05T12:00:01Z",
      status: "delivered",
      "error-code": null,
      "message-sid": null,
      direction: "outbound-api",
    },
    {
      sid: "SMbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      to: "+15551234567",
      from: "+15559876543",
      dateCreated: "2024-11-05T13:00:00Z",
      status: "failed",
      "error-code": "30006",
      "message-sid": null,
      direction: "outbound-api",
    },
  ];

  it("formatMessageTable renders a header and one row per message", () => {
    const table = formatMessageTable(messages);
    const lines = table.split("\n");
    expect(lines[0]).toContain("MessageSID");
    expect(lines[0]).toContain("Direction");
    expect(lines[0]).toContain("Status");
    expect(lines[0]).toContain("Error");
    expect(lines[0]).toContain("Date Sent");
    expect(lines).toHaveLength(2 + messages.length); // header + separator + rows
    expect(lines[2]).toContain("SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(lines[2]).toContain("Delivered");
    expect(lines[3]).toContain("Failed [code: 30006]");
    expect(lines[3]).toContain("30006");
  });

  it("formatMessageTable shows an em dash for null error codes", () => {
    const table = formatMessageTable([messages[0]]);
    expect(table).toContain("—");
  });

  it("formatMessageTable falls back to dateCreated when date_sent is missing", () => {
    const table = formatMessageTable([messages[1]]);
    expect(table).toContain("2024-11-05T13:00:00Z");
  });

  it("formatNoMessagesFound includes the identifier", () => {
    expect(formatNoMessagesFound("+15551234567")).toBe(
      "No messages found for +15551234567.",
    );
  });
});
