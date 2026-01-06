import { NextFunction, Request, Response } from "express";
import * as aws from "aws-sdk";
import exifReader from "exif-reader";
import { Upload } from "../entity/Upload";
import { validateUpload } from "../lib/validator";
import { presignUpload } from "../lib/aws";
import { zapNewUpload } from "../lib/zapier";
import { isAuthorized, findOr404 } from "./helper";

export class UploadsController {
  async create(request: Request, response: Response, _next: NextFunction) {
    const { errors, ...uploadParams } = await validateUpload(
      request.body || {}
    );

    if (Object.keys(errors).length > 0) {
      response.status(422);
      return { errors };
    }

    try {
      const [upload, exists] = await Upload.createOrReject(
        request.ip,
        uploadParams
      );

      if (exists) {
        return {
          filePath: upload.filePath,
          id: upload.id,
          presigned: { url: null, fields: {} },
          isDuplicate: true,
        };
      } else {
        await zapNewUpload(upload);
        return await presignUpload(upload);
      }
    } catch (e) {
      response.status(429);
      return {
        errors: {
          fileName: e.message,
        },
      };
    }
  }

  async getExif(request: Request, response: Response, next: NextFunction) {
    if (!(await isAuthorized(request, response, next))) return null;

    const upload = await Upload.findOne({
      where: { id: parseInt(request.params.id, 10) },
    });
    if (!findOr404(upload, response, next)) return null;

    try {
      const s3 = new aws.S3({ region: "us-west-2" });
      const S3_BUCKET = process.env.UPLOAD_S3_BUCKET;

      const s3Object = await s3
        .getObject({
          Bucket: S3_BUCKET,
          Key: upload.filePath,
          Range: "bytes=0-65535", // Read the first 64KB
        })
        .promise();

      if (s3Object.Body) {
        return exifReader(s3Object.Body as Buffer);
      }
    } catch (error) {
      // Log the error, but don't block the main flow
      console.error(
        `Could not extract EXIF data for upload ${upload.id}:`,
        error
      );
    }

    return null;
  }
}
