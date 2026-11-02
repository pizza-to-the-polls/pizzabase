/**
 * Config regression tests for the ffmpeg Lambda layer wiring (BUG-034).
 *
 * ffmpeg:1 (johnvansickle 7.0.2-static) was compiled without libfreetype, so
 * its binary exposes no `drawtext` filter and every renderClip render that
 * composites the end-card failed with "No such filter: 'drawtext'" (exit
 * code 8) — 33 of 189 prod clips rejected. The fix is infra-level: a BtbN
 * linux64-gpl layer (ffmpeg:4, drawtext + libx264) and a build script that
 * refuses to stage a drawtext-less layer.
 *
 * These tests can't run ffmpeg, so they pin the two contracts that prevent
 * the bug from ever shipping again:
 *   1. serverless.yml: renderClip + compileClips point at the new layer
 *      version; on-media-format stays on ffmpeg:3 (HEIF rotation, untouched);
 *      nothing references the broken ffmpeg:1 anymore.
 *   2. scripts/build-ffmpeg-layer.sh: pins a build that ships freetype and
 *      asserts drawtext + font presence before the layer zip is produced.
 *
 * The YAML is scanned line-wise (function blocks start at exactly two-space
 * indent) to avoid pulling a YAML parser dependency into the test suite.
 */
import * as fs from "fs";
import * as path from "path";

const repoRoot = path.resolve(__dirname, "..", "..", "..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

/** Extract a top-level function block (two-space indented key) from serverless.yml. */
function functionBlock(yaml: string, fnName: string): string {
  const lines = yaml.split("\n");
  const start = lines.findIndex((l) => l === `  ${fnName}:`);
  expect(start).toBeGreaterThanOrEqual(0);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    // Next two-space-indented `key:` line starts the following function.
    if (/^ {2}[a-zA-Z][\w-]*:$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function layerVersions(block: string): number[] {
  const matches = block.match(/layer:ffmpeg:(\d+)/g) ?? [];
  return matches.map((m) => Number(m.split(":").pop()));
}

describe("serverless.yml ffmpeg layer wiring (BUG-034)", () => {
  const yaml = readRepoFile("serverless.yml");

  it("pins renderClip to the drawtext-capable ffmpeg:4 layer", () => {
    const versions = layerVersions(functionBlock(yaml, "renderClip"));
    expect(versions).toContain(4);
    expect(versions).not.toContain(1);
  });

  it("pins compileClips to the same drawtext-capable layer", () => {
    const versions = layerVersions(functionBlock(yaml, "compileClips"));
    expect(versions).toContain(4);
    expect(versions).not.toContain(1);
  });

  it("leaves on-media-format on ffmpeg:3 (HEIF rotation) untouched", () => {
    const versions = layerVersions(functionBlock(yaml, "on-media-format"));
    expect(versions).toEqual([3]);
  });

  it("no function references the broken ffmpeg:1 anymore", () => {
    expect(yaml).not.toContain("layer:ffmpeg:1");
  });
});

describe("scripts/build-ffmpeg-layer.sh drawtext guard (BUG-034)", () => {
  const script = readRepoFile("scripts/build-ffmpeg-layer.sh");

  it("pins a BtbN linux64-gpl static build (drawtext + libx264), not johnvansickle", () => {
    const url = script.match(/^FFMPEG_URL="([^"]+)"$/m)?.[1];
    expect(url).toBeDefined();
    expect(url).toMatch(/^https:\/\/github\.com\/BtbN\/FFmpeg-Builds\//);
    expect(url).toMatch(/linux64-gpl/);
    expect(url).not.toMatch(/johnvansickle/);
  });

  it("fails the build when the staged binary lacks the drawtext filter", () => {
    // The assertion pipes the staged binary's filter list into grep -q
    // drawtext and exits non-zero when the filter is absent.
    expect(script).toMatch(
      /stage\/bin\/ffmpeg"\s+-hide_banner -filters[^\n]*\n\s*\| grep -q drawtext/m,
    );
    expect(script).toMatch(
      /FATAL: staged ffmpeg binary lacks the 'drawtext' filter/,
    );
  });

  it("fails the build when DejaVuSans-Bold.ttf is missing from the stage", () => {
    expect(script).toMatch(
      /test -f "\$WORKDIR\/stage\/fonts\/DejaVuSans-Bold.ttf" \|\| \{/,
    );
  });
});
