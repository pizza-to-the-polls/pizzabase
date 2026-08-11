/**
 * Lambda: on-mediaconvert-complete
 *
 * Triggered by EventBridge when an AWS MediaConvert job completes or errors.
 *
 * Reads job output from S3, then calls the pizzabase callback to update
 * the upload record's media_status.
 */

import { S3 } from "aws-sdk";
import { Pool } from "pg";
import * as path from "path";

const s3 = new S3({ region: process.env.AWS_REGION || "us-west-2" });

const PROCESSED_BUCKET =
  process.env.PROCESSED_UPLOADS_BUCKET || "processed-uploads";
const PIZZABASE_API_URL =
  process.env.PIZZABASE_API_URL || "https://base.polls.pizza";

interface MediaConvertEvent {
  version: string;
  id: string;
  "detail-type": string;
  source: string;
  account: string;
  time: string;
  region: string;
  resources: string[];
  detail: {
    status: string;
    jobId: string;
    outputGroupDetails?: {
      type: string;
      outputDetails: {
        outputFilePaths: string[];
      }[];
    }[];
  };
}

function getDbPool(): Pool {
  return new Pool({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME || "pizzabase",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  });
}

async function callPizzabaseCallback(
  uploadId: number,
  processedPath: Record<string, string> | null,
  status: "ready" | "failed"
): Promise<void> {
  const body = JSON.stringify({
    id: uploadId,
    processed_file_path: processedPath,
    status,
  });

  const callbackUrl = `${PIZZABASE_API_URL}/uploads/media-format-callback`;

  try {
    const resp = await fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!resp.ok) {
      console.error(
        `Callback failed for upload ${uploadId}: HTTP ${resp.status}`
      );
    }
  } catch (err) {
    console.error(`Callback error:`, err);
  }
}

export async function handler(event: MediaConvertEvent): Promise<void> {
  const { detail } = event;

  console.log(
    `MediaConvert job ${detail.jobId} status: ${detail.status}`
  );

  if (detail.status !== "COMPLETE") {
    if (detail.status === "ERROR") {
      console.error(
        `MediaConvert job ${detail.jobId} failed. Full event:`,
        JSON.stringify(event, null, 2)
      );
    }
    return;
  }

  // Extract output file paths from the completed job.
  const outputPaths: string[] = [];
  if (detail.outputGroupDetails) {
    for (const group of detail.outputGroupDetails) {
      if (group.type === "FILE_GROUP_SETTINGS") {
        for (const output of group.outputDetails) {
          for (const filePath of output.outputFilePaths) {
            outputPaths.push(filePath);
          }
        }
      }
    }
  }

  console.log(`Output files:`, outputPaths);

  // Try to find the upload by the job ID stored in processed_file_path.
  const pool = getDbPool();
  try {
    // The job ID is stored in processed_file_path.jobId during the initial
    // MediaConvert kick-off.
    const result = await pool.query(
      `SELECT "id" FROM "uploads"
       WHERE "processed_file_path"->>'jobId' = $1
       LIMIT 1`,
      [detail.jobId]
    );

    if (result.rowCount === 0) {
      console.log(
        `No upload found for MediaConvert job ${detail.jobId}`
      );
      return;
    }

    const uploadId = result.rows[0].id as number;

    // Build processed_file_path from output paths.
    const processedPath: Record<string, string> = {};
    for (const outputPath of outputPaths) {
      const key = outputPath.replace(`s3://${PROCESSED_BUCKET}/`, "");
      const ext = path.extname(key).toLowerCase().replace(".", "");
      if (ext === "mp4" || ext === "mov") {
        processedPath[ext] = outputPath;
      }
    }

    // If no output paths found, try to find the file in processed bucket.
    if (Object.keys(processedPath).length === 0) {
      // Try to find by key pattern: scrub key → processed key.
      const uploadResult = await pool.query(
        `SELECT "raw_file_path" FROM "uploads" WHERE "id" = $1`,
        [uploadId]
      );
      if (uploadResult.rowCount > 0) {
        const rawPath = uploadResult.rows[0].raw_file_path as string;
        const ext = path.extname(rawPath);
        const baseName = path.basename(rawPath, ext);
        const dirName = path.dirname(rawPath);
        const expectedKey = `${dirName}/${baseName}.mp4`;

        try {
          await s3
            .headObject({
              Bucket: PROCESSED_BUCKET,
              Key: expectedKey,
            })
            .promise();
          processedPath.mp4 = `s3://${PROCESSED_BUCKET}/${expectedKey}`;
        } catch {
          // File not found.
        }
      }
    }

    if (Object.keys(processedPath).length > 0) {
      console.log(
        `Updating upload ${uploadId} with processed paths:`,
        processedPath
      );
      await callPizzabaseCallback(uploadId, processedPath, "ready");
    } else {
      console.error(
        `No output files found for job ${detail.jobId}`
      );
    }
  } catch (err) {
    console.error(`Error processing MediaConvert completion:`, err);
  } finally {
    await pool.end();
  }
}