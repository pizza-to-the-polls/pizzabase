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
  ClipRenderInput,
  MAX_SOURCE_DURATION_SECONDS,
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
        "-movflags",
        "+faststart",
      ]),
    );
    const tIndex = args.indexOf("-t");
    expect(args[tIndex + 1]).toBe("45");
    expect(TARGET_WIDTH).toBe(1080);
    expect(TARGET_HEIGHT).toBe(1920);
  });

  it("caps the render at 90s", () => {
    const plan = buildRenderPlan(
      renderInput({ sourceDuration: MAX_SOURCE_DURATION_SECONDS + 60 }),
    );

    expect(plan.renderedDurationSeconds).toBe(90);
    const tIndex = plan.clipRenderArgs.indexOf("-t");
    expect(plan.clipRenderArgs[tIndex + 1]).toBe("90");
  });

  it("does not extend short sources", () => {
    const plan = buildRenderPlan(renderInput({ sourceDuration: 1 }));

    const tIndex = plan.clipRenderArgs.indexOf("-t");
    expect(plan.clipRenderArgs[tIndex + 1]).toBe("1");
  });

  it("center-crops to 9:16 with a plain -vf chain", () => {
    const plan = buildRenderPlan(renderInput({ sourceDuration: 45 }));
    const vfIndex = plan.clipRenderArgs.indexOf("-vf");
    const vf = plan.clipRenderArgs[vfIndex + 1];

    expect(vf).toBe(
      "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1",
    );
    expect(plan.clipRenderArgs).not.toContain("-filter_complex");
  });

  it("renders only user-submitted media: no overlays, no branding", () => {
    const plan = buildRenderPlan(renderInput());

    const joined = plan.clipRenderArgs.join(" ");
    // Nothing is composited onto the user's media.
    expect(joined).not.toContain("drawtext");
    expect(joined).not.toContain("overlay");
    expect(joined).not.toContain("endcard");
    expect(joined).not.toContain("caption");
    expect(joined).not.toContain("lowerthird");
    expect(joined).not.toContain("lavfi");
    // Exactly one ffmpeg input: the user's source media.
    expect(plan.clipRenderArgs.filter((a) => a === "-i")).toHaveLength(1);
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

  it("photo clips render the still only: no overlays, no audio", () => {
    const plan = buildRenderPlan(renderInput({ sourceDuration: null }));

    expect(plan.clipRenderArgs.join(" ")).not.toContain("overlay");
    expect(plan.clipRenderArgs.join(" ")).not.toContain("drawtext");
    expect(plan.clipRenderArgs.join(" ")).not.toContain("-map");
    // Silent: no audio codec args.
    expect(plan.clipRenderArgs).not.toContain("aac");
    expect(plan.clipRenderArgs).not.toContain("0:a?");
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
