/**
 * Golden-args tests for the clip render template.
 *
 * These verify the exact ffmpeg invocation contracts produced by
 * buildRenderPlan() — no ffmpeg execution, no media fixtures. The render
 * lambda passes these argument arrays straight to the ffmpeg layer binary,
 * so the assertions below are the render spec (see docs/clip-render-infra.md
 * for how to smoke-test the args against a real binary).
 */

import {
  buildRenderPlan,
  buildSrt,
  buildKitJson,
  escapeFilterPath,
  formatReportedTime,
  wrapCaption,
  ClipRenderInput,
  MAX_SOURCE_DURATION_SECONDS,
  END_CARD_SECONDS,
  TARGET_HEIGHT,
  TARGET_WIDTH,
} from "./clipTemplate";

function renderInput(
  overrides: Partial<ClipRenderInput> = {},
): ClipRenderInput {
  return {
    captionText: "The line is around the block!",
    city: "Portland",
    state: "OR",
    reportedAt: "2024-11-05T14:30:00Z",
    shortUrlSlug: null,
    hashtags: ["#votingrights", "#ElectionDay", "#OR", "#Portland"],
    sourceDuration: 45,
    inputPath: "/tmp/render/input.mp4",
    outputDir: "/tmp/render",
    assetPrefix: "clips/42",
    fontFile: "/opt/fonts/DejaVuSans-Bold.ttf",
    ...overrides,
  };
}

