import * as http_mocks from "node-mocks-http";
import crypto from "crypto";

// Mock the signature lib so tests control verification outcomes directly
// (real HMAC verification is covered in verifySignature.test.ts).
jest.mock("../lib/twilio/verifySignature", () => ({
  verifyTwilioSignature: jest.fn(),
}));
jest.mock("../lib/notifyBugsnag", () => ({ notifyBugsnag: jest.fn() }));
jest.mock("@aws-sdk/client-s3", () => {
  const original = jest.requireActual("@aws-sdk/client-s3");
  return {
    ...original,
    S3Client: jest.fn(),
    PutObjectCommand: jest.fn((input: any) => ({ input })),
  };
});

import { TwilioInboundController } from "./TwilioInboundController";
import { BannedPhoneNumber } from "../entity/BannedPhoneNumber";
import { Report } from "../entity/Report";
import { Upload } from "../entity/Upload";
import { verifyTwilioSignature } from "../lib/twilio/verifySignature";
import { notifyBugsnag } from "../lib/notifyBugsnag";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const PHONE = "+15551234567";
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

const OPTED_OUT_FRAGMENT = "opted out";
const UNSUBSCRIBED_FRAGMENT = "unsubscribed";
const THANKS_FRAGMENT = "Thanks for your message!";
// Apostrophes in TwiML replies are XML-escaped to &apos; by the controller.
const NO_MATCH_FRAGMENT = "couldn&apos;t match this to a recent pizza delivery";
const SHARED_FRAGMENT = "Thanks for sharing!";

const controller = new TwilioInboundController();

const fakeReport = {
  id: 42,
  location: { id: 7, city: "Chicago", state: "IL" },
} as unknown as Report;

const fakeUpload = {
  filePath: "uploads/chicago-il-abc123.jpg",
  rawBucket: "raw.polls.pizza",
} as unknown as Upload;

let send: jest.Mock;
let findReportSpy: jest.SpyInstance;
let createFromMmsSpy: jest.SpyInstance;

const verifyMock = verifyTwilioSignature as jest.Mock;
const bugsnagMock = notifyBugsnag as jest.Mock;
const putObjectMock = PutObjectCommand as unknown as jest.Mock;

function buildRequest(body: Record<string, any>) {
  return http_mocks.createRequest({
    method: "POST",
    protocol: "https",
    headers: {
      host: "api.polls.pizza",
      "x-twilio-signature": "validsig==",
      "content-type": "application/x-www-form-urlencoded",
    },
    originalUrl: "/twilio/inbound",
    body,
  });
}

/** Mock global fetch (installed by jest.setup.ts) to return media bytes. */
function mockFetchBody(body: Buffer, contentLength?: string) {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    status: 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-length"
          ? (contentLength ?? String(body.length))
          : null,
    },
    arrayBuffer: async () => body,
  });
}

function mediaBody(
  contentType: string,
  url = "https://media.twilio.com/f1/0",
): Record<string, any> {
  return {
    From: PHONE,
    Body: "here's the pizza pic!",
    MediaUrl0: url,
    MediaContentType0: contentType,
  };
}

async function callInbound(body: Record<string, any>) {
  const response = http_mocks.createResponse();
  const returned = await controller.inbound(
    buildRequest(body),
    response,
    () => undefined,
  );
  return { returned, response };
}

