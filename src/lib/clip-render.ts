/**
 * Fire-and-forget render trigger for the Clip Factory.
 *
 * Follows the on-s3-upload-process-exif → on-media-format lambda-chaining
 * pattern: direct async Lambda invoke with payload { clipId }. The render
 * lambda itself (issue CF-6) reads the Clip row and the upload's
 * processed_file_path, writes clips/{clipId}/* to the clips bucket, and
 * sets status: ready.
 *
 * Invocation failure is logged to Bugsnag but never thrown: the clip simply
 * stays queued and a requeue re-fires the render.
 */

import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { notifyBugsnag } from "./notifyBugsnag";

const lambda = new LambdaClient({
  region: process.env.AWS_REGION || "us-west-2",
});

const RENDER_CLIP_FUNCTION =
  process.env.RENDER_CLIP_FUNCTION_NAME || "pizzabase-dev-renderClip";

export async function invokeRenderClip(clipId: number): Promise<void> {
  try {
    await lambda.send(
      new InvokeCommand({
        FunctionName: RENDER_CLIP_FUNCTION,
        InvocationType: "Event",
        Payload: JSON.stringify({ clipId }),
      }),
    );
  } catch (err) {
    console.error(
      `[clip-render] Failed to invoke renderClip for clip ${clipId}:`,
      err,
    );
    notifyBugsnag(err as Error);
  }
}
