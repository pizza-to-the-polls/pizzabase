/**
 * Minimal ffmpeg process runner for the clip render lambda.
 *
 * Spawned directly (no shell) so argument arrays from clipTemplate.ts pass
 * through verbatim. Stderr is captured and surfaced on failure so render
 * errors land in the lambda logs / Bugsnag with actionable context.
 */

import { spawn } from "child_process";

const MAX_CAPTURED_STDERR = 20000;

export function runFfmpeg(binPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binPath, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > MAX_CAPTURED_STDERR) {
        stderr = stderr.slice(-MAX_CAPTURED_STDERR);
      }
    });
    // Drain stdout so the pipe never backpressures the encoder.
    child.stdout?.resume();

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn ${binPath}: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`),
        );
      }
    });
  });
}
