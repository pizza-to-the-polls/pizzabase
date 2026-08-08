import * as aws from "aws-sdk";
import { Upload } from "../entity/Upload";
import { UPLOAD_CONTENT_TYPES } from "./validator";
import { UPLOAD_MAX_SIZE } from "../entity/constants";

const s3 = new aws.S3({ region: "us-west-2" });

// Multi-bucket pipeline:
//   raw-uploads     → permanent, private (original file never modified)
//   scrubbed-uploads → private, interim (EXIF stripped, short lifecycle)
//   processed-uploads → public-read (formatted + scrubbed media for volunteers)
export const RAW_BUCKET =
  process.env.RAW_UPLOADS_BUCKET || process.env.UPLOAD_S3_BUCKET!;
export const SCRUBBED_BUCKET =
  process.env.SCRUBBED_UPLOADS_BUCKET || RAW_BUCKET; // fallback to same bucket if not configured
export const PROCESSED_BUCKET =
  process.env.PROCESSED_UPLOADS_BUCKET || RAW_BUCKET;

interface Presigned {
  presigned: {
    url: string;
    fields: { [key: string]: string };
  };
  id: number;
  filePath: string;
  isDuplicate: boolean;
}

// Build the Content-Type whitelist for post conditions.
// Allow all image/* and video/* types we support via the upload content
// types registry.  For the presigned POST we use starts-with whitelisting.
const ALLOWED_CONTENT_TYPE_PREFIXES = ["image/", "video/"];

export const presignUpload = async (upload: Upload): Promise<Presigned> => {
  const { filePath, id } = upload;
  const [fileExt] = filePath.split(".").reverse();

  const s3Params = {
    Bucket: RAW_BUCKET,
    Expires: 60,
    Fields: {
      key: filePath,
    },
    Conditions: [
      ["content-length-range", 0, UPLOAD_MAX_SIZE],
      ...ALLOWED_CONTENT_TYPE_PREFIXES.map((prefix) => [
        "starts-with",
        "$Content-Type",
        prefix,
      ]),
      ["eq", "$x-amz-meta-upload-id", String(id)],
    ],
    ContentType: UPLOAD_CONTENT_TYPES[fileExt],
  };

  return {
    presigned: await new Promise(async (resolve, reject) => {
      s3.createPresignedPost(s3Params, (err, data) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(data);
      });
    }),
    isDuplicate: false,
    filePath,
    id,
  };
};
