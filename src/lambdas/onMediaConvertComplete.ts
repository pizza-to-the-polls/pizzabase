/**
 * Lambda: on-mediaconvert-complete
 *
 * Triggered by EventBridge when a MediaConvert job changes state.
 * Updates the DB record: media_status = 'ready' or 'failed',
 * sets processed_file_path with the MP4 output URL.
 */

import { initializeDataSource } from "../data-source";
import { Upload } from "../entity/Upload";

interface MediaConvertEvent {
  detail: {
    status: "COMPLETE" | "ERROR" | "CANCELED" | "PROGRESSING" | "STATUS_UPDATE";
    userMetadata?: {
      uploadId?: string;
    };
    outputGroupDetails?: {
      outputDetails: {
        outputFilePaths: string[];
      }[];
    }[];
  };
}

const PROCESSED_BUCKET =
  process.env.PROCESSED_UPLOADS_BUCKET ||
  process.env.UPLOAD_S3_BUCKET ||
  "pizzabase-processed-uploads";

export const handler = async (event: MediaConvertEvent) => {
  const { detail } = event;
  const { status, userMetadata, outputGroupDetails } = detail;

  const uploadId = userMetadata?.uploadId;
  if (!uploadId) {
    console.warn(
      "[on-mediaconvert-complete] No uploadId in userMetadata, skipping"
    );
    return;
  }

  await initializeDataSource();

  const upload = await Upload.findOne({
    where: { id: parseInt(uploadId, 10) } as any,
  });

  if (!upload) {
    console.warn(
      `[on-mediaconvert-complete] No Upload record found for id: ${uploadId}`
    );
    return;
  }

  if (status === "COMPLETE") {
    // Build processed_file_path from output details
    const outputs = outputGroupDetails?.[0]?.outputDetails || [];
    const mp4Path = outputs[0]?.outputFilePaths?.[0];

    if (mp4Path) {
      const mp4Url = mp4Path.startsWith("s3://")
        ? `https://${PROCESSED_BUCKET}.s3.amazonaws.com/${mp4Path.replace(
            `s3://${PROCESSED_BUCKET}/`,
            ""
          )}`
        : mp4Path;

      upload.processedFilePath = {
        mp4: mp4Url,
      };
    }

    upload.mediaStatus = "ready";

    console.log(
      `[on-mediaconvert-complete] Upload ${uploadId} transcoded: ${
        upload.processedFilePath?.mp4 || "unknown"
      }`
    );
  } else if (status === "ERROR" || status === "CANCELED") {
    upload.mediaStatus = "failed";

    console.warn(
      `[on-mediaconvert-complete] Upload ${uploadId} transcoding ${status}`
    );
  }

  await upload.save();
};
