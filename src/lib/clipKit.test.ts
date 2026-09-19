import * as notifyBugsnagModule from "./notifyBugsnag";
import { buildClipKitSlackPayload, notifyClipKit } from "./clipKit";
import { Clip } from "../entity/Clip";

const WEBHOOK = "https://hooks.slack.com/services/T000/B000/testhook";
const CDN = "https://media.polls.pizza";

// Pure in-memory fixture — notifyClipKit reads the Clip object only and
// never touches the database, so no DB setup is needed here.
const makeClip = (): Clip => {
  const clip = new Clip();
  clip.id = 42;
  clip.status = "approved";
  clip.kit = {
    caption: "The line wraps around the block!",
    hashtags: ["#votingrights", "#Portland"],
    city: "Portland",
    state: "OR",
    reportedAt: "2024-11-05T14:30:00Z",
    shortUrlSlug: "ab3xz",
  };
  clip.outputPaths = {
    video: "clips/42/clip.mp4",
    captions: "clips/42/clip.srt",
    poster: "clips/42/poster.jpg",
    kit: "clips/42/kit.json",
  };
  clip.publishLog = null;
  return clip;
};

const blockTypes = (payload: Record<string, any>): string[] =>
  (payload.blocks as any[]).map((b) => b.type);

beforeEach(() => {
  process.env.UPLOAD_S3_BUCKET = "reports.polls.pizza";
  process.env.MEDIA_CDN_DOMAIN = "media.polls.pizza";
  delete process.env.CLIP_KIT_SLACK_WEBHOOK;
});

afterEach(() => {
  delete process.env.MEDIA_CDN_DOMAIN;
  delete process.env.CLIP_KIT_SLACK_WEBHOOK;
});

describe("buildClipKitSlackPayload", () => {
  it("includes the fallback text with city, state, and short link", () => {
    const payload = buildClipKitSlackPayload(makeClip()) as Record<string, any>;

    expect(payload.text).toEqual(
      "🎬 New clip ready: Portland, OR — https://polls.pizza/l/ab3xz",
    );
  });

  it("has a header block naming the clip's city and state", () => {
    const payload = buildClipKitSlackPayload(makeClip()) as Record<string, any>;

    expect(blockTypes(payload)).toContain("header");
    const header = payload.blocks.find((b: any) => b.type === "header");
    expect(header.text.text).toEqual("🎬 New clip ready — Portland, OR");
  });

  it("includes the poster image block at its CDN URL", () => {
    const payload = buildClipKitSlackPayload(makeClip()) as Record<string, any>;

    expect(blockTypes(payload)).toContain("image");
    const image = payload.blocks.find((b: any) => b.type === "image");
    expect(image.image_url).toEqual(`${CDN}/clips/42/poster.jpg`);
    expect(image.alt_text).toContain("Portland");
  });

  it("includes the caption and hashtags from the kit", () => {
    const payload = buildClipKitSlackPayload(makeClip()) as Record<string, any>;

    const section = payload.blocks.find(
      (b: any) =>
        b.type === "section" && b.text?.text?.includes("#votingrights"),
    );
    expect(section.text.text).toContain("The line wraps around the block!");
    expect(section.text.text).toContain("#votingrights");
    expect(section.text.text).toContain("#Portland");
  });

  it("links the video, captions, and kit.json assets", () => {
    const payload = buildClipKitSlackPayload(makeClip()) as Record<string, any>;

    const linksSection = payload.blocks.find((b: any) =>
      b.text?.text?.includes("Video (MP4)"),
    );
    expect(linksSection).toBeTruthy();
    expect(linksSection.text.text).toContain(
      `<${CDN}/clips/42/clip.mp4|Video (MP4)>`,
    );
    expect(linksSection.text.text).toContain(
      `<${CDN}/clips/42/clip.srt|Captions (SRT)>`,
    );
    expect(linksSection.text.text).toContain(
      `<${CDN}/clips/42/kit.json|Kit JSON>`,
    );
    expect(linksSection.text.text).toContain(
      "<https://polls.pizza/l/ab3xz|Donation link>",
    );
  });

  it("falls back to path-style S3 URLs when no CDN is configured", () => {
    delete process.env.MEDIA_CDN_DOMAIN;
    const payload = buildClipKitSlackPayload(makeClip()) as Record<string, any>;

    const image = payload.blocks.find((b: any) => b.type === "image");
    expect(image.image_url).toEqual(
      "https://reports.polls.pizza.s3.amazonaws.com/clips/42/poster.jpg",
    );
    const linksSection = payload.blocks.find((b: any) =>
      b.text?.text?.includes("Video (MP4)"),
    );
    expect(linksSection.text.text).toContain(
      "https://reports.polls.pizza.s3.amazonaws.com/clips/42/clip.mp4|Video (MP4)",
    );
  });

  it("gracefully handles a clip with no outputPaths or caption", () => {
    const clip = makeClip();
    clip.outputPaths = null;
    clip.kit = { ...clip.kit, caption: null, shortUrlSlug: null };

    const payload = buildClipKitSlackPayload(clip) as Record<string, any>;

    expect(blockTypes(payload)).not.toContain("image");
    expect(payload.text).toContain("🎬 New clip ready: Portland, OR");
    const captionSection = payload.blocks.find(
      (b: any) => b.type === "section",
    );
    expect(captionSection.text.text).toContain("No caption in kit");
  });

  it("reminds volunteers to post natively and confirm via the publish endpoint", () => {
    const payload = buildClipKitSlackPayload(makeClip()) as Record<string, any>;

    const context = payload.blocks.find((b: any) => b.type === "context");
    expect(context.elements[0].text).toContain("TikTok");
    expect(context.elements[0].text).toContain("POST /clips/42/publish");
  });
});

