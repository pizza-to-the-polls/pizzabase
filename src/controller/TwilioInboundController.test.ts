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
// Mock the clip-auto helper so tests verify the controller calls it at the
// right time (MMS ingestion) without hitting the real DB/Lambda layer.
jest.mock("../lib/clip-auto", () => ({
  seedClipForUpload: jest.fn(),
}));

import { TwilioInboundController } from "./TwilioInboundController";
import { BannedPhoneNumber } from "../entity/BannedPhoneNumber";
import { APIKey } from "../entity/APIKey";
import { Report } from "../entity/Report";
import { Upload } from "../entity/Upload";
import { Order } from "../entity/Order";
import { seedClipForUpload } from "../lib/clip-auto";
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

const fakeOrder = {
  id: 101,
  restaurant: "Test Pizzeria",
  orderType: "pizzas",
  quantity: 5,
} as unknown as Order;

const fakeReport = {
  id: 42,
  reportURL: "https://example.com/reports/42",
  location: {
    id: 7,
    city: "Chicago",
    state: "IL",
    fullAddress: "123 Test St, Chicago, IL 60601",
  },
  order: fakeOrder,
} as unknown as Report;

const fakeUpload = {
  id: 2249,
  filePath: "uploads/chicago-il-abc123.jpg",
  rawBucket: "raw.polls.pizza",
} as unknown as Upload;

let send: jest.Mock;
let findReportSpy: jest.SpyInstance;
let createFromMmsSpy: jest.SpyInstance;

const verifyMock = verifyTwilioSignature as jest.Mock;
const bugsnagMock = notifyBugsnag as jest.Mock;
const putObjectMock = PutObjectCommand as unknown as jest.Mock;
const mockSeedClipForUpload = seedClipForUpload as jest.Mock;