beforeEach(() => {
  verifyMock.mockReset();
  verifyMock.mockImplementation(() => true);

  send = jest.fn().mockResolvedValue({});
  (S3Client as unknown as jest.Mock).mockReset();
  (S3Client as unknown as jest.Mock).mockImplementation(() => ({ send }));
  putObjectMock.mockClear();

  findReportSpy = jest
    .spyOn(Report, "findRecentFulfilledByPhone")
    .mockResolvedValue(null);
  createFromMmsSpy = jest
    .spyOn(Upload, "createFromMms")
    .mockResolvedValue([fakeUpload, false]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("TwilioInboundController #inbound", () => {
  // ---------------------------------------------------------------------
  // Signature verification
  // ---------------------------------------------------------------------

  it("returns 403 with minimal TwiML and no side effects on bad signature", async () => {
    verifyMock.mockReturnValueOnce(false);

    const { response } = await callInbound(mediaBody("image/jpeg"));

    expect(response.statusCode).toEqual(403);
    expect(response._getData()).toEqual(
      '<?xml version="1.0" encoding="UTF-8"?><Response/>',
    );
    expect(response._getHeaders()["content-type"]).toContain("text/xml");

    // Reported to Bugsnag, but no processing side effects.
    expect(bugsnagMock).toHaveBeenCalledTimes(1);
    expect(findReportSpy).not.toHaveBeenCalled();
    expect(createFromMmsSpy).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("verifies the signature against the original request URL and parsed body", async () => {
    await callInbound({ From: PHONE, Body: "hi" });

    expect(verifyMock).toHaveBeenCalledWith({
      url: "https://api.polls.pizza/twilio/inbound",
      body: { From: PHONE, Body: "hi" },
      signature: "validsig==",
    });
  });

  // ---------------------------------------------------------------------
  // STOP keywords / banned numbers
  // ---------------------------------------------------------------------

  it.each(["STOP", " stop ", "STOPALL", "Unsubscribe", "CANCEL"])(
    "creates a BannedPhoneNumber for STOP keyword '%s' and replies with opt-out TwiML",
    async (keyword) => {
      const { response } = await callInbound({
        From: PHONE,
        Body: keyword,
        MediaUrl0: "https://media.twilio.com/f1/0",
        MediaContentType0: "image/jpeg",
      });

      expect(response.statusCode).toEqual(200);
      expect(response._getData()).toContain(UNSUBSCRIBED_FRAGMENT);

      const ban = await BannedPhoneNumber.findOne({
        where: { phoneNumber: PHONE },
      });
      expect(ban).not.toBeNull();
      expect(ban!.reason).toEqual("STOP via MMS inbound webhook");
      expect(ban!.bannedBy).toEqual("twilio-webhook");

      // No report matching, no media ingestion for opt-outs.
      expect(findReportSpy).not.toHaveBeenCalled();
      expect(createFromMmsSpy).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("short-circuits already-banned senders with an opt-out reply and no storage", async () => {
    const ban = new BannedPhoneNumber();
    ban.phoneNumber = PHONE;
    ban.reason = "existing ban";
    ban.bannedBy = "admin";
    await ban.save();

    const { response } = await callInbound(mediaBody("image/jpeg"));

    expect(response.statusCode).toEqual(200);
    expect(response._getData()).toContain(OPTED_OUT_FRAGMENT);
    expect(findReportSpy).not.toHaveBeenCalled();
    expect(createFromMmsSpy).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // No matching report
  // ---------------------------------------------------------------------

  it("replies politely and stores nothing when no report matches and no media is present", async () => {
    const { response } = await callInbound({ From: PHONE, Body: "hello?" });

    expect(response.statusCode).toEqual(200);
    expect(response._getData()).toContain(THANKS_FRAGMENT);
    expect(response._getData()).toContain("<Response><Message>");
    expect(createFromMmsSpy).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("replies with the no-match message and stores no orphan media when media is present", async () => {
    const { response } = await callInbound(mediaBody("image/jpeg"));

    expect(response.statusCode).toEqual(200);
    expect(response._getData()).toContain(NO_MATCH_FRAGMENT);
    // No downloads, no upload rows, no S3 writes.
    expect(global.fetch).not.toHaveBeenCalled();
    expect(createFromMmsSpy).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // Media ingestion
  // ---------------------------------------------------------------------

  it("downloads media, creates the MMS upload, and PutObjects the raw bytes to the raw bucket", async () => {
    findReportSpy.mockResolvedValue(fakeReport);
    const bytes = Buffer.from("jpeg-bytes-for-the-pizza-pic");
    mockFetchBody(bytes, String(bytes.length));

    const { response } = await callInbound(mediaBody("image/jpeg"));

    const expectedHash = crypto
      .createHash("sha256")
      .update(bytes)
      .digest("hex");

    expect(response.statusCode).toEqual(200);
    expect(response._getData()).toContain(SHARED_FRAGMENT);
    expect(response._getHeaders()["content-type"]).toContain("text/xml");

    expect(createFromMmsSpy).toHaveBeenCalledTimes(1);
    expect(createFromMmsSpy).toHaveBeenCalledWith(fakeReport, {
      fileExt: "jpg",
      fileHash: expectedHash,
      sourcePhone: PHONE,
    });

    // Raw bytes land at the key createFromMms produced — this S3 write is
    // what triggers the existing EXIF → format → transcode pipeline.
    expect(putObjectMock).toHaveBeenCalledTimes(1);
    expect(putObjectMock.mock.calls[0][0]).toEqual({
      Bucket: "raw.polls.pizza",
      Key: fakeUpload.filePath,
      Body: bytes,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not write to S3 for a duplicate fileHash", async () => {
    findReportSpy.mockResolvedValue(fakeReport);
    createFromMmsSpy.mockResolvedValue([fakeUpload, true]);

    const bytes = Buffer.from("duplicate-pizza-bytes");
    mockFetchBody(bytes);

    const { response } = await callInbound(mediaBody("image/jpeg"));

    expect(response.statusCode).toEqual(200);
    expect(response._getData()).toContain(SHARED_FRAGMENT);
    expect(createFromMmsSpy).toHaveBeenCalledTimes(1);
    expect(putObjectMock).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("skips media larger than 5MB (declared via Content-Length) and says so", async () => {
    findReportSpy.mockResolvedValue(fakeReport);
    const bytes = Buffer.alloc(64);
    mockFetchBody(bytes, String(MAX_MEDIA_BYTES + 1));

    const { response } = await callInbound(mediaBody("image/jpeg"));

    expect(response.statusCode).toEqual(200);
    expect(response._getData()).toContain("files over 5MB");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(createFromMmsSpy).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("skips media whose actual bytes exceed 5MB even with a small Content-Length", async () => {
    findReportSpy.mockResolvedValue(fakeReport);
    mockFetchBody(Buffer.alloc(8), String(8)); // lying header
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => String(8) },
      arrayBuffer: async () => Buffer.alloc(MAX_MEDIA_BYTES + 1),
    });

    const { response } = await callInbound(mediaBody("image/jpeg"));

    expect(response._getData()).toContain("files over 5MB");
    expect(createFromMmsSpy).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("skips unknown content types without downloading them", async () => {
    findReportSpy.mockResolvedValue(fakeReport);

    const { response } = await callInbound(mediaBody("application/pdf"));

    expect(response.statusCode).toEqual(200);
    expect(response._getData()).toContain("couldn&apos;t process");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(createFromMmsSpy).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("supports all media content types the pipeline understands", async () => {
    findReportSpy.mockResolvedValue(fakeReport);

    const cases: [string, string][] = [
      ["image/png", "png"],
      ["image/gif", "gif"],
      ["image/webp", "webp"],
      ["image/heic", "heic"],
      ["image/heif", "heif"],
      ["video/mp4", "mp4"],
      ["video/quicktime", "mov"],
      ["video/webm", "webm"],
    ];

    for (const [mime, ext] of cases) {
      (createFromMmsSpy as jest.Mock).mockClear();
      mockFetchBody(Buffer.from(`bytes-for-${ext}`));

      await callInbound(mediaBody(mime));

      expect(createFromMmsSpy).toHaveBeenCalledWith(fakeReport, {
        fileExt: ext,
        fileHash: expect.any(String),
        sourcePhone: PHONE,
      });
    }
  });

  it("isolates per-media failures so one failed download doesn't abort the others", async () => {
    findReportSpy.mockResolvedValue(fakeReport);

    const bytes = Buffer.from("second-media-bytes-succeed");
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error("Simulated network failure"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => String(bytes.length) },
        arrayBuffer: async () => bytes,
      });

    const { response } = await callInbound({
      From: PHONE,
      Body: "two pics",
      MediaUrl0: "https://media.twilio.com/f1/broken",
      MediaContentType0: "image/jpeg",
      MediaUrl1: "https://media.twilio.com/f1/works",
      MediaContentType1: "image/png",
    });

    expect(response.statusCode).toEqual(200);
    expect(response._getData()).toContain(SHARED_FRAGMENT);

    // The failed item was reported; the good one was still saved and stored.
    expect(bugsnagMock).toHaveBeenCalledTimes(1);
    expect(createFromMmsSpy).toHaveBeenCalledTimes(1);
    expect(createFromMmsSpy).toHaveBeenCalledWith(
      fakeReport,
      expect.objectContaining({ fileExt: "png" }),
    );
    expect(putObjectMock).toHaveBeenCalledTimes(1);
  });

  it("isolates per-media S3 failures and keeps the success reply honest", async () => {
    findReportSpy.mockResolvedValue(fakeReport);
    send.mockRejectedValueOnce(new Error("S3 exploded"));
    const bytes = Buffer.from("bytes-for-s3-failure-test");
    mockFetchBody(bytes);

    const { response } = await callInbound(mediaBody("image/jpeg"));

    expect(response.statusCode).toEqual(200);
    expect(bugsnagMock).toHaveBeenCalledTimes(1);
    expect(response._getData()).toContain(
      "We had trouble saving the files you sent.",
    );
  });

  it("handles non-OK media downloads as per-item failures", async () => {
    findReportSpy.mockResolvedValue(fakeReport);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: { get: () => null },
      arrayBuffer: async () => Buffer.alloc(0),
    });

    const { response } = await callInbound(mediaBody("image/jpeg"));

    expect(response.statusCode).toEqual(200);
    expect(bugsnagMock).toHaveBeenCalledTimes(1);
    expect(createFromMmsSpy).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("processes up to 10 media items indexed MediaUrl0..MediaUrl9", async () => {
    findReportSpy.mockResolvedValue(fakeReport);
    mockFetchBody(Buffer.from("media"));

    const body: Record<string, any> = { From: PHONE, Body: "ten pics" };
    for (let i = 0; i < 10; i++) {
      body[`MediaUrl${i}`] = `https://media.twilio.com/f1/${i}`;
      body[`MediaContentType${i}`] = "image/jpeg";
    }

    await callInbound(body);

    expect(createFromMmsSpy).toHaveBeenCalledTimes(10);
    expect(putObjectMock).toHaveBeenCalledTimes(10);
  });

  it("replies with a generic error TwiML (no stack traces) when processing throws", async () => {
    findReportSpy.mockRejectedValue(new Error("database exploded"));

    const { response } = await callInbound({ From: PHONE, Body: "hi" });

    expect(response.statusCode).toEqual(200);
    expect(response._getHeaders()["content-type"]).toContain("text/xml");
    expect(response._getData()).toContain("<Response><Message>");
    expect(response._getData()).toContain("something went wrong");
    expect(response._getData()).not.toContain("database exploded");
    expect(bugsnagMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes formatted sender phone numbers for ban checks and upload source", async () => {
    const formatted = "+1 (555) 123-4567";
    await callInbound({ From: formatted, Body: "hi" });

    // isBanned (real entity) receives the normalized digits/+ form via the
    // controller's normalizePhone call.
    expect(createFromMmsSpy).not.toHaveBeenCalled();

    // Now verify the normalized value reaches createFromMms when a report matches.
    findReportSpy.mockResolvedValue(fakeReport);
    mockFetchBody(Buffer.from("abc"));

    await callInbound(mediaBody("image/jpeg"));
    expect(createFromMmsSpy).toHaveBeenCalledWith(
      fakeReport,
      expect.objectContaining({ sourcePhone: PHONE }),
    );
  });
});
