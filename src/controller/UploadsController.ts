import { NextFunction, Request, Response } from "express";
import { Upload } from "../entity/Upload";
import { validateUpload } from "../lib/validator";
import { presignUpload } from "../lib/aws";
import { zapNewUpload } from "../lib/zapier";
import { notifyBugsnag } from "../lib/notifyBugsnag";
import { isAuthorized, findOr404 } from "./helper";
import {
  extractExifWithRetry,
  serializeExif,
  reviewExif,
  MAX_EXIF_BYTES,
} from "../lib/exif";

/** Initial byte range for EXIF scanning – first 64 KiB. */
const INITIAL_RANGE_BYTES = 65535;

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

    const S3_BUCKET = process.env.UPLOAD_S3_BUCKET;
    // Preserve the deployed raw EXIF/null contract by default. Administrative
    // review clients opt into the additive evidence envelope explicitly.
    const includeReview = request.query.includeReview === "true";

    try {
      const s3Client = new (require("aws-sdk").S3)({
        region: process.env.AWS_REGION || "us-west-2",
      });

      // Bounded EXIF extraction with one controlled follow-up read.
      // Strategy:
      //  1. Read the first 64 KiB (where EXIF typically lives).
      //  2. Try to extract the TIFF payload from the container.
      //  3. If the EXIF segment extends beyond the buffer and is within
      //     MAX_EXIF_BYTES total, issue a single follow-up Range read
      //     for the missing bytes.
      //  4. Retry extraction with the combined buffer.
      //  5. If follow-up is not needed, unavailable, or exceeds the cap,
      //     fall back to the initial result.

      const s3Object = await s3Client
        .getObject({
          Bucket: S3_BUCKET,
          Key: upload.filePath,
          Range: `bytes=0-${INITIAL_RANGE_BYTES}`,
        })
        .promise();

      let tiffPayload: Buffer | null = null;

      if (s3Object.Body) {
        const initialBuffer = s3Object.Body as Buffer;

        tiffPayload = await extractExifWithRetry(
          initialBuffer,
          0,
          async (start: number, end: number) => {
            // Guard against unbounded reads.
            if (end - start + 1 > MAX_EXIF_BYTES) return null;

            try {
              const followUp = await s3Client
                .getObject({
                  Bucket: S3_BUCKET,
                  Key: upload.filePath,
                  Range: `bytes=${start}-${end}`,
                })
                .promise();
              return followUp.Body as Buffer | null;
            } catch {
              return null;
            }
          }
        );

        if (tiffPayload) {
          const exifReader = require("exif-reader");
          const parsed = exifReader(tiffPayload);
          const serialized = serializeExif(parsed);
          // Pass raw parsed data to reviewExif so it can inspect all value
          // types (Buffers, Dates, etc.) before serialization.
          const review = reviewExif(parsed);

          return includeReview
            ? {
                exif: serialized,
                review,
              }
            : serialized;
        }
      }
    } catch (error) {
      // Log the error, but return null – don't fail the request.
      // Parse errors from exif-reader on malformed data are expected.
      console.error(
        `Could not extract EXIF data for upload ${upload.filePath}:`,
        error
      );
    }

    return includeReview ? { exif: null, review: reviewExif(null) } : null;
  }
}
