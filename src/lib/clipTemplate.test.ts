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
  buildKitJson,
  escapeFilterPath,
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
    city: "Portland",
    state: "OR",
    reportedAt: "2024-11-05T14:30:00Z",
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

  it("renders clean video: no caption or lower-third overlays on the photos", () => {
    const plan = buildRenderPlan(renderInput());

    // Only end-card text files exist — nothing is burned onto the photos.
    const overlayFiles = plan.textFiles.filter(
      (f) => !f.path.includes("endcard-"),
    );
    expect(overlayFiles).toHaveLength(0);
    const graph =
      plan.clipRenderArgs[plan.clipRenderArgs.indexOf("-filter_complex") + 1];
    expect(graph).not.toContain("caption-line");
    expect(graph).not.toContain("lowerthird");
    // The base chain is pure geometry: scale, crop, setsar — no drawtext.
    const base = graph.split(";")[0];
    expect(base).toBe(
      "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[base]",
    );
  });

  it("builds the brand-only end-card (no QR, no URL line)", () => {
    const plan = buildRenderPlan(renderInput());

    const brandFile = plan.textFiles.find((f) =>
      f.path.endsWith("endcard-brand.txt"),
    );
    const siteFile = plan.textFiles.find((f) =>
      f.path.endsWith("endcard-site.txt"),
    );
    expect(brandFile!.content).toBe("Pizza to the Polls");
    expect(siteFile!.content).toBe("polls.pizza");
    // No URL/QR artifacts survive the short-link removal.
    expect(
      plan.textFiles.find((f) => f.path.endsWith("endcard-url.txt")),
    ).toBeUndefined();
    const graph =
      plan.clipRenderArgs[plan.clipRenderArgs.indexOf("-filter_complex") + 1];
    expect(graph).not.toContain("[qr]");
    expect(graph).toMatch(/\[base\]\[card\]overlay=0:0/);
    // Exactly two ffmpeg inputs: source + lavfi end-card color.
    expect(plan.clipRenderArgs.filter((a) => a === "-i")).toHaveLength(2);
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
    expect(graph).toContain("textfile=/tmp/we ird\\:dir\\,x/endcard-brand.txt");
  });

  it("escapes filter paths via escapeFilterPath", () => {
    expect(escapeFilterPath("/tmp/a/b.mp4")).toBe("/tmp/a/b.mp4");
    expect(escapeFilterPath("C:\\x\\y.mp4")).toBe("C\\:\\\\x\\\\y.mp4");
    expect(escapeFilterPath("a'b,c")).toBe("a\\'b\\,c");
  });
});

describe("buildKitJson", () => {
  it("serializes the render kit with report context and assets", () => {
    const kit = JSON.parse(
      buildKitJson({
        city: "Portland",
        state: "OR",
        reportedAt: "2024-11-05T14:30:00Z",
        assets: {
          video: "clips/42/clip.mp4",
          poster: "clips/42/poster.jpg",
        },
      }),
    );

    expect(kit.city).toBe("Portland");
    expect(kit.state).toBe("OR");
    expect(kit.reportedAt).toBe("2024-11-05T14:30:00Z");
    expect(kit.platforms).toEqual(["tiktok", "reels", "shorts"]);
    expect(kit.assets).toEqual({
      video: "clips/42/clip.mp4",
      poster: "clips/42/poster.jpg",
    });
    // Captions, hashtags, and short links are all gone from the kit.
    expect("caption" in kit).toBe(false);
    expect("hashtags" in kit).toBe(false);
    expect("shortUrlSlug" in kit).toBe(false);
  });
});

describe("buildRenderPlan (photo mode)", () => {
  it("renders a still as a 3s zoompan clip: supersampled, centered, 90 frames", () => {
    const plan = buildRenderPlan(renderInput({ sourceDuration: null }));

    expect(plan.renderedDurationSeconds).toBe(3);
    expect(plan.endCardStartSeconds).toBe(0);

    const args = plan.clipRenderArgs;
    expect(args).toContain("-vf");
    const filter = args[args.indexOf("-vf") + 1];
    // Supersample 2x before zoompan for smooth motion.
    expect(filter).toContain(
      "scale=2160:3840:force_original_aspect_ratio=increase",
    );
    expect(filter).toContain("crop=2160:3840");
    // Center zoom in over the 3s, capped at 1.12, 1080x1920 output at 30fps.
    expect(filter).toContain("zoompan=z='min(1+0.001333*on,1.12)'");
    expect(filter).toContain("x='iw/2-(iw/zoom/2)'");
    expect(filter).toContain("y='ih/2-(ih/zoom/2)'");
    expect(filter).toContain("d=90");
    expect(filter).toContain("s=1080x1920");
    expect(filter).toContain("fps=30");
    // Single still in, fixed frame count out.
    expect(args.filter((a) => a === "-i")).toHaveLength(1);
    expect(args).not.toContain("-loop");
    expect(args).toContain("90"); // -frames:v
    const framesIdx = args.indexOf("-frames:v");
    expect(args[framesIdx + 1]).toBe("90");
    // Silent: no audio codec args.
    expect(args).not.toContain("aac");
    expect(args).not.toContain("0:a?");
  });

  it("photo clips get no end-card, no text files, no audio", () => {
    const plan = buildRenderPlan(renderInput({ sourceDuration: null }));

    expect(plan.textFiles).toEqual([]);
    expect(plan.clipRenderArgs.join(" ")).not.toContain("endcard");
    expect(plan.clipRenderArgs.join(" ")).not.toContain("overlay");
    expect(plan.clipRenderArgs.join(" ")).not.toContain("-map");
  });

  it("extracts the poster from the photo itself at 9:16", () => {
    const plan = buildRenderPlan(renderInput({ sourceDuration: null }));

    const posterArgs = plan.posterExtractArgs;
    expect(posterArgs).toContain("-frames:v");
    expect(posterArgs.join(" ")).toContain("crop=1080:1920");
    expect(posterArgs[posterArgs.length - 1]).toBe("/tmp/render/poster.jpg");
  });

  it("kit.json for a photo carries video + poster assets only", () => {
    const plan = buildRenderPlan(renderInput({ sourceDuration: null }));
    const kit = JSON.parse(plan.kitJson);

    expect(kit.assets).toEqual({
      video: "clips/42/clip.mp4",
      poster: "clips/42/poster.jpg",
    });
  });
});
