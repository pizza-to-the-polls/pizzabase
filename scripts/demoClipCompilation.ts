/**
 * One-off demo: build a REAL clip compilation from past uploads and post it
 * through ZAP_NEW_CLIP so the channel can see exactly what the feature
 * produces.
 *
 * Everything is real except the DB rows (there are none — this writes no
 * database):
 *   - downloads real processed media from the uploads bucket
 *   - renders real clips with local ffmpeg (videos + photo zoompan)
 *   - concats a real reel (same normalize/concat contract as compileClips)
 *   - uploads the reel + poster under clips/demo-<date>/
 *   - builds the exact ZAP_NEW_CLIP payload buildClipKitPayload produces
 *   - POSTs it to the hook
 *
 * Usage:
 *   npx ts-node scripts/demoClipCompilation.ts [--photos 4] [--videos 1] [--dry-run]
 *
 * Requires: a live AWS session with read/write on the processed bucket,
 * local ffmpeg. ZAP_NEW_CLIP env overrides the default hook URL.
 * --dry-run renders and prints the payload without uploading or posting.
 */

import "reflect-metadata";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { buildRenderPlan } from "../src/lib/clipTemplate";
import { detectVideoDuration } from "../src/lib/mp4-rotation";
import { runFfmpeg } from "../src/lib/ffmpeg-exec";
import { normalizeArgs, concatList } from "../src/lambdas/compileClips";
import { buildClipKitPayload } from "../src/lib/clipKit";
import { Clip } from "../src/entity/Clip";

const BUCKET = process.env.UPLOAD_S3_BUCKET || "reports.polls.pizza";
const CDN = process.env.MEDIA_CDN_DOMAIN || "media.polls.pizza";
// Required: the hook URL is a secret — set ZAP_NEW_CLIP in the
// environment; the script refuses to run without it.
const ZAP_URL = process.env.ZAP_NEW_CLIP || null;
const FFMPEG_BIN = process.env.FFMPEG_PATH || "ffmpeg";
const FONT_FILE =
  process.env.RENDER_FONT_FILE ||
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf";

const s3 = new S3Client({ region: process.env.AWS_REGION || "us-west-2" });

interface Member {
  key: string;
  ext: string;
  bytes: Buffer;
  duration: number | null; // null = photo (3s zoom clip)
}

async function listUploadKeys(): Promise<{ key: string; at: number }[]> {
  const stamped: { key: string; at: number }[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: "uploads/",
        MaxKeys: 1000,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents || []) {
      if (obj.Key) {
        stamped.push({ key: obj.Key, at: obj.LastModified?.getTime() ?? 0 });
      }
    }
    token = res.NextContinuationToken;
  } while (token);
  // Most recent first.
  return stamped.sort((a, b) => b.at - a.at);
}

async function getObject(key: string): Promise<Buffer> {
  const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return Buffer.from(await obj.Body!.transformToByteArray());
}

async function putObject(key: string, body: Buffer, type: string) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: type,
    }),
  );
  console.log(`[demo] uploaded s3://${BUCKET}/${key}`);
}

