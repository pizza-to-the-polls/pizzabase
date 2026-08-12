import * as aws from "aws-sdk";
import { Upload } from "../entity/Upload";
import { UPLOAD_CONTENT_TYPES } from "./validator";

const s3 = new aws.S3({ region: "us-west-2" });

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

  const s3Params = {
    Bucket: RAW_UPLOADS_BUCKET,
    Expires: 60,
    ACL: "private",
    Fields: {
      key: filePath,
      "x-amz-meta-upload-id": String(id),
    },
    Conditions: [
      ["content-length-range", 0, MAX_FILE_BYTES],
      ["eq", "$x-amz-meta-upload-id", String(id)],
      ["eq", "$x-amz-acl", "private"],
      ["eq", "$ACL", "private"],
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
