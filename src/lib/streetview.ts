import { createHash } from "crypto";

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

import { Upload } from "../entity/Upload";
import { NormalAddress } from "./validator/types";

/**
 * Street View fallback for partner reports without a photo.
 *
 * Fetches a Google Street View Static API image for the normalized address
 * and registers it as a normal web upload — Upload row + raw-bucket put —
 * so the image flows through the standard media pipeline (EXIF scrub,
 * processing, moderation) exactly like a partner-uploaded photo. That keeps
 * one media story for Retool/socials: every report has media when possible.
 *
 * Returns the Upload, or null when Street View is unavailable (no API key,
 * no imagery for the address, network failure, upload rate limit). The
 * caller falls back to the plain trusted-report flow — never fail a report
 * because its placeholder image couldn't be fetched.
 */
export const createStreetViewUpload = async (
  address: NormalAddress,
  ipAddress: string,
): Promise<Upload | null> => {
  const key = process.env.GOOGLE_MAPS_KEY;
  if (!key) {
    console.log(
      JSON.stringify({ event: "streetview_skipped", reason: "no_api_key" }),
    );
    return null;
  }

  const params = new URLSearchParams({
    size: "640x480",
    location: address.fullAddress,
    source: "default",
    // 404 instead of the gray "no imagery" placeholder, so we can tell
    // "Street View doesn't cover this address" apart from a real image.
    "return-error-code": "true",
    key,
  });

  const resp = await fetch(
    `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`,
  );
  if (!resp.ok) {
    console.log(
      JSON.stringify({ event: "streetview_unavailable", status: resp.status }),
    );
    return null;
  }

  const bytes = Buffer.from(await resp.arrayBuffer());
  // Error bodies are tiny; real 640x480 JPEGs are not.
  if (bytes.length < 1024) {
    console.log(JSON.stringify({ event: "streetview_unavailable" }));
    return null;
  }

  try {
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    const [upload, exists] = await Upload.createOrReject(ipAddress, {
      fileExt: "jpg",
      normalizedAddress: address,
      fileHash,
    });

    if (!exists) {
      const s3 = new S3Client({
        region: process.env.AWS_REGION || "us-west-2",
      });
      await s3.send(
        new PutObjectCommand({
          Bucket: upload.rawBucket,
          Key: upload.rawFilePath,
          Body: bytes,
          ContentType: "image/jpeg",
        }),
      );
    }

    return upload;
  } catch (_e) {
    // Rate limit ("too many uploads") or S3 failure — report still goes out.
    console.log(JSON.stringify({ event: "streetview_upload_failed" }));
    return null;
  }
};
