import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const SIGHTENGINE_URL = "https://api.sightengine.com/1.0/check.json";

export interface SightEngineResult {
  score: number;
}

interface SightEngineApiResponse {
  type?: { ai_generated?: number; deepfake?: number };
}

/**
 * Check an image from S3 against SightEngine's AI-detection APIs.
 *
 * Generates a presigned S3 URL for the image and passes it to SightEngine
 * for remote analysis, avoiding the overhead of downloading and re-uploading.
 *
 * Returns a combined score (0–1) where higher values indicate more concern.
 *
 * Uses SightEngine's genai and deepfake detection models:
 *   https://sightengine.com/docs/ai-generated-image-detection
 *   https://sightengine.com/docs/deepfake-detection
 *
 * The score is the max of the two model probabilities:
 *   max(type.ai_generated, type.deepfake).
 *
 * @param bucket - S3 bucket name
 * @param key - S3 object key (file path)
 * @returns { score: number } — 0 (safe) to 1 (concerning)
 */
export async function checkImage(
  bucket: string,
  key: string,
): Promise<SightEngineResult> {
  const s3Client = new S3Client({
    region: process.env.AWS_REGION || "us-west-2",
  });

  // Generate a presigned URL so SightEngine can fetch the image directly
  const imageUrl = await getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
    { expiresIn: 300 }, // 5 minutes — enough for SightEngine to fetch
  );

  // Ask SightEngine to check the image at the presigned URL
  const params = new URLSearchParams({
    url: imageUrl,
    models: "genai,deepfake",
    api_user: process.env.SIGHTENGINE_API_USER!,
    api_secret: process.env.SIGHTENGINE_API_SECRET!,
  });

  const response = await fetch(`${SIGHTENGINE_URL}?${params}`);

  if (!response.ok) {
    throw new Error(
      `SightEngine API error: ${response.status} ${response.statusText}`,
    );
  }

  const data: SightEngineApiResponse = await response.json();

  // Compute combined score (0–1)
  // Both genai and deepfake return probabilities that the image is
  // AI-generated / deepfaked (higher = more concerning).
  // Take the max as the overall concern score.
  const genaiScore = data.type?.ai_generated ?? 0;
  const deepfakeScore = data.type?.deepfake ?? 0;
  const score = Math.max(genaiScore, deepfakeScore);

  return { score };
}
