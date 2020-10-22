import * as aws from "aws-sdk";
import { Upload } from "../entity/Upload";
import { UPLOAD_CONTENT_TYPES } from "./validator";

const s3 = new aws.S3();
const S3_BUCKET = process.env.UPLOAD_S3_BUCKET;

interface Presigned {
  presigned: {
    url: string;
    fields: { [key: string]: string };
  };
  id: number;
}

export const presignUpload = (upload: Upload): Presigned => {
  const { filePath, id } = upload;
  const [fileExt] = filePath.split(".").reverse();

  const s3Params = {
    Bucket: S3_BUCKET,
    Fields: {
      key: filePath,
    },
    Conditions: [
      ["content-length-range", 0, 100_000_000],
      ["starts-with", "$Content-Type", "image/"],
      ["eq", "$x-amz-meta-user-id", id],
    ],
    ContentType: UPLOAD_CONTENT_TYPES[fileExt],
  };

  return {
    presigned: s3.createPresignedPost(s3Params),
    id,
  };
};
