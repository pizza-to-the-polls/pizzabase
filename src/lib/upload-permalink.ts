/**
 * Public link to an upload's source media — the stable permalink shape the
 * feed zap uses (302s to the processed output). Shared by the clips
 * controller (kit.photoLinks) and the compilation lambda so every kit
 * message links the photos it was built from.
 */
import { Upload } from "../entity/Upload";

export const uploadPermalink = (upload: Upload): string =>
  `${process.env.PIZZABASE_API_URL || "https://base.polls.pizza"}/uploads/${upload.filePath
    .split("/")
    .pop()}`;