function buildRequest(
  body: Record<string, any>,
  headers: Record<string, string> = {},
) {
  return http_mocks.createRequest({
    method: "POST",
    protocol: "https",
    headers: {
      host: "api.polls.pizza",
      "x-twilio-signature": "validsig==",
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
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

async function callInbound(
  body: Record<string, any>,
  headers: Record<string, string> = {},
) {
  const response = http_mocks.createResponse();
  const returned = await controller.inbound(
    buildRequest(body, headers),
    response,
    () => undefined,
  );
  return { returned, response };
}

/** Parse the JSON body of a trusted-relay response (the Zapier path replies
 * in JSON, not TwiML — only real Twilio gets TwiML). */
function relayJson(response: ReturnType<typeof http_mocks.createResponse>) {
  return JSON.parse(response._getData());
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
  mockSeedClipForUpload.mockReset();
  mockSeedClipForUpload.mockResolvedValue(undefined);
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

  it("stores orphan media for unmatched senders (location null, report null)", async () => {
    // Sender has no recent report — but their media is still stored now
    // (issue #341): it surfaces in Slack #feed-sms, Help Scout and Retool.
    const bytes = Buffer.from("orphan-media-bytes");
    mockFetchBody(bytes, String(bytes.length));

    const orphanUpload = {
      id: 9999,
      filePath: "uploads/mms-a1b2c3d4.jpg",
      rawBucket: "raw.polls.pizza",
      location: null,
      report: null,
    } as unknown as Upload;
    createFromMmsSpy.mockResolvedValue([orphanUpload, false]);

    const { response } = await callInbound(mediaBody("image/jpeg"));

    expect(response.statusCode).toEqual(200);
    // Reply text unchanged: media saved but not tied to a delivery.
    expect(response._getData()).toContain(NO_MATCH_FRAGMENT);

    // Media IS downloaded, stored, and S3-written.
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(createFromMmsSpy).toHaveBeenCalledTimes(1);
    expect(createFromMmsSpy).toHaveBeenCalledWith(null, {
      fileExt: "jpg",
      fileHash: expect.any(String),
      sourcePhone: PHONE,
    });
    expect(putObjectMock).toHaveBeenCalledTimes(1);
    expect(putObjectMock.mock.calls[0][0]).toEqual({
      Bucket: "raw.polls.pizza",
      Key: "uploads/mms-a1b2c3d4.jpg",
      Body: bytes,
    });
    expect(send).toHaveBeenCalledTimes(1);

    // No clip seeding for orphan media (no report to associate with).
    expect(mockSeedClipForUpload).not.toHaveBeenCalled();
  });

  it("replies with the trouble-saving text to unmatched senders whose media fails to save", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: { get: () => null },
      arrayBuffer: async () => Buffer.alloc(0),
    });

    const { response } = await callInbound(mediaBody("image/jpeg"));

    expect(response.statusCode).toEqual(200);
    expect(bugsnagMock).toHaveBeenCalled();
    expect(response._getData()).toContain(
      "We had trouble saving the files you sent.",
    );
    expect(createFromMmsSpy).not.toHaveBeenCalled();
    // The failure happened at download time — nothing was stored, so the
    // S3 pipeline trigger (PutObject via S3Client.send) never fired.
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

  it("passes messageSid to createFromMms when MessageSid is present and valid", async () => {
    findReportSpy.mockResolvedValue(fakeReport);
    const bytes = Buffer.from("sid-media-test");
    mockFetchBody(bytes);

    const sid = "SM" + "b".repeat(32);

    await callInbound({
      From: PHONE,
      Body: "with sid",
      MessageSid: sid,
      MediaUrl0: "https://media.twilio.com/f1/0",
      MediaContentType0: "image/jpeg",
    });

    expect(createFromMmsSpy).toHaveBeenCalledWith(fakeReport, {
      fileExt: "jpg",
      fileHash: expect.any(String),
      sourcePhone: PHONE,
      messageSid: sid,
    });
  });

  it("does not pass messageSid when body has no MessageSid/Ssid key", async () => {
    findReportSpy.mockResolvedValue(fakeReport);
    mockFetchBody(Buffer.from("no-sid"));

    await callInbound(mediaBody("image/jpeg"));

    const callArg = createFromMmsSpy.mock.calls[0][1];
    expect(callArg.messageSid).toBeUndefined();
  });

  it("does not pass an empty messageSid to createFromMms", async () => {
    findReportSpy.mockResolvedValue(fakeReport);
    mockFetchBody(Buffer.from("empty-sid"));

    await callInbound({
      From: PHONE,
      Body: "empty sid",
      MessageSid: "",
      MediaUrl0: "https://media.twilio.com/f1/0",
      MediaContentType0: "image/jpeg",
    });

    const callArg = createFromMmsSpy.mock.calls[0][1];
    expect(callArg.messageSid).toBeUndefined();
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

  describe("media URL allowlist (SSRF guard)", () => {
    it("never fetches a non-https media URL (metadata endpoint)", async () => {
      findReportSpy.mockResolvedValue(fakeReport);
      mockFetchBody(Buffer.alloc(64));

      const { response } = await callInbound(
        mediaBody("image/jpeg", "http://169.254.169.254/latest/meta-data"),
      );

      expect(response.statusCode).toEqual(200);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(createFromMmsSpy).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
      expect(response._getData()).toContain(
        "We couldn&apos;t process some of the files you sent.",
      );
    });

    it("never fetches an https URL on a non-Twilio host", async () => {
      findReportSpy.mockResolvedValue(fakeReport);
      mockFetchBody(Buffer.alloc(64));

      const { response } = await callInbound(
        mediaBody("image/jpeg", "https://evil.example.com/f1/0"),
      );

      expect(global.fetch).not.toHaveBeenCalled();
      expect(createFromMmsSpy).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
      expect(response._getData()).toContain(
        "We couldn&apos;t process some of the files you sent.",
      );
    });

    it("still fetches media from api.twilio.com", async () => {
      findReportSpy.mockResolvedValue(fakeReport);
      mockFetchBody(Buffer.alloc(64));

      await callInbound(
        mediaBody(
          "image/jpeg",
          "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/SM1/Media/ME1",
        ),
      );

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(createFromMmsSpy).toHaveBeenCalledTimes(1);
    });

    it("fetches a staging allowlist host only when TWILIO_MEDIA_EXTRA_HOSTS is set", async () => {
      findReportSpy.mockResolvedValue(fakeReport);
      mockFetchBody(Buffer.alloc(64));

      // Default (prod) policy: non-Twilio hosts are always blocked.
      await callInbound(
        mediaBody(
          "video/mp4",
          "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4",
        ),
      );
      expect(global.fetch).not.toHaveBeenCalled();

      process.env.TWILIO_MEDIA_EXTRA_HOSTS = "test-videos.co.uk";
      try {
        const { response } = await callInbound(
          mediaBody(
            "video/mp4",
            "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4",
          ),
        );
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(createFromMmsSpy).toHaveBeenCalledTimes(1);
        expect(response._getData()).not.toContain(
          "We couldn&apos;t process some of the files",
        );
      } finally {
        delete process.env.TWILIO_MEDIA_EXTRA_HOSTS;
      }
    });

    it("extra-host entries match the exact hostname only (no subdomain wildcarding)", async () => {
      findReportSpy.mockResolvedValue(fakeReport);
      mockFetchBody(Buffer.alloc(64));

      process.env.TWILIO_MEDIA_EXTRA_HOSTS = "example.test";
      try {
        // A subdomain or lookalike of an allowlisted host must not pass.
        await callInbound(
          mediaBody("image/jpeg", "https://evil.example.test/f1/0"),
        );
        expect(global.fetch).not.toHaveBeenCalled();

        // Neither must https-elsewhere on that host.
        await callInbound(mediaBody("image/jpeg", "http://example.test/f1/0"));
        expect(global.fetch).not.toHaveBeenCalled();
      } finally {
        delete process.env.TWILIO_MEDIA_EXTRA_HOSTS;
      }
    });
  });

  describe("trusted relay path (INBOUND_WEBHOOK_TOKEN — Zapier forwards non-Twilio media)", () => {
    const TOKEN = "relay-test-token-abcdef";
    const RELAY_HEADERS = { "x-ptp-inbound-token": TOKEN };

    const ACCOUNT_SID = "AC" + "a".repeat(32);

    beforeEach(() => {
      process.env.INBOUND_WEBHOOK_TOKEN = TOKEN;
      // Relay requests carry no (valid) Twilio signature.
      verifyMock.mockImplementation(() => false);
    });

    afterEach(() => {
      delete process.env.INBOUND_WEBHOOK_TOKEN;
      delete process.env.TWILIO_ACCOUNT_SID;
    });

    it("403s without either signature or token", async () => {
      const { response } = await callInbound({ From: PHONE, Body: "hi" });
      expect(response.statusCode).toEqual(403);
    });

    it("403s with a wrong token", async () => {
      const { response } = await callInbound(
        { From: PHONE, Body: "hi" },
        { "x-ptp-inbound-token": "wrong-token" },
      );
      expect(response.statusCode).toEqual(403);
      expect(bugsnagMock).toHaveBeenCalled();
    });

    it("accepts a JSON body in the same flat Twilio shape via token header", async () => {
      findReportSpy.mockResolvedValue(fakeReport);
      mockFetchBody(Buffer.alloc(64));

      const response = http_mocks.createResponse();
      const request = buildRequest(
        {
          From: PHONE,
          Body: "pizza pic from the relay",
          MediaUrl0: "https://relay.example.test/m/photo.jpg",
          MediaContentType0: "image/jpeg",
        },
        {
          ...RELAY_HEADERS,
          "content-type": "application/json",
          "x-twilio-signature": "",
        },
      );
      const returned = await controller.inbound(
        request,
        response,
        () => undefined,
      );

      expect(returned).toBeNull();
      expect(response.statusCode).toEqual(200);
      // Relay media may be any https host — fetched and stored. No Basic
      // auth on caller-supplied URLs (only SID-resolved items carry it).
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://relay.example.test/m/photo.jpg",
        undefined,
      );
      expect(createFromMmsSpy).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledTimes(1);
      // Relay replies in JSON (Zapier maps it upstream), never TwiML.
      expect(response.getHeader("Content-Type")).toContain("application/json");
      const body = relayJson(response);
      expect(body.ok).toBe(true);
      expect(body.reply).toContain("Thanks for sharing!");
      expect(body.matched).toBe(true);
      expect(body.savedCount).toBe(1);
      expect(body.unsupportedCount).toBe(0);
      expect(body.uploadIds).toEqual([fakeUpload.id]);
    });

    it("also accepts the token as Authorization: Bearer", async () => {
      findReportSpy.mockResolvedValue(fakeReport);

      const { response } = await callInbound(
        { From: PHONE, Body: "bearer token form post" },
        { authorization: `Bearer ${TOKEN}`, "x-twilio-signature": "" },
      );

      expect(response.statusCode).toEqual(200);
      const body = relayJson(response);
      expect(body.ok).toBe(true);
      expect(body.reply).toContain(THANKS_FRAGMENT);
      expect(body.matched).toBe(true);
    });

    describe("media by MessageSid (Zapier forwards only the SID)", () => {
      const SID = "SM" + "0".repeat(32);

      /**
       * Mock the Media API flow (three fetches):
       *   1. list (Basic auth) -> media_list
       *   2. instance URI (Basic auth, Accept) -> 307 + Location (presigned CDN)
       *   3. presigned CDN URL (NO auth) -> actual bytes
       */
      const mockMediaApi = (mediaCount = 1) => {
        (global.fetch as jest.Mock)
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
              media_list: Array.from({ length: mediaCount }, (_, i) => ({
                // Real Twilio JSON responses carry a .json suffix on uri.
                uri: `/2010-04-01/Accounts/${ACCOUNT_SID}/Messages/${SID}/Media/ME${String(i).padStart(2, "0")}.json`,
                content_type: "image/jpeg",
              })),
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 307,
            headers: {
              get: (name: string) =>
                name.toLowerCase() === "location"
                  ? `https://mms.twiliocdn.com/${ACCOUNT_SID}/signed${mediaCount}`
                  : null,
            },
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: { get: () => String(64) },
            arrayBuffer: async () => Buffer.alloc(64),
          });
      };

      beforeEach(() => {
        process.env.TWILIO_ACCOUNT_SID = ACCOUNT_SID;
        process.env.TWILIO_AUTH_TOKEN = "test-token";
      });

      afterEach(() => {
        delete process.env.TWILIO_AUTH_TOKEN;
      });

      it("fetches the media list from Twilio and stores with Basic auth", async () => {
        findReportSpy.mockResolvedValue(fakeReport);
        mockMediaApi(1);

        const { response } = await callInbound(
          { From: PHONE, Body: "sid only", MessageSid: SID },
          RELAY_HEADERS,
        );

        const calls = (global.fetch as jest.Mock).mock.calls;
        // First fetch: the Media API list, authorized with Basic sid:token.
        const [listUrl, listOpts] = calls[0];
        expect(listUrl).toBe(
          `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages/${SID}/Media.json?PageSize=20`,
        );
        expect(listOpts.headers.Authorization).toMatch(/^Basic /);
        expect(listOpts.headers.Accept).toBe("application/json");
        // Second fetch: the instance URI (authorized, Accept set) -> 307.
        const [instanceUrl, instanceOpts] = calls[1];
        expect(instanceUrl).toBe(
          `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages/${SID}/Media/ME00`,
        ); // (stripped the .json suffix the list response carried)
        expect(instanceOpts.headers.Authorization).toMatch(/^Basic /);
        expect(instanceOpts.headers.Accept).toBe("*/*");
        expect(instanceOpts.redirect).toBe("manual");
        // Third fetch: the presigned CDN URL — NO auth header on it.
        const [cdnUrl, cdnOpts] = calls[2];
        expect(cdnUrl).toBe(`https://mms.twiliocdn.com/${ACCOUNT_SID}/signed1`);
        expect(cdnOpts).toBeUndefined();
        // ...and stored.
        expect(createFromMmsSpy).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledTimes(1);
        const body = JSON.parse(response._getData());
        expect(body.savedCount).toBe(1);
        expect(body.uploadIds).toEqual([fakeUpload.id]);
      });

      it("accepts MM-prefixed SIDs (real MMS messages) — not just SM", async () => {
        findReportSpy.mockResolvedValue(fakeReport);
        const MM_SID = "MM" + "0".repeat(32);
        (global.fetch as jest.Mock)
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
              media_list: [
                {
                  uri: `/2010-04-01/Accounts/${ACCOUNT_SID}/Messages/${MM_SID}/Media/ME00.json`,
                  content_type: "image/jpeg",
                },
              ],
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 307,
            headers: {
              get: (name: string) =>
                name.toLowerCase() === "location"
                  ? `https://mms.twiliocdn.com/${ACCOUNT_SID}/mm-signed`
                  : null,
            },
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: { get: () => String(64) },
            arrayBuffer: async () => Buffer.alloc(64),
          });

        const { response } = await callInbound(
          { From: PHONE, Body: "mms sid", MessageSid: MM_SID },
          RELAY_HEADERS,
        );
        expect(global.fetch).toHaveBeenCalledTimes(3);
        expect(JSON.parse(response._getData()).savedCount).toBe(1);
      });

      it("accepts the SID under the `Ssid` key too (Zapier trigger naming)", async () => {
        findReportSpy.mockResolvedValue(fakeReport);
        mockMediaApi(1);

        const { response } = await callInbound(
          { From: PHONE, Body: "zapier naming", Ssid: SID },
          RELAY_HEADERS,
        );
        expect(global.fetch).toHaveBeenCalledTimes(3);
        expect(JSON.parse(response._getData()).savedCount).toBe(1);
      });

      it("prefers direct MediaUrl fields and never calls the Media API", async () => {
        findReportSpy.mockResolvedValue(fakeReport);
        mockFetchBody(Buffer.alloc(64));

        await callInbound(
          {
            From: PHONE,
            Body: "both",
            MessageSid: SID,
            MediaUrl0: "https://relay.example.test/m/photo.jpg",
            MediaContentType0: "image/jpeg",
          },
          RELAY_HEADERS,
        );
        const calls = (global.fetch as jest.Mock).mock.calls;
        expect(calls).toHaveLength(1);
        expect(calls[0][0]).toBe("https://relay.example.test/m/photo.jpg");
      });

      it("passes messageSid to createFromMms for SID-resolved media", async () => {
        findReportSpy.mockResolvedValue(fakeReport);
        mockMediaApi(1);

        const sid = "SM" + "c".repeat(32);

        await callInbound(
          { From: PHONE, Body: "sid resolved", MessageSid: sid },
          RELAY_HEADERS,
        );

        expect(createFromMmsSpy).toHaveBeenCalledWith(
          fakeReport,
          expect.objectContaining({ messageSid: sid }),
        );
      });

      it("never interpolates a malformed SID into the API URL (injection guard)", async () => {
        findReportSpy.mockResolvedValue(fakeReport);

        const { response } = await callInbound(
          {
            From: PHONE,
            Body: "evil sid",
            MessageSid: "SM../../evil",
          },
          RELAY_HEADERS,
        );
        expect(global.fetch).not.toHaveBeenCalled();
        // Falls through to the text-only path.
        expect(JSON.parse(response._getData()).reply).toContain(
          THANKS_FRAGMENT,
        );
      });

      it("does not pass a malformed messageSid to createFromMms (injection guard)", async () => {
        findReportSpy.mockResolvedValue(fakeReport);
        mockFetchBody(Buffer.from("malformed-sid"));

        await callInbound(
          {
            From: PHONE,
            Body: "evil sid with media",
            MessageSid: "SM../../evil",
            MediaUrl0: "https://media.twilio.com/f1/0",
            MediaContentType0: "image/jpeg",
          },
          RELAY_HEADERS,
        );

        // SID path not taken (malformed → no Media API call), only the
        // MediaUrl0 fetch happened.
        expect(global.fetch).toHaveBeenCalledTimes(1);

        const callArg = createFromMmsSpy.mock.calls[0][1];
        expect(callArg.messageSid).toBeUndefined();
      });

      it("does not call the Media API without TWILIO_ACCOUNT_SID", async () => {
        delete process.env.TWILIO_ACCOUNT_SID;
        findReportSpy.mockResolvedValue(fakeReport);

        await callInbound(
          { From: PHONE, Body: "no sid configured", MessageSid: SID },
          RELAY_HEADERS,
        );
        expect(global.fetch).not.toHaveBeenCalled();
      });

      it("list failure surfaces as a failed media item, not a crash", async () => {
        findReportSpy.mockResolvedValue(fakeReport);
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({}),
        });

        const { response } = await callInbound(
          { From: PHONE, Body: "list 404", MessageSid: SID },
          RELAY_HEADERS,
        );
        const body = JSON.parse(response._getData());
        expect(body.failedCount).toBe(1);
        expect(body.savedCount).toBe(0);
      });

      it("resolves and stores media by MessageSid even for orphan senders", async () => {
        findReportSpy.mockResolvedValue(null);
        const orphanUpload = {
          id: 8888,
          filePath: "uploads/mms-orphan.jpg",
          rawBucket: "raw.polls.pizza",
          location: null,
          report: null,
        } as unknown as Upload;
        createFromMmsSpy.mockResolvedValue([orphanUpload, false]);
        mockMediaApi(1);

        const { response } = await callInbound(
          { From: PHONE, Body: "orphan with sid", MessageSid: SID },
          RELAY_HEADERS,
        );

        // Media API IS called for orphans now — the SID may be the only
        // way to reach their media, which gets stored either way.
        expect(global.fetch).toHaveBeenCalledTimes(3);
        expect(createFromMmsSpy).toHaveBeenCalledWith(
          null,
          expect.objectContaining({ sourcePhone: PHONE, messageSid: SID }),
        );
        const body = relayJson(response);
        expect(body.matched).toBe(false);
        expect(body.savedCount).toBe(1);
        expect(body.uploadIds).toEqual([8888]);
        // Reply text still reflects the no-match reality.
        expect(body.reply).toContain(
          "couldn't match this to a recent pizza delivery",
        );
      });
    });

    it("still requires https for relay media URLs", async () => {
      findReportSpy.mockResolvedValue(fakeReport);
      mockFetchBody(Buffer.alloc(64));

      const { response } = await callInbound(
        {
          From: PHONE,
          Body: "http media from relay",
          MediaUrl0: "http://relay.example.test/m/photo.jpg",
          MediaContentType0: "image/jpeg",
        },
        RELAY_HEADERS,
      );

      expect(global.fetch).not.toHaveBeenCalled();
      expect(createFromMmsSpy).not.toHaveBeenCalled();
      const body = relayJson(response);
      expect(body.unsupportedCount).toBe(1);
      expect(body.savedCount).toBe(0);
      expect(body.reply).toContain("We couldn't process some of the files");
    });

    describe("API-key auth (Authorization: Basic <key> — same keys Retool uses)", () => {
      it("accepts a valid pizzabase API key without any relay token", async () => {
        const key = await APIKey.generate("relay auth test");
        findReportSpy.mockResolvedValue(fakeReport);

        const { response } = await callInbound(
          { From: PHONE, Body: "api key auth" },
          { authorization: `Basic ${key.key}`, "x-twilio-signature": "" },
        );

        expect(response.statusCode).toEqual(200);
        const body = JSON.parse(response._getData());
        expect(body.ok).toBe(true);
        expect(body.matched).toBe(true);
      });

      it("403s (JSON) an unknown API key", async () => {
        const { response } = await callInbound(
          { From: PHONE, Body: "bad key" },
          {
            authorization: "Basic not-a-real-key",
            "x-twilio-signature": "",
          },
        );
        expect(response.statusCode).toEqual(403);
        expect(response._getData()).toBe('{"ok":false}');
      });

      it("403s (TwiML) a bare probe with no relay credential attempt", async () => {
        const { response } = await callInbound({ From: PHONE, Body: "probe" });
        expect(response.statusCode).toEqual(403);
        expect(response._getData()).toContain("<Response/>");
      });

      it("relay token still works alongside API keys (both credential forms live)", async () => {
        findReportSpy.mockResolvedValue(fakeReport);
        const { response } = await callInbound(
          { From: PHONE, Body: "token still valid" },
          RELAY_HEADERS,
        );
        expect(response.statusCode).toEqual(200);
        expect(JSON.parse(response._getData()).ok).toBe(true);
      });
    });

    it("does not allow the relay path when INBOUND_WEBHOOK_TOKEN is unset", async () => {
      delete process.env.INBOUND_WEBHOOK_TOKEN;

      const { response } = await callInbound(
        { From: PHONE, Body: "no token configured" },
        RELAY_HEADERS,
      );

      expect(response.statusCode).toEqual(403);
    });
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
      ["video/3gpp", "3gp"],
      ["video/3gpp2", "3g2"],
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

  it("routes video/3gpp to storage, not unsupportedCount", async () => {
    // Regression test for issue #343: video/3gpp is the default MMS video
    // format on Android phones and US carrier MMS pipelines — it must not be
    // silently dropped like unknown content types.
    findReportSpy.mockResolvedValue(fakeReport);
    const bytes = Buffer.from("3gpp-test-bytes");
    mockFetchBody(bytes, String(bytes.length));

    const { response } = await callInbound(mediaBody("video/3gpp"));

    expect(response.statusCode).toEqual(200);
    expect(createFromMmsSpy).toHaveBeenCalledWith(
      fakeReport,
      expect.objectContaining({ fileExt: "3gp", sourcePhone: PHONE }),
    );
    expect(putObjectMock).toHaveBeenCalledTimes(1);
    expect(response._getData()).toContain(SHARED_FRAGMENT);
    expect(response._getData()).not.toContain("couldn&apos;t process");
  });

  it("routes video/3gpp2 to storage, not unsupportedCount", async () => {
    // 3gpp2 covers CDMA-originated MMS (same ISOBMFF container, different brand).
    findReportSpy.mockResolvedValue(fakeReport);
    const bytes = Buffer.from("3g2-test-bytes");
    mockFetchBody(bytes, String(bytes.length));

    const { response } = await callInbound(mediaBody("video/3gpp2"));

    expect(response.statusCode).toEqual(200);
    expect(createFromMmsSpy).toHaveBeenCalledWith(
      fakeReport,
      expect.objectContaining({ fileExt: "3g2", sourcePhone: PHONE }),
    );
    expect(putObjectMock).toHaveBeenCalledTimes(1);
    expect(response._getData()).toContain(SHARED_FRAGMENT);
    expect(response._getData()).not.toContain("couldn&apos;t process");
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

  // ---------------------------------------------------------------------
  // Deployed Zapier workflow shape (JSON, Basic API-key auth, MessageSid)
  // ---------------------------------------------------------------------
  describe("deployed Zapier workflow shape (JSON body, Basic auth, MessageSid-only)", () => {
    const WORKFLOW_SID = "SM" + "0".repeat(32);
    const ACCOUNT_SID = "AC" + "a".repeat(32);

    /**
     * Mock the Media API flow (three fetches):
     *   1. list (Basic auth) -> media_list
     *   2. instance URI (Basic auth, Accept) -> 307 + Location
     *   3. presigned CDN URL (NO auth) -> actual bytes
     */
    const mockWorkflowMediaApi = (mediaCount = 1) => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            media_list: Array.from({ length: mediaCount }, (_, i) => ({
              uri: `/2010-04-01/Accounts/${ACCOUNT_SID}/Messages/${WORKFLOW_SID}/Media/ME${String(i).padStart(2, "0")}.json`,
              content_type: "image/jpeg",
            })),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 307,
          headers: {
            get: (name: string) =>
              name.toLowerCase() === "location"
                ? `https://mms.twiliocdn.com/${ACCOUNT_SID}/signed${mediaCount}`
                : null,
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: { get: () => String(64) },
          arrayBuffer: async () => Buffer.alloc(64),
        });
    };

    beforeEach(() => {
      process.env.TWILIO_ACCOUNT_SID = ACCOUNT_SID;
      process.env.TWILIO_AUTH_TOKEN = "test-token";
      // The deployed workflow sends unsigned requests with Basic auth.
      verifyMock.mockImplementation(() => false);
    });

    afterEach(() => {
      delete process.env.TWILIO_ACCOUNT_SID;
      delete process.env.TWILIO_AUTH_TOKEN;
    });

    it("accepts the exact deployed workflow shape: JSON body with MessageSid/Body/From via Basic auth", async () => {
      const key = await APIKey.generate("deployed workflow test");
      findReportSpy.mockResolvedValue(fakeReport);
      mockWorkflowMediaApi(1);

      const { response } = await callInbound(
        {
          MessageSid: WORKFLOW_SID,
          Body: "text here",
          From: PHONE,
        },
        {
          "content-type": "application/json",
          authorization: `Basic ${key.key}`,
          "x-twilio-signature": "",
        },
      );

      expect(response.statusCode).toEqual(200);
      const body = relayJson(response);
      expect(body.ok).toBe(true);
      expect(body.savedCount).toBe(1);
      expect(body.matched).toBe(true);
    });

    it("accepts media-only MMS (empty Body) via the deployed shape", async () => {
      const key = await APIKey.generate("media only mms test");
      findReportSpy.mockResolvedValue(fakeReport);
      mockWorkflowMediaApi(1);

      const { response } = await callInbound(
        {
          MessageSid: WORKFLOW_SID,
          Body: "",
          From: PHONE,
        },
        {
          "content-type": "application/json",
          authorization: `Basic ${key.key}`,
          "x-twilio-signature": "",
        },
      );

      expect(response.statusCode).toEqual(200);
      const body = relayJson(response);
      expect(body.ok).toBe(true);
      expect(body.savedCount).toBe(1);
      expect(body.matched).toBe(true);
    });

    it("returns THANKS_REPLY for empty Body with no media and no report match", async () => {
      const key = await APIKey.generate("no match test");
      findReportSpy.mockResolvedValue(null);

      const { response } = await callInbound(
        {
          From: PHONE,
          Body: "",
        },
        {
          "content-type": "application/json",
          authorization: `Basic ${key.key}`,
          "x-twilio-signature": "",
        },
      );

      expect(response.statusCode).toEqual(200);
      const body = relayJson(response);
      expect(body.ok).toBe(true);
      expect(body.reply).toContain(THANKS_FRAGMENT);
      expect(body.matched).toBe(false);
    });

    it("handles requests without a To field gracefully", async () => {
      const key = await APIKey.generate("no to field test");
      findReportSpy.mockResolvedValue(fakeReport);
      mockWorkflowMediaApi(1);

      const { response } = await callInbound(
        {
          MessageSid: WORKFLOW_SID,
          Body: "no To field",
          From: PHONE,
        },
        {
          "content-type": "application/json",
          authorization: `Basic ${key.key}`,
          "x-twilio-signature": "",
        },
      );

      expect(response.statusCode).toEqual(200);
      const body = relayJson(response);
      expect(body.ok).toBe(true);
      expect(body.savedCount).toBe(1);
    });
  });

  // ---------------------------------------------------------------------
  // Relay 502 failure contract (MessageSid resolution failure)
  // ---------------------------------------------------------------------
  describe("relay 502 failure contract (MessageSid resolution failure)", () => {
    const FAIL_SID = "SM" + "f".repeat(32);
    const ACCOUNT_SID = "AC" + "a".repeat(32);

    beforeEach(() => {
      process.env.TWILIO_ACCOUNT_SID = ACCOUNT_SID;
      process.env.TWILIO_AUTH_TOKEN = "test-token";
      // Relay path (unsigned).
      verifyMock.mockImplementation(() => false);
    });

    afterEach(() => {
      delete process.env.TWILIO_ACCOUNT_SID;
      delete process.env.TWILIO_AUTH_TOKEN;
    });

    it("returns 502 when MessageSid resolution fails (relay path) — non-2xx contract", async () => {
      const key = await APIKey.generate("relay failure test");
      findReportSpy.mockResolvedValue(fakeReport);
      // Simulate Media API failure (network error)
      (global.fetch as jest.Mock).mockRejectedValue(
        new Error("Twilio API down"),
      );

      const { response } = await callInbound(
        {
          MessageSid: FAIL_SID,
          From: PHONE,
          Body: "",
        },
        {
          "content-type": "application/json",
          authorization: `Basic ${key.key}`,
          "x-twilio-signature": "",
        },
      );

      expect(response.statusCode).toEqual(502);
      const body = relayJson(response);
      expect(body.ok).toBe(false);
      expect(body.failedCount).toBe(1);
    });

    it("still returns 200 TwiML when MessageSid resolution fails for signed Twilio — no regression", async () => {
      // Real Twilio requests are signed.
      verifyMock.mockImplementation(() => true);
      findReportSpy.mockResolvedValue(fakeReport);
      (global.fetch as jest.Mock).mockRejectedValue(
        new Error("Twilio API down"),
      );

      const { response } = await callInbound(
        {
          MessageSid: FAIL_SID,
          From: PHONE,
          Body: "",
        },
        {
          "x-twilio-signature": "validsig==",
        },
      );

      expect(response.statusCode).toEqual(200);
      expect(response._getHeaders()["content-type"]).toContain("text/xml");
    });
  });

  // ---------------------------------------------------------------------
  // Signed Twilio bypasses relay auth (no regression)
  // ---------------------------------------------------------------------
  describe("signed Twilio bypasses relay auth", () => {
    beforeEach(() => {
      // Valid signature.
      verifyMock.mockImplementation(() => true);
    });

    it("bypasses relay auth and passes through when signature is valid (even with bad relay auth)", async () => {
      process.env.INBOUND_WEBHOOK_TOKEN = "real-token";
      findReportSpy.mockResolvedValue(null);

      const { response } = await callInbound(
        { From: PHONE, Body: "hi" },
        { "x-ptp-inbound-token": "wrong-token" },
      );

      expect(response.statusCode).toEqual(200);
      expect(response._getHeaders()["content-type"]).toContain("text/xml");
      expect(response._getData()).toContain(THANKS_FRAGMENT);

      delete process.env.INBOUND_WEBHOOK_TOKEN;
    });

    it("bypasses relay auth with invalid API key when signature is valid", async () => {
      findReportSpy.mockResolvedValue(null);

      const { response } = await callInbound(
        { From: PHONE, Body: "hi" },
        { authorization: "Basic invalid-key" },
      );

      expect(response.statusCode).toEqual(200);
      expect(response._getHeaders()["content-type"]).toContain("text/xml");
      expect(response._getData()).toContain(THANKS_FRAGMENT);
    });
  });

  // ---------------------------------------------------------------------
  // MMS clip seeding + relay matchedReport context (issue #322)
  // ---------------------------------------------------------------------
  describe("MMS clip seeding and relay matchedReport context", () => {
    it("includes matchedReport with location and order in the relay JSON on match", async () => {
      // Relay path (no Twilio signature) with a valid shared token.
      verifyMock.mockImplementation(() => false);
      process.env.INBOUND_WEBHOOK_TOKEN = "test-token";
      findReportSpy.mockResolvedValue(fakeReport);

      const { response } = await callInbound(mediaBody("image/jpeg"), {
        "x-ptp-inbound-token": "test-token",
      });

      delete process.env.INBOUND_WEBHOOK_TOKEN;

      expect(response.statusCode).toEqual(200);
      const body = relayJson(response);
      expect(body.matched).toBe(true);
      expect(body.matchedReport).toEqual({
        id: 42,
        reportURL: "https://example.com/reports/42",
        location: {
          fullAddress: "123 Test St, Chicago, IL 60601",
          city: "Chicago",
          state: "IL",
        },
        order: {
          restaurant: "Test Pizzeria",
          orderType: "pizzas",
          quantity: 5,
        },
      });
    });

    it("returns matchedReport: null in relay JSON when no report matches", async () => {
      verifyMock.mockImplementation(() => false);
      process.env.INBOUND_WEBHOOK_TOKEN = "test-token";
      findReportSpy.mockResolvedValue(null);

      const { response } = await callInbound(
        { From: PHONE, Body: "hi" },
        {
          "x-ptp-inbound-token": "test-token",
        },
      );

      delete process.env.INBOUND_WEBHOOK_TOKEN;

      expect(response.statusCode).toEqual(200);
      const body = relayJson(response);
      expect(body.matched).toBe(false);
      expect(body.matchedReport).toBeNull();
    });

    it("seeds a clip immediately on new MMS ingestion", async () => {
      findReportSpy.mockResolvedValue(fakeReport);
      createFromMmsSpy.mockResolvedValue([{ ...fakeUpload }, false]);
      mockFetchBody(Buffer.from("clip-seed-test-bytes"));

      const { response } = await callInbound(mediaBody("image/jpeg"));

      expect(response.statusCode).toEqual(200);
      expect(mockSeedClipForUpload).toHaveBeenCalledTimes(1);
      // First arg is the matched report, second is the freshly created upload.
      expect(mockSeedClipForUpload.mock.calls[0][0]).toBe(fakeReport);
      const seededUpload = mockSeedClipForUpload.mock.calls[0][1];
      expect(seededUpload.filePath).toEqual(fakeUpload.filePath);
    });

    it("does not seed a clip on duplicate-hash re-delivery", async () => {
      findReportSpy.mockResolvedValue(fakeReport);
      // Same content re-delivered: createFromMms flags it as duplicate.
      createFromMmsSpy.mockResolvedValue([fakeUpload, true]);

      const { response } = await callInbound(mediaBody("image/jpeg"));

      expect(response.statusCode).toEqual(200);
      // No S3 write for duplicates, and no clip seeding either.
      expect(send).not.toHaveBeenCalled();
      expect(mockSeedClipForUpload).not.toHaveBeenCalled();
    });

    it("does not seed a clip when no report matches the sender (orphan media stored, no clip)", async () => {
      findReportSpy.mockResolvedValue(null);

      const { response } = await callInbound(mediaBody("image/jpeg"));

      expect(response.statusCode).toEqual(200);
      expect(findReportSpy).toHaveBeenCalledTimes(1);
      // Orphan media is stored (issue #341)...
      expect(createFromMmsSpy).toHaveBeenCalledWith(null, expect.anything());
      // ...but never seeded as a clip — there is no report to associate it
      // with, and clip kits need the report's location.
      expect(mockSeedClipForUpload).not.toHaveBeenCalled();
    });

    it("never seeds a clip on STOP keyword", async () => {
      findReportSpy.mockResolvedValue(fakeReport);

      const { response } = await callInbound({
        From: PHONE,
        Body: "STOP",
        MediaUrl0: "https://media.twilio.com/f1/0",
        MediaContentType0: "image/jpeg",
      });

      expect(response.statusCode).toEqual(200);
      expect(response._getData()).toContain(UNSUBSCRIBED_FRAGMENT);
      // STOP path returns early before report matching or media ingestion.
      expect(findReportSpy).not.toHaveBeenCalled();
      expect(createFromMmsSpy).not.toHaveBeenCalled();
      expect(mockSeedClipForUpload).not.toHaveBeenCalled();
    });

    it("signed Twilio path is unaffected (no clip seeding regression)", async () => {
      // Real Twilio requests are signed.
      verifyMock.mockImplementation(() => true);
      findReportSpy.mockResolvedValue(fakeReport);
      createFromMmsSpy.mockResolvedValue([{ ...fakeUpload }, false]);
      mockFetchBody(Buffer.from("clip-seed-test-bytes"));

      const { response } = await callInbound(mediaBody("image/jpeg"));

      expect(response.statusCode).toEqual(200);
      expect(response._getHeaders()["content-type"]).toContain("text/xml");
      expect(response._getData()).toContain(SHARED_FRAGMENT);
      // Clip seeding works identically on the signed Twilio path.
      expect(mockSeedClipForUpload).toHaveBeenCalledTimes(1);
      expect(mockSeedClipForUpload.mock.calls[0][0]).toBe(fakeReport);
    });
  });
});
