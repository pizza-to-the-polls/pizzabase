import { zapNewMmsUpload } from "./zapier";
import { Upload } from "../entity/Upload";
import { Report } from "../entity/Report";
import { Location } from "../entity/Location";
import { NormalAddress } from "./validator";

const ADDRESS: NormalAddress = {
  latitude: 41.79907,
  longitude: -87.58413,
  fullAddress: "5335 S Kimbark Ave Chicago IL 60615",
  address: "5335 S Kimbark Ave",
  city: "Chicago",
  state: "IL",
  zip: "60615",
};

const ZAP_HOOK_URL = "https://hooks.zapier.com/hooks/catch/123456/abcdef/";
const REPORT_URL = "https://polls.pizza/report/mms-notify-test";
const WEBP_URL =
  "https://s3.us-west-2.amazonaws.com/reports.polls.pizza/uploads/1/photo.webp";
const MP4_URL =
  "https://s3.us-west-2.amazonaws.com/reports.polls.pizza/uploads/1/video_transcoded.mp4";

/**
 * Build a realistic MMS upload through the real entity factories so the
 * report relation, location and defaults match production behavior.
 */
async function createMmsUpload(
  overrides: Partial<Upload> = {},
): Promise<Upload> {
  const [report] = await Report.createNewReport(
    "+14255551234",
    REPORT_URL,
    ADDRESS,
  );
  const [upload] = await Upload.createFromMms(report, {
    fileExt: "jpg",
    fileHash: `mms-notify-${Math.random().toString(36).slice(2)}`,
    sourcePhone: "+14255551234",
  });

  Object.assign(upload, {
    mediaStatus: "ready",
    moderationStatus: "clean",
    exifScrubbed: true,
    processedFilePath: {
      webp: WEBP_URL,
      jpeg: WEBP_URL.replace(/\.webp$/, ".jpeg"),
    },
    ...overrides,
  });
  await upload.save();
  return upload;
}

const fetchBody = (): any => {
  const call = (global.fetch as jest.Mock).mock.calls[0];
  return JSON.parse(call[1].body);
};

describe("zapNewMmsUpload (ZAP_NEW_MMS_UPLOAD)", () => {
  beforeEach(() => {
    process.env.ZAP_NEW_MMS_UPLOAD = ZAP_HOOK_URL;
  });

  afterEach(() => {
    delete process.env.ZAP_NEW_MMS_UPLOAD;
    delete process.env.MEDIA_CDN_DOMAIN;
  });

  it("does nothing when ZAP_NEW_MMS_UPLOAD is unset", async () => {
    delete process.env.ZAP_NEW_MMS_UPLOAD;

    const upload = await createMmsUpload();
    await zapNewMmsUpload(upload);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does nothing for web-origin uploads", async () => {
    const [report] = await Report.createNewReport(
      "+14255551234",
      REPORT_URL,
      ADDRESS,
    );
    const [upload] = await Upload.createFromMms(report, {
      fileExt: "jpg",
      fileHash: `web-src-${Math.random().toString(36).slice(2)}`,
      sourcePhone: "+14255551234",
    });
    upload.source = "web";
    await upload.save();

    await zapNewMmsUpload(upload);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each(["flagged", "rejected"] as const)(
    "does not notify for %s uploads (human reviews in Retool)",
    async (moderationStatus) => {
      const upload = await createMmsUpload({ moderationStatus });
      await zapNewMmsUpload(upload);

      expect(global.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["pending", "clean"] as const)(
    "notifies for %s uploads",
    async (moderationStatus) => {
      const upload = await createMmsUpload({ moderationStatus });
      await zapNewMmsUpload(upload);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(ZAP_HOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.any(String),
      });
      expect(fetchBody().hook).toBe("ZAP_NEW_MMS_UPLOAD");
    },
  );

  it("shares only processed CDN URLs — never the raw file path", async () => {
    process.env.MEDIA_CDN_DOMAIN = "media.polls.pizza";

    const upload = await createMmsUpload({
      processedFilePath: { webp: WEBP_URL, mp4: MP4_URL },
    });
    await zapNewMmsUpload(upload);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.stringify(fetchBody());

    // Processed URLs rewritten against the CDN are shared
    expect(body).toContain("https://media.polls.pizza/uploads/1/photo.webp");
    expect(body).toContain(
      "https://media.polls.pizza/uploads/1/video_transcoded.mp4",
    );

    // Raw path (and anything identifying it) must never appear
    expect(body).not.toContain(upload.rawFilePath!);
    expect(body).not.toContain("raw.polls.pizza");
  });

  it("includes the sightengineScore when present", async () => {
    const upload = await createMmsUpload({ sightengineScore: 0.87 });
    await zapNewMmsUpload(upload);

    expect(fetchBody().upload.sightengineScore).toBe(0.87);
  });

  it("includes the report URL from the report relation", async () => {
    const upload = await createMmsUpload();
    await zapNewMmsUpload(upload);

    const body = fetchBody();
    expect(body.report).toEqual({
      id: expect.any(Number),
      reportURL: REPORT_URL,
    });
    expect(body.location.city).toBe("Chicago");
    expect(body.location.state).toBe("IL");
  });

  it("sends a null report when the upload has no report", async () => {
    const location = await Location.createFromAddress(ADDRESS);
    const upload = new Upload();
    Object.assign(upload, {
      location,
      ipAddress: "mms",
      filePath: "uploads/chicago-il-noreport.jpg",
      rawFilePath: "uploads/chicago-il-noreport.jpg",
      fileHash: `noreport-${Math.random().toString(36).slice(2)}`,
      mediaStatus: "ready",
      moderationStatus: "clean",
      source: "mms",
      processedFilePath: { webp: WEBP_URL },
    });
    await upload.save();

    await zapNewMmsUpload(upload);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(fetchBody().report).toBeNull();
  });

  it("does not leak the transcode jobId from processedFilePath", async () => {
    const upload = await createMmsUpload({
      processedFilePath: { jobId: "1234-abcd" },
    });
    await zapNewMmsUpload(upload);

    expect(JSON.stringify(fetchBody())).not.toContain("1234-abcd");
  });

  it("swallows fetch failures without throwing", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error("Zapier is down"),
    );

    const upload = await createMmsUpload();
    await expect(zapNewMmsUpload(upload)).resolves.toBeUndefined();
  });
});
