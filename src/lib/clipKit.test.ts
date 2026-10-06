import * as notifyBugsnagModule from "./notifyBugsnag";
import {
  buildClipKitPayload,
  buildClipKitSlackPayload,
  notifyClipKit,
} from "./clipKit";
import { Clip } from "../entity/Clip";

const WEBHOOK = "https://hooks.zapier.com/hooks/catch/12345/testhook";
const CDN = "https://media.polls.pizza";

// Pure in-memory fixture — notifyClipKit reads the Clip object only and
// never touches the database, so no DB setup is needed here.
const makeClip = (): Clip => {
  const clip = new Clip();
  clip.id = 42;
  clip.status = "approved";
  clip.kit = {
    city: "Portland",
    state: "OR",
    reportedAt: "2024-11-05T14:30:00Z",
    photoLinks: ["https://base.polls.pizza/uploads/a1b2.mp4"],
    photos: [
      {
        url: "https://base.polls.pizza/uploads/a1b2.mp4",
        address: "225 E 75th St",
        city: "New York",
        state: "NY",
        pizzas: 5,
        restaurant: "Famous Famiglia Pizza",
      },
    ],
  };
  clip.outputPaths = {
    video: "clips/42/clip.mp4",
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
  delete process.env.ZAP_NEW_CLIP;
});

afterEach(() => {
  delete process.env.MEDIA_CDN_DOMAIN;
  delete process.env.ZAP_NEW_CLIP;
});

const makeCompilation = (): Clip => {
  const clip = makeClip();
  clip.kit = {
    ...clip.kit,
    isCompilation: true,
    memberClipIds: [10, 11, 12],
    photos: [
      {
        url: "https://base.polls.pizza/uploads/a1.mp4",
        address: "225 E 75th St",
        city: "New York",
        state: "NY",
        pizzas: null,
        restaurant: null,
      },
      {
        url: "https://base.polls.pizza/uploads/b2.mp4",
        address: "5525 N Lark Ellen Ave",
        city: "Azusa",
        state: "CA",
        pizzas: 17,
        restaurant: "Hala's Pizzeria, Dominos",
      },
      {
        url: "https://base.polls.pizza/uploads/c3.mp4",
        address: "3909 Centre St",
        city: "San Diego",
        state: "CA",
        pizzas: 1,
        restaurant: "Lefty's",
      },
    ],
    photoLinks: [
      "https://base.polls.pizza/uploads/a1.mp4",
      "https://base.polls.pizza/uploads/b2.mp4",
      "https://base.polls.pizza/uploads/c3.mp4",
    ],
  };
  clip.outputPaths = {
    video: "clips/43/clip.mp4",
    poster: "clips/43/poster.jpg",
  };
  return clip;
};

