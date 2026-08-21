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

    // API call (costs credits)
    const S3_BUCKET = process.env.UPLOAD_S3_BUCKET;
    const { score } = await checkImage(S3_BUCKET!, upload.filePath);

    // Store result
    upload.sightengineScore = score;
    await upload.save();

    return { score, cached: false };
  }
}
