import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { Upload } from "../entity/Upload";

const s3Client = new S3Client({ region: "us-west-2" });
const S3_BUCKET = process.env.UPLOAD_S3_BUCKET;

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

  const { url, fields } = await createPresignedPost(s3Client, {
    Bucket: S3_BUCKET,
    Key: filePath,
    Expires: 60,
    Conditions: [
      ["content-length-range", 0, 100_000_000],
      ["starts-with", "$Content-Type", "image/"],
      ["eq", "$x-amz-meta-user-id", String(id)],
      // Match the aws-sdk v2 policy exactly: the browser client appends both
      // `ACL` and `x-amz-acl` form fields, and every submitted field must be
      // covered by a policy condition. Do NOT add these via `Fields` — the
      // v3 helper turns each Fields entry into an extra exact-match policy
      // condition (e.g. {"acl": ...}), which conflicts with the client's
      // uppercase `ACL` field and breaks the upload with
      // "Invalid according to Policy: Policy Condition failed".
      ["eq", "$x-amz-acl", "public-read"],
      ["eq", "$ACL", "public-read"],
    ],
  });

  return {
    presigned: { url, fields },
    isDuplicate: false,
    filePath,
    id,
  };
};
