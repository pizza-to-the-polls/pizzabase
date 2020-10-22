import * as aws from "aws-sdk";
import { Upload } from "../entity/Upload";
import { UPLOAD_CONTENT_TYPES } from "./validator";

const s3 = new aws.S3({ region: "us-west-2" });
const S3_BUCKET = process.env.UPLOAD_S3_BUCKET;

interface Presigned {
  presigned: {
    url: string;
    fields: { [key: string]: string };
  };
  id: number;
  filePath: string;
}

export const presignUpload = async (upload: Upload): Promise<Presigned> => {
  const { filePath, id } = upload;
  const [fileExt] = filePath.split(".").reverse();

  const s3Params = {
    Bucket: S3_BUCKET,
    Expires: 60,
    ACL: "public-read",
    Fields: {
      key: filePath,
    },
    Conditions: [
      ["content-length-range", 0, 100_000_000],
      ["starts-with", "$Content-Type", "image/"],
      ["eq", "$x-amz-meta-user-id", id],
      ["eq", "$x-amz-acl", "public-read"],
      ["eq", "$ACL", "public-read"],
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
    filePath,
    id,
  };
};