describe("buildRenderPlan", () => {
  it("extracts the poster as a single 9:16-cropped frame", () => {
    const plan = buildRenderPlan(renderInput());

    expect(plan.posterExtractArgs).toContain("/tmp/render/input.mp4");
    expect(plan.posterExtractArgs[plan.posterExtractArgs.length - 1]).toBe(
      "/tmp/render/poster.jpg",
    );
    const vfIndex = plan.posterExtractArgs.indexOf("-vf");
    const vf = plan.posterExtractArgs[vfIndex + 1];
    expect(vf).toBe(
      "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
    );
    expect(plan.posterExtractArgs).toEqual(
      expect.arrayContaining(["-frames:v", "1", "-q:v", "2"]),
    );
  });

  it("renders the main clip as H.264/AAC MP4 at the source duration", () => {
    const plan = buildRenderPlan(renderInput({ sourceDuration: 45 }));

    const args = plan.clipRenderArgs;
    expect(args).toContain("/tmp/render/input.mp4");
    expect(args[args.length - 1]).toBe("/tmp/render/clip.mp4");
    expect(args).toEqual(
      expect.arrayContaining([
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-pix_fmt",
        "yuv420p",
        "-map",
        "0:a?",
        "-movflags",
        "+faststart",
      ]),
    );
    const tIndex = args.indexOf("-t");
    expect(args[tIndex + 1]).toBe("45");
    // Audio for the clip comes from the source video via the lavfi end-card
    // input as the second video source only.
    const lavfiIndex = args.indexOf("-i", args.indexOf("-f"));
    expect(args[lavfiIndex - 1]).toBe("lavfi");
    expect(args[lavfiIndex + 1]).toBe("color=c=0x101418:size=1080x1920");
    expect(TARGET_WIDTH).toBe(1080);
    expect(TARGET_HEIGHT).toBe(1920);
  });

  it("caps the render at 90s and places the end-card before the tail", () => {
    const plan = buildRenderPlan(
      renderInput({ sourceDuration: MAX_SOURCE_DURATION_SECONDS + 60 }),
    );

    expect(plan.renderedDurationSeconds).toBe(90);
    expect(plan.endCardStartSeconds).toBe(90 - END_CARD_SECONDS);
    const tIndex = plan.clipRenderArgs.indexOf("-t");
    expect(plan.clipRenderArgs[tIndex + 1]).toBe("90");
    expect(plan.clipRenderArgs.join(" ")).toContain("enable='gte(t,88)'");
  });

  it("does not extend short sources and clamps the end-card to t=0", () => {
    const plan = buildRenderPlan(renderInput({ sourceDuration: 1 }));

    const tIndex = plan.clipRenderArgs.indexOf("-t");
    expect(plan.clipRenderArgs[tIndex + 1]).toBe("1");
    expect(plan.endCardStartSeconds).toBe(0);
    expect(plan.clipRenderArgs.join(" ")).toContain("enable='gte(t,0)'");
  });

  it("center-crops to 9:16 and overlays the end-card in the filtergraph", () => {
    const plan = buildRenderPlan(renderInput({ sourceDuration: 45 }));
    const graph =
      plan.clipRenderArgs[plan.clipRenderArgs.indexOf("-filter_complex") + 1];

    expect(graph).toContain(
      "scale=1080:1920:force_original_aspect_ratio=increase",
    );
    expect(graph).toContain("crop=1080:1920");
    expect(graph).toContain("setsar=1");
    expect(graph).toContain("[0:v]");
    expect(graph).toContain("[1:v]");
    expect(graph).toMatch(
      /\[base\]\[card\]overlay=0:0:enable='gte\(t,43\)'\[out\]/,
    );
  });

  it("burns the caption in as bottom-third drawtext with a stable 2-line wrap", () => {
    const plan = buildRenderPlan(
      renderInput({
        captionText:
          "The line wraps around the entire block and then some more words",
      }),
    );

    const captionFiles = plan.textFiles.filter((f) =>
      f.path.endsWith("caption-line-1.txt"),
    );
    expect(captionFiles).toHaveLength(1);
    const line2 = plan.textFiles.find((f) =>
      f.path.endsWith("caption-line-2.txt"),
    );
    expect(line2).toBeDefined();
    expect(line2!.content.length).toBeGreaterThan(0);

    const graph =
      plan.clipRenderArgs[plan.clipRenderArgs.indexOf("-filter_complex") + 1];
    expect(graph).toContain("caption-line-1.txt");
    expect(graph).toContain("caption-line-2.txt");
    expect(graph).toContain("fontsize=52");
    expect(graph).toContain("y=h-300");
    expect(graph).toContain("y=h-224");
    // Captions are centered on the 9:16 canvas.
    expect(graph).toContain("x=(w-text_w)/2");
  });

  it("omits caption drawtext when there is no caption text", () => {
    const plan = buildRenderPlan(renderInput({ captionText: null }));

    expect(
      plan.textFiles.find((f) => f.path.includes("caption-line")),
    ).toBeUndefined();
    const graph =
      plan.clipRenderArgs[plan.clipRenderArgs.indexOf("-filter_complex") + 1];
    expect(graph).not.toContain("caption-line");
    // No caption → empty sidecar SRT (still uploaded as the 4th asset).
    expect(plan.sidecarSrt).toBe("");
  });

  it("draws the city/state lower third above the caption area", () => {
    const plan = buildRenderPlan(renderInput());

    const cityFile = plan.textFiles.find((f) =>
      f.path.endsWith("lowerthird-city.txt"),
    );
    expect(cityFile!.content).toBe("Portland, OR");

    const graph =
      plan.clipRenderArgs[plan.clipRenderArgs.indexOf("-filter_complex") + 1];
    expect(graph).toContain("lowerthird-city.txt");
    expect(graph).toContain("y=h-440");
  });

  it("adds the reported-time lower-third line when reportedAt is valid", () => {
    const plan = buildRenderPlan(renderInput());

    const reportedFile = plan.textFiles.find((f) =>
      f.path.endsWith("lowerthird-reported.txt"),
    );
    expect(reportedFile!.content).toBe("reported 2:30 PM");

    const graph =
      plan.clipRenderArgs[plan.clipRenderArgs.indexOf("-filter_complex") + 1];
    expect(graph).toContain("lowerthird-reported.txt");
    expect(graph).toContain("y=h-372");
  });

  it("skips the reported-time line for missing or invalid reportedAt", () => {
    for (const reportedAt of [null, "not-a-date"]) {
      const plan = buildRenderPlan(
        renderInput({ reportedAt: reportedAt as any }),
      );
      expect(
        plan.textFiles.find((f) => f.path.endsWith("lowerthird-reported.txt")),
      ).toBeUndefined();
    }
  });

  it("builds the branded end-card text (no URL line without a slug)", () => {
    const plan = buildRenderPlan(renderInput());

    const brandFile = plan.textFiles.find((f) =>
      f.path.endsWith("endcard-brand.txt"),
    );
    const siteFile = plan.textFiles.find((f) =>
      f.path.endsWith("endcard-site.txt"),
    );
    expect(brandFile!.content).toBe("Pizza to the Polls");
    expect(siteFile!.content).toBe("polls.pizza");
    expect(
      plan.textFiles.find((f) => f.path.endsWith("endcard-url.txt")),
    ).toBeUndefined();
  });

  it("includes the short URL slug on the end-card when present", () => {
    const plan = buildRenderPlan(renderInput({ shortUrlSlug: "abc123" }));

    expect(
      plan.textFiles.find((f) => f.path.endsWith("endcard-url.txt"))!.content,
    ).toBe("polls.pizza/abc123");
    const graph =
      plan.clipRenderArgs[plan.clipRenderArgs.indexOf("-filter_complex") + 1];
    expect(graph).toContain("endcard-url.txt");
  });

  it("passes the layer font to every drawtext filter when configured", () => {
    const plan = buildRenderPlan(renderInput());

    const graph =
      plan.clipRenderArgs[plan.clipRenderArgs.indexOf("-filter_complex") + 1];
    const drawtextCount = graph.split("drawtext=").length - 1;
    expect(drawtextCount).toBeGreaterThan(0);
    const fontRefs = graph.match(
      /fontfile=\/opt\/fonts\/DejaVuSans-Bold\.ttf/g,
    );
    expect(fontRefs!.length).toBe(drawtextCount);
  });

  it("escapes path characters in filtergraph textfile references", () => {
    const plan = buildRenderPlan(
      renderInput({ outputDir: "/tmp/we ird:dir,x" }),
    );

    const graph =
      plan.clipRenderArgs[plan.clipRenderArgs.indexOf("-filter_complex") + 1];
    expect(graph).toContain(
      "textfile=/tmp/we ird\\:dir\\,x/lowerthird-city.txt",
    );
  });

  it("escapes filter paths via escapeFilterPath", () => {
    expect(escapeFilterPath("/tmp/a/b.srt")).toBe("/tmp/a/b.srt");
    expect(escapeFilterPath("C:\\x\\y.srt")).toBe("C\\:\\\\x\\\\y.srt");
    expect(escapeFilterPath("a'b,c")).toBe("a\\'b\\,c");
  });
});

