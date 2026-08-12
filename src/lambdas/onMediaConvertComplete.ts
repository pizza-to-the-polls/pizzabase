/**
 * Lambda: on-mediaconvert-complete
 *
 * Triggered by EventBridge when a MediaConvert job changes state
 * (COMPLETE or ERROR).
 *
 * Finds the Upload by job ID (stored in processed_file_path.jobId by
 * on-media-format), builds the MP4 output URL, and updates:
 *   media_status = 'ready' | 'failed'
 *   processed_file_path = { mp4: "https://..." }
 */

import { initializeDataSource } from "../data-source";
import { Upload } from "../entity/Upload";

const PROCESSED_BUCKET =
  process.env.UPLOAD_S3_BUCKET || "reports.polls.pizza";

interface MediaConvertDetail {
  status: "COMPLETE" | "ERROR" | "CANCELED";
  jobId: string;
  outputGroupDetails?: Array<{
    outputDetails: Array<{
      outputFilePaths: string[];
    }>;
  }>;
}

interface EventBridgeEvent {
  detail: MediaConvertDetail;
}

export async function handler(event: EventBridgeEvent): Promise<void> {
  const { status, jobId, outputGroupDetails } = event.detail;

  console.log(
    `[on-mediaconvert-complete] Job ${jobId} status: ${status}`
  );

  if (status !== "COMPLETE" && status !== "ERROR") {
    return; // Only handle terminal states
  }

  await initializeDataSource();

  // Find upload by job ID stored in processed_file_path
  const uploads = await Upload.find();
  const upload = uploads.find(
    (u) =>
      u.processedFilePath &&
      (u.processedFilePath as Record<string, string>).jobId === jobId
  );

  if (!upload) {
    console.warn(
      `[on-mediaconvert-complete] No upload found for job ${jobId}`
    );
    return;
  }

  if (status === "COMPLETE") {
    // Build MP4 URL from output paths
    const outputs = outputGroupDetails?.[0]?.outputDetails || [];
    const mp4Path = outputs[0]?.outputFilePaths?.[0];

    if (mp4Path) {
      // MediaConvert outputs full S3 paths like s3://bucket/key_transcoded.mp4
      const key = mp4Path.replace(`s3://${PROCESSED_BUCKET}/`, "");
      const mp4Url = `https://${PROCESSED_BUCKET}.s3.amazonaws.com/${key}`;
      upload.processedFilePath = { mp4: mp4Url };
      // file_path → primary processed output (mp4 for videos)
      upload.filePath = key;
      console.log(
        `[on-mediaconvert-complete] Upload ${upload.id} ready: ${mp4Url}`
      );
    } else {
      console.warn(
        `[on-mediaconvert-complete] No output paths for job ${jobId}`
      );
    }

    upload.mediaStatus = "ready";
  } else {
    upload.mediaStatus = "failed";
    console.warn(
      `[on-mediaconvert-complete] Upload ${upload.id} transcoding failed`
    );
  }

  await upload.save();
}
