import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { Upload } from "../entity/Upload";
import { UPLOAD_CONTENT_TYPES } from "./validator";

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
  const [fileExt] = filePath.split(".").reverse();

  const { url, fields } = await createPresignedPost(s3Client, {
    Bucket: S3_BUCKET,
    Key: filePath,
    Expires: 60,
    Conditions: [
      ["content-length-range", 0, 100_000_000],
      ["starts-with", "$Content-Type", "image/"],
      ["eq", "$x-amz-meta-user-id", String(id)],
      ["eq", "$x-amz-acl", "public-read"],
    ],
    Fields: {
      acl: "public-read",
      "Content-Type": UPLOAD_CONTENT_TYPES[fileExt],
    },
  });

  return {
    presigned: { url, fields },
    isDuplicate: false,
    filePath,
    id,
  };
};
