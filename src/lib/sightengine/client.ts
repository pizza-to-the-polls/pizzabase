import { S3 } from "aws-sdk";

const SIGHTENGINE_URL = "https://api.sightengine.com/1.0/check.json";

export interface SightEngineResult {
  score: number;
}

interface SightEngineApiResponse {
  nudity?: { none?: number };
  weapon?: { none?: number };
  alcohol?: { none?: number };
  type?: { ai_generated?: number };
}

/**
 * Check an image from S3 against SightEngine's moderation API.
 *
 * Generates a presigned S3 URL for the image and passes it to SightEngine
 * for remote analysis, avoiding the overhead of downloading and re-uploading.
 *
 * Returns a combined score (0–1) where higher values indicate more concern.
 *
 * The score is computed from the "safe" probabilities of nudity, weapon, and
 * alcohol models combined with the genai detection probability:
 * max(1 - min(nudity.none, weapon.none, alcohol.none), type.ai_generated).
 *
 * @param bucket - S3 bucket name
 * @param key - S3 object key (file path)
 * @returns { score: number } — 0 (safe) to 1 (concerning)
 */
export async function checkImage(
  bucket: string,
  key: string
): Promise<SightEngineResult> {
  const s3 = new S3({ region: process.env.AWS_REGION || "us-west-2" });

  // Generate a presigned URL so SightEngine can fetch the image directly
  const imageUrl = await s3.getSignedUrlPromise("getObject", {
    Bucket: bucket,
    Key: key,
    Expires: 300, // 5 minutes — enough for SightEngine to fetch
  });

  // Ask SightEngine to check the image at the presigned URL
  const params = new URLSearchParams({
    url: imageUrl,
    models: "nudity-2.0,weapon,alcohol,genai",
    api_user: process.env.SIGHTENGINE_API_USER!,
    api_secret: process.env.SIGHTENGINE_API_SECRET!,
  });

  const response = await fetch(`${SIGHTENGINE_URL}?${params}`);

  if (!response.ok) {
    throw new Error(
      `SightEngine API error: ${response.status} ${response.statusText}`
    );
  }

  const data: SightEngineApiResponse = await response.json();

  // Compute combined score (0–1)
  // SightEngine returns "none" = probability the content is safe.
  // Invert: lower safe score → higher concern score.
  const nudity = data.nudity?.none ?? 0;
  const weapons = data.weapon?.none ?? 0;
  const alcohol = data.alcohol?.none ?? 0;
  const moderationScore = 1 - Math.min(nudity, weapons, alcohol);

  // genai returns type.ai_generated = probability the image is AI-generated
  // (higher = more concerning), so take the max of both scores.
  const genaiScore = data.type?.ai_generated ?? 0;
  const score = Math.max(moderationScore, genaiScore);

  return { score };
}
