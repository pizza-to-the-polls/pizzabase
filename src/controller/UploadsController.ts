import { NextFunction, Request, Response } from "express";
import { Upload } from "../entity/Upload";
import { validateUpload } from "../lib/validator";
import { presignUpload } from "../lib/aws";
import { zapNewUpload } from "../lib/zapier";

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
}
