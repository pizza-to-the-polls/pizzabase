import { NextFunction, Request, Response } from "express";
import { Upload } from "../entity/Upload";
import { isAuthorized, findOr404 } from "./helper";
import { checkImage } from "../lib/sightengine/client";

export class SightEngineController {
  async getSightEngineScore(
    request: Request,
    response: Response,
    next: NextFunction,
  ) {
    if (!(await isAuthorized(request, response, next))) return null;

    const { fileName } = request.params;
    const filePath = `uploads/${fileName}`;

    const upload = await Upload.findOne({ where: { filePath } as any });
    if (!findOr404(upload, response, next)) return null;

    // Cache check — return cached score if we already have one
    if (upload.sightengineScore != null) {
      return { score: upload.sightengineScore, cached: true };
    }

    // Determine which object to moderate:
    //   - Pipeline uploads keep raws in the private raw bucket and processed
    //     outputs under uploads/<id>/ in the processed bucket — moderate the
    //     scrubbed processed image, not the raw.
    //   - Legacy uploads live in the processed bucket under their original
    //     key — moderate in place.
    const bucket = process.env.UPLOAD_S3_BUCKET!;
    let key = upload.filePath;

    if (upload.rawFilePath) {
      const processed = upload.processedFilePath as Record<
        string,
        string
      > | null;
      const processedUrl = processed?.webp || processed?.jpeg || processed?.gif;

      if (!processedUrl) {
        response.status(409);
        return {
          errors: [
            `Processing incomplete for upload ${upload.id} (media_status: ${upload.mediaStatus})`,
          ],
        };
      }

      const parsed = new URL(processedUrl);
      key = parsed.pathname.replace(`/${bucket}/`, "");
    }

    try {
      const { score } = await checkImage(bucket, key);

      // Store result
      upload.sightengineScore = score;
      await upload.save();

      return { score, cached: false };
    } catch (err) {
      console.error(
        `[SightEngine] check failed for upload ${upload.id} (s3://${bucket}/${key}):`,
        err,
      );
      response.status(502);
      return { errors: ["SightEngine check failed"] };
    }
  }
}
