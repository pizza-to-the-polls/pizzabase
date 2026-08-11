import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { Upload } from "../entity/Upload";
import { UPLOAD_CONTENT_TYPES } from "./validator";

const s3Client = new S3Client({ region: "us-west-2" });

const RAW_UPLOADS_BUCKET = process.env.RAW_UPLOADS_BUCKET || "raw.polls.pizza";
const MAX_FILE_BYTES = 52_428_800; // 50 MB

interface Presigned {
  presigned: {
    url: string;
    fields: { [key: string]: string };
  };
  id: number;
  filePath: string;
  isDuplicate: boolean;
}

export const presignUpload = async (upload: Upload): Promise<Presigned> => {
  const { filePath, id } = upload;
  const [fileExt] = filePath.split(".").reverse();
  const contentType = UPLOAD_CONTENT_TYPES[fileExt];

  const { url, fields } = await createPresignedPost(s3Client, {
    Bucket: RAW_UPLOADS_BUCKET,
    Key: filePath,
    Expires: 300,
    // Self-contained policy note: every required field lives in `Fields`, so
    // the SDK (a) generates an exact-match policy condition for it and (b)
    // echoes it back in the returned `fields`.
    //
    // Content-Type is constrained by an exact-match condition but is
    // deliberately NOT set in `Fields`: the browser sends its own accurate
    // MIME type (which must match the extension-derived type); pinning it in
    // Fields produced duplicate, conflicting Content-Type form fields.
    //
    // Uploads land in the private raw bucket so the EXIF-scrubbing /
    // transcode pipeline runs before anything is served publicly. No ACL:
    // raw objects must stay private.
    Conditions: [
      ["content-length-range", 0, MAX_FILE_BYTES],
      ["eq", "$Content-Type", contentType],
      ["eq", "$x-amz-meta-upload-id", String(id)],
    ],
    Fields: {
      "x-amz-meta-upload-id": String(id),
    },
  });

  return {
    presigned: { url, fields },
    isDuplicate: false,
    filePath,
    id,
  };
};
