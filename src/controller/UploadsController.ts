import { NextFunction, Request, Response } from "express";
import { Upload } from "../entity/Upload";
import { validateUpload } from "../lib/validator";
import { presignUpload } from "../lib/aws";
import { zapNewUpload } from "../lib/zapier";
import { notifyBugsnag } from "../lib/notifyBugsnag";
import { isAuthorized, findOr404 } from "./helper";
import { checkGenai } from "../lib/sightengine/client";
import { ReviewResult, assessSightengine } from "../lib/exif/review";

export class UploadsController {
  async create(request: Request, response: Response, _next: NextFunction) {
    let validated;
    try {
      validated = await validateUpload(request.body || {});
    } catch (e) {
      notifyBugsnag(e as Error);
      response.status(500);
      return {
        errors: {
          _general: "An unexpected error occurred during validation",
        },
      };
    }

    const { errors, ...uploadParams } = validated;

    if (Object.keys(errors).length > 0) {
      // Geocoding failures are server-level issues, not client validation
      if (errors._geocoding) {
        notifyBugsnag(
          new Error(`Upload geocoding failure: ${errors._geocoding}`)
        );
        response.status(503);
        return {
          errors: {
            address:
              "Address verification is temporarily unavailable. Please try again later.",
          },
        };
      }
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
        const result = await presignUpload(upload);

        if (request.query.includeReview === "true") {
          const reviewResult: ReviewResult = {};

          // SightEngine AI-generated image detection
          const S3_BUCKET = process.env.UPLOAD_S3_BUCKET;
          const REGION = process.env.AWS_REGION || "us-west-2";
          const publicUrl = `https://${S3_BUCKET}.s3.${REGION}.amazonaws.com/${upload.filePath}`;

          const sightengineResult = await checkGenai(publicUrl);
          reviewResult.sightengine = sightengineResult;

          if (sightengineResult) {
            const assessment = assessSightengine(sightengineResult.score);
            if (assessment) {
              reviewResult.assessment = [assessment];
            }
          }

          // EXIF extraction via bounded S3 read (first 64 KB)
          try {
            const awsSdk = require("aws-sdk");
            const s3Client = new awsSdk.S3({ region: REGION });
            const s3Object = await s3Client
              .getObject({
                Bucket: S3_BUCKET,
                Key: upload.filePath,
                Range: "bytes=0-65535",
              })
              .promise();

            if (s3Object.Body) {
              const exifReader = require("exif-reader");
              reviewResult.exif = exifReader(s3Object.Body);
            }
          } catch (_exifError) {
            reviewResult.exif = null;
          }

          return { ...result, review: reviewResult };
        }

        return result;
      }
    } catch (e) {
      // Only rate-limiting should return 429; everything else is caught by
      // the Express error handler in app.ts and reported to Bugsnag.
      if (e.message?.includes("too many uploads")) {
        response.status(429);
        return {
          errors: {
            fileName: e.message,
          },
        };
      }
      throw e;
    }
  }

  async getExif(request: Request, response: Response, next: NextFunction) {
    if (!(await isAuthorized(request, response, next))) return null;

    const { fileName } = request.params;
    const filePath = `uploads/${fileName}`;

    const upload = await Upload.findOne({
      where: { filePath } as any,
    });
    if (!findOr404(upload, response, next)) return null;

    try {
      const s3Client = new (require("aws-sdk").S3)({
        region: process.env.AWS_REGION || "us-west-2",
      });
      const S3_BUCKET = process.env.UPLOAD_S3_BUCKET;

      const s3Object = await s3Client
        .getObject({
          Bucket: S3_BUCKET,
          Key: upload.filePath,
          Range: "bytes=0-65535", // Read the first 64KB where EXIF lives
        })
        .promise();

      if (s3Object.Body) {
        const exifReader = require("exif-reader");
        return exifReader(s3Object.Body);
      }
    } catch (error) {
      // Log the error, but don't block the main flow
      console.error(
        `Could not extract EXIF data for upload ${upload.filePath}:`,
        error
      );
    }

    return null;
  }
}
