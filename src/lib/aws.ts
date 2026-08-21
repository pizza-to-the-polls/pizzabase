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
    // Self-contained policy: every required field lives in `Fields`, so the
    // SDK (a) generates an exact-match policy condition for it and (b) echoes
    // it back in the returned `fields`. Clients that append the returned
    // fields verbatim always satisfy the policy, regardless of whether they
    // also send their own ACL headers.
    //
    // Do NOT add explicit ["eq", "$acl"/$ACL/"$x-amz-acl", ...] conditions:
    // every condition must be satisfiable by the submitted form, and clients
    // differ in which ACL spellings they send (older browsers-based clients
    // append "ACL"/"x-amz-acl", newer ones rely solely on the returned
    // fields). Requiring several spellings simultaneously guarantees failure.
    //
    // Content-Type is deliberately NOT pinned: the browser sends its own
    // accurate MIME type (covered by the starts-with condition below); pinning
    // it produced duplicate, conflicting Content-Type form fields.
    Conditions: [
      ["content-length-range", 0, 100_000_000],
      ["starts-with", "$Content-Type", "image/"],
    ],
    Fields: {
      acl: "public-read",
      "x-amz-meta-user-id": String(id),
    },
  });

  return {
    presigned: { url, fields },
    isDuplicate: false,
    filePath,
    id,
  };
};