describe("buildClipKitSlackPayload", () => {
  it("includes the fallback text with city, state, and video URL", () => {
    const payload = buildClipKitSlackPayload(makeClip()) as Record<string, any>;

    expect(payload.text).toEqual(
      "🎬 New clip ready: Portland, OR — https://media.polls.pizza/clips/42/clip.mp4",
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

  it("carries no caption section (video productions only)", () => {
    const payload = buildClipKitSlackPayload(makeClip()) as Record<string, any>;

    const sections = (payload.blocks as any[]).filter(
      (b) => b.type === "section",
    );
    expect(sections.every((s) => !s.text?.text?.includes("No caption"))).toBe(
      true,
    );
    expect(JSON.stringify(payload)).not.toContain("No caption in kit");
  });

  it("links the video and kit.json assets", () => {
    const payload = buildClipKitSlackPayload(makeClip()) as Record<string, any>;

    const linksSection = payload.blocks.find((b: any) =>
      b.text?.text?.includes("Video (MP4)"),
    );
    expect(linksSection).toBeTruthy();
    expect(linksSection.text.text).toContain(
      `<${CDN}/clips/42/clip.mp4|Video (MP4)>`,
    );
    expect(linksSection.text.text).not.toContain("Captions (SRT)");
    expect(linksSection.text.text).toContain(
      `<${CDN}/clips/42/kit.json|Kit JSON>`,
    );
  });

  it("lists a link to every source photo used", () => {
    const payload = buildClipKitSlackPayload(makeCompilation()) as Record<
      string,
      any
    >;

    const photosSection = payload.blocks.find((b: any) =>
      b.text?.text?.includes("Photos used:"),
    );
    expect(photosSection).toBeTruthy();
    expect(photosSection.text.text).toContain(
      "<https://base.polls.pizza/uploads/a1.mp4|Photo 1>",
    );
    expect(photosSection.text.text).toContain(
      "<https://base.polls.pizza/uploads/b2.mp4|Photo 2>",
    );
    expect(photosSection.text.text).toContain(
      "<https://base.polls.pizza/uploads/c3.mp4|Photo 3>",
    );
    // The rich entries carry the story: address + pizzas + restaurant.
    expect(photosSection.text.text).toContain("225 E 75th St, New York, NY");
    expect(photosSection.text.text).toContain(
      "17 pizzas from Hala's Pizzeria, Dominos",
    );
    expect(photosSection.text.text).toContain(
      "5525 N Lark Ellen Ave, Azusa, CA",
    );
  });

  it("headlines compilations with the member clip count", () => {
    const payload = buildClipKitSlackPayload(makeCompilation()) as Record<
      string,
      any
    >;

    const header = payload.blocks.find((b: any) => b.type === "header");
    expect(header.text.text).toEqual("🎬 New compilation — 3 clips");
    expect(payload.text).toContain("3 clips");
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

  it("gracefully handles a clip with no outputPaths", () => {
    const clip = makeClip();
    clip.outputPaths = null;

    const payload = buildClipKitSlackPayload(clip) as Record<string, any>;

    expect(blockTypes(payload)).not.toContain("image");
    expect(payload.text).toContain("🎬 New clip ready: Portland, OR");
    expect(JSON.stringify(payload)).not.toContain("No caption in kit");
  });

  it("reminds volunteers to post natively and confirm via the publish endpoint", () => {
    const payload = buildClipKitSlackPayload(makeClip()) as Record<string, any>;

    const context = payload.blocks.find((b: any) => b.type === "context");
    expect(context.elements[0].text).toContain("TikTok");
    expect(context.elements[0].text).toContain("POST /clips/42/publish");
  });
});

describe("buildClipKitPayload", () => {
  it("flattens every kit field and resolved asset URL for the Zap", () => {
    const payload = buildClipKitPayload(makeClip()) as Record<string, any>;

    expect(payload.clipId).toBe(42);
    expect(payload.status).toBe("approved");
    expect(payload.isCompilation).toBe(false);
    expect(payload.city).toBe("Portland");
    expect(payload.state).toBe("OR");
    expect(payload.reportedAt).toBe("2024-11-05T14:30:00Z");
    expect("caption" in payload).toBe(false);
    expect(payload.photoLinks).toEqual([
      "https://base.polls.pizza/uploads/a1b2.mp4",
    ]);
    expect(payload.photos).toEqual([
      {
        url: "https://base.polls.pizza/uploads/a1b2.mp4",
        address: "225 E 75th St",
        city: "New York",
        state: "NY",
        pizzas: 5,
        restaurant: "Famous Famiglia Pizza",
      },
    ]);
    expect(payload.memberClipIds).toBeNull();
    expect(payload.uploadId).toBeNull();
    expect(payload.videoUrl).toBe(`${CDN}/clips/42/clip.mp4`);
    expect(payload.posterUrl).toBe(`${CDN}/clips/42/poster.jpg`);
    expect(payload.kitJsonUrl).toBe(`${CDN}/clips/42/kit.json`);
    expect(payload.outputPaths).toEqual({
      video: "clips/42/clip.mp4",
      poster: "clips/42/poster.jpg",
      kit: "clips/42/kit.json",
    });
    // The ready-to-post Slack message rides along under `slack`.
    expect(payload.slack.text).toContain("New clip ready");
    expect(blockTypes(payload.slack)).toContain("header");
  });

  it("carries compilation members and their photo links", () => {
    const payload = buildClipKitPayload(makeCompilation()) as Record<
      string,
      any
    >;

    expect(payload.isCompilation).toBe(true);
    expect(payload.memberClipIds).toEqual([10, 11, 12]);
    expect(payload.photoLinks).toHaveLength(3);
    expect(payload.slack.text).toContain("3 clips");
  });
});

describe("notifyClipKit", () => {
  const fetchMock = global.fetch as jest.Mock;

  beforeEach(() => {
    fetchMock.mockClear();
    fetchMock.mockResolvedValue({ ok: true });
  });

  it("POSTs the Block Kit payload through the ZAP_NEW_CLIP Zapier hook", async () => {
    process.env.ZAP_NEW_CLIP = WEBHOOK;

    await notifyClipKit(makeClip());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toEqual(WEBHOOK);
    expect(init.method).toEqual("POST");
    const body = JSON.parse(init.body);
    expect(body.hook).toEqual("ZAP_NEW_CLIP");
    // Rich clip data — the Zap attaches whatever it needs.
    expect(body.clip.clipId).toBe(42);
    expect(body.clip.videoUrl).toBe(`${CDN}/clips/42/clip.mp4`);
    expect(body.clip.photoLinks).toEqual([
      "https://base.polls.pizza/uploads/a1b2.mp4",
    ]);
    // Ready-to-post Slack message nested under clip.slack.
    expect(body.clip.slack.text).toContain("🎬 New clip ready: Portland, OR");
    expect(blockTypes(body.clip.slack)).toEqual([
      "header",
      "image",
      "section",
      "section",
      "context",
    ]);
  });

  it("is a no-op (no fetch) when ZAP_NEW_CLIP is unset", async () => {
    await notifyClipKit(makeClip());

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows a rejected POST and reports to Bugsnag", async () => {
    process.env.ZAP_NEW_CLIP = WEBHOOK;
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
    process.env.ZAP_NEW_CLIP = WEBHOOK;
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
