import { NextFunction, Request, Response } from "express";
import { Upload } from "../entity/Upload";
import { validateUpload } from "../lib/validator";
import { presignUpload } from "../lib/aws";
import { zapNewUpload } from "../lib/zapier";
import { notifyBugsnag } from "../lib/notifyBugsnag";
import { extractExif, MAX_EXIF_SCAN } from "../lib/exif/extract";
import { serializeExif } from "../lib/exif/serialize";
import { reviewExif } from "../lib/exif/review";
import { isAuthorized, findOr404 } from "./helper";

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
        return await presignUpload(upload);
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

    // Fast path: read from exif_data JSONB (populated by EXIF pipeline)
    if (upload.exifData) {
      return upload.exifData;
    }

    // Fallback: read from S3 for legacy uploads that don't have exif_data
    // yet.  This keeps backward compatibility during migration.
    return this.readExifFromS3(upload.filePath);
  }

  async mediaFormatCallback(
    request: Request,
    response: Response,
    _next: NextFunction
  ) {
    const { id, processed_file_path, status } = request.body;

    if (!id || !status) {
      response.status(400);
      return {
        errors: {
          _general: "Missing required fields: id, status",
        },
      };
    }

    const upload = await Upload.findOne({ where: { id } as any });
    if (!upload) {
      response.status(404);
      return { errors: { _general: "Upload not found" } };
    }

    if (status !== "ready" && status !== "failed") {
      response.status(400);
      return {
        errors: {
          _general: `Invalid status "${status}". Must be "ready" or "failed".`,
        },
      };
    }

    upload.mediaStatus = status as "ready" | "failed";
    if (processed_file_path) {
      upload.processedFilePath = processed_file_path;
    }

    await upload.save();

    return { ok: true, id, mediaStatus: upload.mediaStatus };
  }

  /**
   * Legacy S3 fallback for getExif — reads the first 64KB of the
   * original upload from the raw bucket, extracts + serialises EXIF,
   * and runs the review heuristic.  Returns the same shape as the
   * JSONB fast path so callers see a consistent response.
   */
  private async readExifFromS3(filePath: string): Promise<any> {
    try {
      const s3Client = new (require("aws-sdk").S3)({
        region: process.env.AWS_REGION || "us-west-2",
      });
      const S3_BUCKET =
        process.env.RAW_UPLOADS_BUCKET || process.env.UPLOAD_S3_BUCKET;

      const s3Object = await s3Client
        .getObject({
          Bucket: S3_BUCKET,
          Key: filePath,
          Range: `bytes=0-${MAX_EXIF_SCAN - 1}`,
        })
        .promise();

      if (!s3Object.Body) return null;

      const buffer = Buffer.isBuffer(s3Object.Body)
        ? s3Object.Body
        : Buffer.from(s3Object.Body as ArrayBuffer);

      const exifSegment = extractExif(buffer);
      if (!exifSegment) return null;

      const exifReader = require("exif-reader");
      const rawExif = exifReader(exifSegment);

      // Match the JSONB fast-path shape: serialised EXIF + review
      const result = serializeExif(rawExif);
      result._review = reviewExif(rawExif);
      return result;
    } catch (error) {
      console.error(
        `Could not extract EXIF data for upload ${filePath}:`,
        error
      );
    }

    return null;
  }
}