describe("notifyClipKit", () => {
  const fetchMock = global.fetch as jest.Mock;

  beforeEach(() => {
    fetchMock.mockClear();
    fetchMock.mockResolvedValue({ ok: true });
  });

  it("POSTs the Block Kit payload to the configured webhook", async () => {
    process.env.CLIP_KIT_SLACK_WEBHOOK = WEBHOOK;

    await notifyClipKit(makeClip());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toEqual(WEBHOOK);
    expect(init.method).toEqual("POST");
    const body = JSON.parse(init.body);
    expect(body.text).toContain("🎬 New clip ready: Portland, OR");
    expect(blockTypes(body)).toEqual([
      "header",
      "image",
      "section",
      "section",
      "context",
    ]);
  });

  it("is a no-op (no fetch) when CLIP_KIT_SLACK_WEBHOOK is unset", async () => {
    await notifyClipKit(makeClip());

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows a rejected POST and reports to Bugsnag", async () => {
    process.env.CLIP_KIT_SLACK_WEBHOOK = WEBHOOK;
    const bugsnagSpy = jest
      .spyOn(notifyBugsnagModule, "notifyBugsnag")
      .mockImplementation(() => {});

    try {
      fetchMock.mockRejectedValue(new Error("Slack is down"));

      await expect(notifyClipKit(makeClip())).resolves.toBeUndefined();
      expect(bugsnagSpy).toHaveBeenCalledTimes(1);
      expect(bugsnagSpy.mock.calls[0][0]).toBeInstanceOf(Error);
    } finally {
      bugsnagSpy.mockRestore();
    }
  });

  it("swallows a non-ok webhook response and reports to Bugsnag", async () => {
    process.env.CLIP_KIT_SLACK_WEBHOOK = WEBHOOK;
    const bugsnagSpy = jest
      .spyOn(notifyBugsnagModule, "notifyBugsnag")
      .mockImplementation(() => {});

    try {
      fetchMock.mockResolvedValue({ ok: false, status: 404 });

      await expect(notifyClipKit(makeClip())).resolves.toBeUndefined();
      expect(bugsnagSpy).toHaveBeenCalledTimes(1);
    } finally {
      bugsnagSpy.mockRestore();
    }
  });
});
