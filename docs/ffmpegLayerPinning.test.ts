/**
 * BUG-034 regression guard: the ffmpeg Lambda layer used by the clip render
 * path must come from a build that actually ships the `drawtext` filter
 * (libfreetype) plus the DejaVuSans-Bold.ttf font the end-card drawtext
 * filters reference.
 *
 * ffmpeg:1 (johnvansickle 7.0.2 static) was compiled without libfreetype, so
 * every text-overlay render failed with `No such filter: 'drawtext'` /
 * `ffmpeg exited with code 8` — 33 of 189 prod clips were rejected.
 *
 * These tests are deliberately file-content based (no DB, no AWS, like
 * docs/mmsDocs.test.ts): they assert that
 *   1. serverless.yml pins renderClip + compileClips to a drawtext-capable
 *      ffmpeg layer version (>= 4) and never to the retired ffmpeg:1,
 *   2. on-media-format keeps its own ffmpeg:3 pin (BtbN lgpl, HEIF rotation)
 *      untouched,
 *   3. scripts/build-ffmpeg-layer.sh pins a freetype-enabled static build
 *      (BtbN linux64-gpl, not the johnvansickle static release) and fails
 *      the build if the staged binary lacks drawtext or the font is missing,
 *   4. docs/clip-render-infra.md documents the publish → deploy → smoke →
 *      requeue runbook so the layer swap can be completed by a human.
 *
 * The real "does the binary have drawtext" check lives at build time in
 * build-ffmpeg-layer.sh (CI must not download an 80MB ffmpeg build just to
 * run the unit suite); these tests pin the config that routes clips to a
 * known-good layer.
 */

import { readFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");

const serverlessLines = readFileSync(
  path.join(ROOT, "serverless.yml"),
  "utf8",
).split("\n");
const buildScript = readFileSync(
  path.join(ROOT, "scripts", "build-ffmpeg-layer.sh"),
  "utf8",
);
const infraDoc = readFileSync(
  path.join(ROOT, "docs", "clip-render-infra.md"),
  "utf8",
);

/**
 * Extract a top-level `functions:` entry from serverless.yml: everything
 * from the `  <name>:` line (exactly two-space indent) up to the next
 * two-space-indented key. Nested keys are indented four+ spaces, so they
 * stay inside the block.
 */
function functionBlock(name: string): string {
  const start = serverlessLines.findIndex((line) => line === `  ${name}:`);
  if (start === -1) {
    throw new Error(`serverless.yml has no function named "${name}"`);
  }
  const lines: string[] = [];
  for (let i = start + 1; i < serverlessLines.length; i++) {
    if (/^ {2}\S/.test(serverlessLines[i])) break;
    lines.push(serverlessLines[i]);
  }
  return lines.join("\n");
}

/** The `layer:ffmpeg:<version>` versions referenced by a function block. */
function ffmpegLayerVersions(name: string): number[] {
  const block = functionBlock(name);
  const versions: number[] = [];
  const re = /layer:ffmpeg:(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(block)) !== null) {
    versions.push(Number(match[1]));
  }
  return versions;
}