describe("buildSrt", () => {
  it("produces a single entry spanning the main body", () => {
    expect(buildSrt("Line around the block", 43)).toBe(
      "1\n00:00:00,000 --> 00:00:43,000\nLine around the block\n",
    );
  });

  it("wraps long captions to at most two SRT lines", () => {
    const srt = buildSrt(
      "The line wraps around the entire block and then some more words follow here",
      88,
    );
    // SRT shape: index, timestamp, then the wrapped caption body lines.
    const lines = srt
      .split("\n")
      .slice(2)
      .filter((l) => l.length > 0);
    expect(lines.length).toBe(2);
    expect(lines[0].length).toBeLessThanOrEqual(36);
    expect(lines[1].length).toBeLessThanOrEqual(36);
  });

  it("returns an empty sidecar for missing or blank captions", () => {
    expect(buildSrt(null, 43)).toBe("");
    expect(buildSrt("   ", 43)).toBe("");
  });
});

describe("wrapCaption", () => {
  it("keeps short captions on one line", () => {
    expect(wrapCaption("Short line")).toBe("Short line");
  });

  it("wraps at word boundaries and never exceeds two lines", () => {
    const wrapped = wrapCaption(
      "The line wraps around the entire block and then keeps going and going",
    );
    const lines = wrapped.split("\n");
    expect(lines.length).toBe(2);
    lines.forEach((line) => expect(line.length).toBeLessThanOrEqual(36));
  });

  it("elides overflow with an ellipsis on the final line", () => {
    const wrapped = wrapCaption(
      "a".repeat(40) +
        " " +
        "b".repeat(40) +
        " " +
        "c".repeat(40) +
        " trailing words",
    );
    const lines = wrapped.split("\n");
    expect(lines.length).toBe(2);
    expect(lines[1].endsWith("…")).toBe(true);
  });

  it("returns an empty string for blank input", () => {
    expect(wrapCaption("   ")).toBe("");
  });
});

