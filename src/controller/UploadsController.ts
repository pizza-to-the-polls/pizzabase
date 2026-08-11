import { NextFunction, Request, Response } from "express";
import { Upload } from "../entity/Upload";
import { validateUpload } from "../lib/validator";
import { presignUpload } from "../lib/aws";
import { zapNewUpload } from "../lib/zapier";
import { notifyBugsnag } from "../lib/notifyBugsnag";
import { isAuthorized, findOr404 } from "./helper";
import { extractExifAndReview } from "../lib/exif/service";

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

    const includeReview = request.query.includeReview === "true";

    // Prefer EXIF stored in DB (faster, idempotent). Fall back to S3 read
    // for backward compatibility with uploads that have no `exif_data`.
    if (upload.exifData && !includeReview) {
      return { exif: upload.exifData };
    }

    if (upload.exifData && includeReview) {
      const { reviewExif } = require("../lib/exif/review");
      // When returning exif_data from DB alongside a review, we pass the
      // stored data. The review runs with no digitalSourceType (not stored)
      // and no c2pa (not stored). This is a best-effort review from DB.
      const review = reviewExif(upload.exifData, undefined, undefined);
      return { exif: upload.exifData, review };
    }

    // Fallback: read from S3 (backward compat).
    try {
      const s3Client = new (require("aws-sdk").S3)({
        region: process.env.AWS_REGION || "us-west-2",
      });
      const bucket = upload.rawBucket || process.env.UPLOAD_S3_BUCKET!;

      return extractExifAndReview(
        { s3Client: s3Client as any, bucket },
        { filePath: upload.filePath, includeReview }
      );
    } catch (error) {
      console.error(
        `Could not extract EXIF data for upload ${upload.filePath}:`,
        error
      );
      return includeReview
        ? { exif: null, review: { assessment: "error" } }
        : { exif: null };
    }
  }

  /**
   * Callback from the formatting Lambda when media processing completes.
   * POST /api/uploads/media-format-callback
   */
  async mediaFormatCallback(
    request: Request,
    response: Response,
    _next: NextFunction
  ) {
    const { id, processed_file_path, status } = request.body || {};

    if (!id || !status) {
      response.status(400);
      return { errors: ["Missing required fields: id, status"] };
    }

    const upload = await Upload.findOne({ where: { id } });
    if (!upload) {
      response.status(404);
      return { errors: ["Upload not found"] };
    }

    upload.mediaStatus = status === "ready" ? "ready" : "failed";

    if (processed_file_path) {
      upload.processedFilePath = processed_file_path;
    }

    await upload.save();

    return { status: "ok" };
  }
}
