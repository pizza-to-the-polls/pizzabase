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
    const pathKey = `uploads/${fileName}`;

    // New uploads keep rawFilePath stable for life; legacy rows only have
    // filePath. Look up both so the Retool viewer works for either.
    const upload = await Upload.findOne({
      where: [{ rawFilePath: pathKey }, { filePath: pathKey }] as any,
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
      // Legacy uploads live in the public bucket; new ones in their
      // recorded raw bucket. Null rawBucket ⇒ pre-pipeline row.
      const bucket = upload.rawBucket || process.env.UPLOAD_S3_BUCKET!;

      return extractExifAndReview(
        { s3Client: s3Client as any, bucket },
        { filePath: upload.rawFilePath || upload.filePath, includeReview }
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
   * Permalink resolver for media. GET /uploads/:fileName
   *
   * Redirects to wherever the media currently lives:
   *   - processed output when formatting is complete (webp/jpeg/mp4/gif)
   *   - the public bucket for legacy uploads that never went through the
   *     pipeline
   *   - 404 while processing (raw files are private and never served)
   *
   * This keeps report.url stable forever regardless of what the pipeline
   * does with storage behind the scenes.
   */
  async showMedia(request: Request, response: Response, _next: NextFunction) {
    const { fileName } = request.params;
    const pathKey = `uploads/${fileName}`;

    const upload = await Upload.findOne({
      where: [{ rawFilePath: pathKey }, { filePath: pathKey }] as any,
    });
    if (!upload) {
      response.status(404);
      return { errors: ["Not found"] };
    }

    // Legacy row: no raw file path recorded means it predates the pipeline
    // and lives in the public bucket under its original key.
    if (!upload.rawFilePath) {
      const bucket = process.env.UPLOAD_S3_BUCKET || "reports.polls.pizza";
      return response.redirect(
        302,
        `https://${bucket}.s3.amazonaws.com/${upload.filePath}`
      );
    }

    const processed = upload.processedFilePath as Record<string, string> | null;
    const primary =
      processed?.webp || processed?.jpeg || processed?.mp4 || processed?.gif;

    if (primary) {
      return response.redirect(302, primary);
    }

    // Still processing or failed — raw files are private, never served.
    response.status(404);
    return { errors: ["Media not available"] };
  }

  /**
   * Callback from the formatting Lambda when media processing completes.
   * POST /uploads/media-format-callback
   */
  async mediaFormatCallback(
    request: Request,
    response: Response,
    _next: NextFunction
  ) {
    if (
      request.headers["x-callback-secret"] !== process.env.MEDIA_CALLBACK_SECRET
    ) {
      response.status(401);
      return { errors: ["Unauthorized"] };
    }

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
      // Preserve jobId so duplicate MediaConvert events still resolve.
      const priorJobId = (upload.processedFilePath as Record<
        string,
        string
      > | null)?.jobId;
      upload.processedFilePath = {
        ...processed_file_path,
        ...(priorJobId ? { jobId: priorJobId } : {}),
      };
    }

    await upload.save();

    return { status: "ok" };
  }
}
