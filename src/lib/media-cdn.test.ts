import {
  cdnUrlForKey,
  cdnUrlFromStoredUrl,
  mediaCdnBaseUrl,
} from "./media-cdn";

describe("media-cdn", () => {
  const STORED =
    "https://s3.us-west-2.amazonaws.com/reports.polls.pizza/uploads/42/video_transcoded.mp4";
  const STORED_DOUBLED =
    "https://reports.polls.pizza.s3.amazonaws.com/uploads/42/video_transcoded.mp4";
  const CDN = "https://media.polls.pizza";

  afterEach(() => {
    delete process.env.MEDIA_CDN_DOMAIN;
  });

  it("rewrites stored S3 URLs against the CDN domain", () => {
    process.env.MEDIA_CDN_DOMAIN = "media.polls.pizza";
    expect(cdnUrlFromStoredUrl(STORED)).toBe(
      `${CDN}/uploads/42/video_transcoded.mp4`,
    );
  });

  it("rewrites legacy virtual-host style URLs too", () => {
    process.env.MEDIA_CDN_DOMAIN = "media.polls.pizza";
    expect(cdnUrlFromStoredUrl(STORED_DOUBLED)).toBe(
      `${CDN}/uploads/42/video_transcoded.mp4`,
    );
  });

  it("returns the stored URL unchanged when no CDN is configured", () => {
    expect(cdnUrlFromStoredUrl(STORED)).toBe(STORED);
  });

  it("returns null for null input", () => {
    process.env.MEDIA_CDN_DOMAIN = "media.polls.pizza";
    expect(cdnUrlFromStoredUrl(null)).toBeNull();
    expect(cdnUrlFromStoredUrl(undefined)).toBeNull();
  });

  it("builds CDN URLs for keys and reports base URL", () => {
    process.env.MEDIA_CDN_DOMAIN = "media.polls.pizza";
    expect(mediaCdnBaseUrl()).toBe(CDN);
    expect(cdnUrlForKey("uploads/42/poster.jpg")).toBe(
      `${CDN}/uploads/42/poster.jpg`,
    );
    expect(cdnUrlForKey("uploads/42/poster.jpg")).toBeTruthy();
  });

  it("returns null from cdnUrlForKey without a domain", () => {
    expect(cdnUrlForKey("uploads/42/poster.jpg")).toBeNull();
  });
});