describe("formatReportedTime", () => {
  it("formats a UTC 12-hour clock time from an ISO timestamp", () => {
    expect(formatReportedTime("2024-11-05T14:30:00Z")).toBe("2:30 PM");
    expect(formatReportedTime("2024-11-05T07:05:00Z")).toBe("7:05 AM");
  });

  it("returns null for missing or invalid input", () => {
    expect(formatReportedTime(null)).toBeNull();
    expect(formatReportedTime(undefined)).toBeNull();
    expect(formatReportedTime("")).toBeNull();
    expect(formatReportedTime("bogus")).toBeNull();
  });
});

describe("buildKitJson", () => {
  it("serializes the publish kit with the PTP caption suffix and assets", () => {
    const kitJson = buildKitJson({
      captionText: "Long lines at the polls",
      hashtags: ["#votingrights", "#ElectionDay", "#OR", "#Portland"],
      shortUrlSlug: null,
      city: "Portland",
      state: "OR",
      reportedAt: "2024-11-05T14:30:00Z",
      assets: {
        video: "clips/42/clip.mp4",
        captions: "clips/42/clip.srt",
        poster: "clips/42/poster.jpg",
      },
    });
    const kit = JSON.parse(kitJson);

    expect(kit.caption).toBe("Long lines at the polls 🍕🗳");
    expect(kit.hashtags).toEqual([
      "#votingrights",
      "#ElectionDay",
      "#OR",
      "#Portland",
    ]);
    expect(kit.shortUrlSlug).toBeNull();
    expect(kit.city).toBe("Portland");
    expect(kit.state).toBe("OR");
    expect(kit.reportedAt).toBe("2024-11-05T14:30:00Z");
    expect(kit.platforms).toEqual(["tiktok", "reels", "shorts"]);
    expect(kit.assets).toEqual({
      video: "clips/42/clip.mp4",
      captions: "clips/42/clip.srt",
      poster: "clips/42/poster.jpg",
    });
  });

  it("falls back to derived hashtags and null caption when unset", () => {
    const kit = JSON.parse(
      buildKitJson({
        captionText: null,
        hashtags: null,
        shortUrlSlug: null,
        city: "St. Louis",
        state: "MO",
        reportedAt: "2024-11-05T14:30:00Z",
        assets: { video: "c/v", captions: "c/s", poster: "c/p" },
      }),
    );

    expect(kit.caption).toBeNull();
    expect(kit.hashtags).toEqual([
      "#votingrights",
      "#ElectionDay",
      "#MO",
      "#StLouis",
    ]);
  });

  it("passes the short URL slug through when present", () => {
    const kit = JSON.parse(
      buildKitJson({
        captionText: "hi",
        hashtags: ["#votingrights"],
        shortUrlSlug: "abc123",
        city: "Portland",
        state: "OR",
        reportedAt: "2024-11-05T14:30:00Z",
        assets: { video: "c/v", captions: "c/s", poster: "c/p" },
      }),
    );
    expect(kit.shortUrlSlug).toBe("abc123");
  });
});