async function pickSources(
  photos: number,
  videos: number,
  since: Date | null,
  until: Date | null,
  exclude: string | null,
  explicitKeys: string[],
): Promise<Member[]> {
  if (explicitKeys.length) {
    const picked: Member[] = [];
    for (const key of explicitKeys) {
      const bytes = await getObject(key);
      const ext = path.extname(key);
      let duration: number | null = null;
      if (ext === ".mp4") {
        duration = detectVideoDuration(bytes);
        if (duration == null || duration > 90) {
          throw new Error(`Explicit key ${key} unusable (duration) `);
        }
      }
      console.log(
        `[demo] using ${key}${duration ? ` (${duration.toFixed(1)}s)` : " (photo)"}`,
      );
      picked.push({ key, ext, bytes, duration });
    }
    return picked;
  }

  let keys = await listUploadKeys();
  if (exclude) {
    keys = keys.filter(({ key }) => !key.includes(exclude));
  }
  if (since || until) {
    keys = keys.filter(
      ({ at }) =>
        (!since || at >= since.getTime()) && (!until || at < until.getTime()),
    );
    // Date-ranged picks read chronologically (earliest first) so the reel
    // tells a story — e.g. Election Day morning through night.
    keys = [...keys].sort((a, b) => a.at - b.at);
  }
  // Without a range: processed media only (.webp). With a range into
  // legacy uploads, accept original jpg/jpeg too — the originals are what
  // exists for those dates.
  const photoExt = since || until ? /\.(webp|jpe?g)$/ : /\.webp$/;
  const allPhotos = keys.filter(({ key }) => photoExt.test(key));
  const photoKeys =
    allPhotos.length <= photos
      ? allPhotos
      : // Evenly spaced picks across the window — morning-to-night spread
        // instead of the first N (which would all be one morning).
        Array.from(
          { length: photos },
          (_, i) =>
            allPhotos[Math.round((i * (allPhotos.length - 1)) / (photos - 1))],
        ).filter(
          (k, idx, arr) => arr.findIndex((x) => x.key === k.key) === idx,
        );
  const videoKeys = keys
    .filter(({ key }) => /-transcoded\.mp4$/.test(key))
    .slice(0, videos + 2); // spares in case one exceeds the 90s cap
  const members: Member[] = [];

  for (const { key } of [...photoKeys, ...videoKeys]) {
    const bytes = await getObject(key);
    const ext = path.extname(key);
    let duration: number | null = null;
    if (ext === ".mp4") {
      duration = detectVideoDuration(bytes);
      if (duration == null || duration > 90) {
        console.log(`[demo] skipping ${key} (duration ${duration ?? "?"}s)`);
        continue;
      }
      if (members.filter((m) => m.ext === ".mp4").length >= videos) continue;
    }
    console.log(
      `[demo] using ${key}${duration ? ` (${duration.toFixed(1)}s)` : " (photo)"}`,
    );
    members.push({ key, ext, bytes, duration });
  }
  return members;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string, fallback: number): number => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? parseInt(args[i + 1], 10) || fallback : fallback;
  };
  const photoCount = flag("photos", 4);
  const videoCount = flag("videos", 1);
  const dryRun = args.includes("--dry-run");
  const dateArg = (name: string): Date | null => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? new Date(`${args[i + 1]}T00:00:00Z`) : null;
  };
  const since = dateArg("since");
  const until = dateArg("until");

  process.env.MEDIA_CDN_DOMAIN = CDN;

  const exclude = args.includes("--exclude")
    ? args[args.indexOf("--exclude") + 1]
    : null;
  const explicitKeys = args.includes("--keys")
    ? args[args.indexOf("--keys") + 1].split(",").filter(Boolean)
    : [];
  // Optional rich photo entries (address, pizzas, restaurant) keyed by
  // S3 key — e.g. pulled from the prod DB for a date-window demo.
  const photosJson = args.includes("--photos-json")
    ? JSON.parse(
        await fs.readFile(args[args.indexOf("--photos-json") + 1], "utf8"),
      )
    : null;

  const members = await pickSources(
    photoCount,
    videoCount,
    since,
    until,
    exclude,
    explicitKeys,
  );
  if (members.length < 2) {
    throw new Error("Need at least 2 sources for a demo compilation");
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-demo-"));
  try {
    // ── Render each member with the real template ──
    const memberFiles: string[] = [];
    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      const inputPath = path.join(workDir, `source-${i}${member.ext}`);
      await fs.writeFile(inputPath, member.bytes);
      const plan = buildRenderPlan({
        city: "Pizza to the Polls",
        state: "",
        reportedAt: new Date().toISOString(),
        sourceDuration: member.duration,
        inputPath,
        outputDir: workDir,
        assetPrefix: "clips/demo",
        fontFile: FONT_FILE,
      });
      await runFfmpeg(FFMPEG_BIN, plan.clipRenderArgs);
      // buildRenderPlan always writes ${outputDir}/clip.mp4 — rename per
      // member so the next render doesn't clobber it.
      const memberFile = path.join(workDir, `clip-${i}.mp4`);
      await fs.rename(path.join(workDir, "clip.mp4"), memberFile);
      memberFiles.push(memberFile);
      console.log(`[demo] rendered member ${i} (${member.key})`);
    }

    // ── Compile: normalize + concat (compileClips' own contract) ──
    const normalized: string[] = [];
    for (let i = 0; i < memberFiles.length; i++) {
      const norm = path.join(workDir, `norm-${i}.mp4`);
      await runFfmpeg(FFMPEG_BIN, normalizeArgs(memberFiles[i], norm));
      normalized.push(norm);
    }
    const listPath = path.join(workDir, "members.txt");
    await fs.writeFile(listPath, concatList(normalized), "utf8");
    const reelPath = path.join(workDir, "reel.mp4");
    await runFfmpeg(FFMPEG_BIN, [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      reelPath,
    ]);
    const posterPath = path.join(workDir, "poster.jpg");
    await runFfmpeg(FFMPEG_BIN, [
      "-y",
      "-i",
      reelPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      posterPath,
    ]);
    const reelBytes = await fs.readFile(reelPath);
    const posterBytes = await fs.readFile(posterPath);
    console.log(
      `[demo] reel rendered: ${members.length} members, ` +
        `${(reelBytes.length / 1e6).toFixed(1)}MB`,
    );

    // ── The compilation clip the payload is built from ──
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const prefix = `clips/demo-${today}`;
    const clip = new Clip();
    clip.id = 424242;
    clip.status = "approved";
    clip.upload = null;
    clip.approvedBy = "demo-compilation";
    clip.approvedAt = new Date();
    clip.createdAt = new Date();
    clip.updatedAt = new Date();
    clip.kit = {
      isCompilation: true,
      memberClipIds: members.map((_, i) => 424200 + i),
      // Demo note: in prod these are base.polls.pizza permalinks built from
      // upload.filePath; without DB rows we link the processed media on the
      // CDN directly — same files, really clickable.
      photoLinks: members.map((m) => `https://${CDN}/${m.key}`),
      // Rich entries (address, pizzas, restaurant) from --photos-json when
      // provided; falls back to plain CDN links.
      photos: members.map(
        (m) =>
          (photosJson && photosJson[m.key]) || {
            url: `https://${CDN}/${m.key}`,
            address: null,
            city: null,
            state: null,
            pizzas: null,
            restaurant: null,
          },
      ),
    };
    clip.outputPaths = {
      video: `${prefix}/clip.mp4`,
      poster: `${prefix}/poster.jpg`,
    };

    const payload = {
      hook: "ZAP_NEW_CLIP",
      clip: buildClipKitPayload(clip),
    };
    console.log("[demo] payload:\n" + JSON.stringify(payload, null, 2));

    if (dryRun) {
      console.log("[demo] dry-run — not uploading or posting");
      return;
    }

    await putObject(`${prefix}/clip.mp4`, reelBytes, "video/mp4");
    await putObject(`${prefix}/poster.jpg`, posterBytes, "image/jpeg");

    if (!ZAP_URL) {
      throw new Error("ZAP_NEW_CLIP (hook URL) must be set in the environment");
    }
    const response = await fetch(ZAP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    console.log(
      `[demo] posted to ZAP_NEW_CLIP: ${response.status} ${response.statusText}`,
    );
    if (!response.ok) throw new Error(`Zapier responded ${response.status}`);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error("[demo] failed:", err);
  process.exit(1);
});