describe("ffmpeg layer pinning (BUG-034)", () => {
  describe("serverless.yml function → layer wiring", () => {
    it("renderClip pins a drawtext-capable ffmpeg layer (not :1)", () => {
      const versions = ffmpegLayerVersions("renderClip");
      expect(versions.length).toBeGreaterThan(0);
      expect(versions).not.toContain(1);
      expect(Math.min(...versions)).toBeGreaterThanOrEqual(4);
    });

    it("compileClips pins a drawtext-capable ffmpeg layer (not :1)", () => {
      const versions = ffmpegLayerVersions("compileClips");
      expect(versions.length).toBeGreaterThan(0);
      expect(versions).not.toContain(1);
      expect(Math.min(...versions)).toBeGreaterThanOrEqual(4);
    });

    it("renderClip and compileClips share one ffmpeg layer version", () => {
      // The compile lambda concatenates the same rendered MP4s, so it needs
      // the same drawtext-capable binary. A version skew here means renders
      // and compilations disagree about what the pixels look like.
      expect(ffmpegLayerVersions("renderClip")).toEqual(
        ffmpegLayerVersions("compileClips"),
      );
    });

    it("on-media-format keeps its ffmpeg:3 pin untouched", () => {
      // ffmpeg:3 must NOT be touched: it serves HEIF rotation/grid assembly
      // and is verified by the CI HEIC decode regression step.
      expect(ffmpegLayerVersions("on-media-format")).toEqual([3]);
    });

    it("renderClip runs the layer binary and passes no font env", () => {
      // The render is overlay-free (user media only) — no drawtext, so no
      // font env. Only the ffmpeg binary path is wired through.
      const block = functionBlock("renderClip");
      expect(block).toContain("FFMPEG_PATH: /opt/bin/ffmpeg");
      expect(block).not.toContain("RENDER_FONT_FILE");
    });
  });

  describe("scripts/build-ffmpeg-layer.sh", () => {
    it("pins a freetype-enabled build, not johnvansickle", () => {
      const urlMatch = buildScript.match(/^FFMPEG_URL="([^"]+)"/m);
      expect(urlMatch).not.toBeNull();
      const url = urlMatch![1];
      // BtbN's linux64-gpl variants are configured --enable-libfreetype
      // (drawtext) and --enable-libx264 (the clip encoder).
      expect(url).toMatch(/BtbN\/FFmpeg-Builds/);
      expect(url).toMatch(/linux64-gpl/);
      expect(url).not.toMatch(/johnvansickle/);
    });

    it("fails the build when drawtext is absent from the binary", () => {
      // The assertion runs against the *staged* binary and exits non-zero,
      // so a drawtext-less layer can never be zipped or published again.
      expect(buildScript).toMatch(
        /stage\/bin\/ffmpeg" -hide_banner -filters[\s\S]{0,120}grep -q drawtext/,
      );
      expect(buildScript).toMatch(
        /lacks the 'drawtext' filter[\s\S]{0,400}exit 1/,
      );
    });

    it("fails the build when the layer font is missing", () => {
      expect(buildScript).toContain(
        'test -f "$WORKDIR/stage/fonts/DejaVuSans-Bold.ttf"',
      );
      expect(buildScript).toMatch(
        /Asserting DejaVuSans-Bold\.ttf font[\s\S]{0,400}exit 1/,
      );
    });

    it("stages the binary under bin/ and the font under fonts/", () => {
      // The lambda reads FFMPEG_PATH=/opt/bin/ffmpeg; the font ships in
      // the layer for any future drawtext use — the zip layout must keep
      // that contract.
      const stageLayout =
        'mkdir -p "$WORKDIR/stage/bin" "$WORKDIR/stage/fonts"';
      expect(buildScript).toContain(stageLayout);
      expect(buildScript).toMatch(/zip .*bin fonts/);
    });
  });

  describe("docs/clip-render-infra.md runbook", () => {
    it("documents the publish → deploy → smoke → requeue flow", () => {
      // Publishing needs creds the agent does not have — the runbook is the
      // handoff to a human/CI. It must cover every step of that handoff.
      expect(infraDoc).toMatch(/publish-layer-version/);
      expect(infraDoc).toMatch(/serverless deploy --stage prod/);
      expect(infraDoc).toMatch(/renderClipSmoke\.ts sample\.mp4/);
      expect(infraDoc).toMatch(/BEGIN;/);
      expect(infraDoc).toMatch(/UPDATE clips\s*\n\s*SET status = 'queued'/);
      expect(infraDoc).toMatch(/COMMIT;/);
    });

    it("records why ffmpeg:1 was retired (evidence instructions)", () => {
      expect(infraDoc).toMatch(/johnvansickle 7\.0\.2/);
      expect(infraDoc).toMatch(/-filters \| grep drawtext/);
      expect(infraDoc).toMatch(/no output — filter absent/);
    });
  });
});
