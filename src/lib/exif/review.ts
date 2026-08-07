export interface ReviewResult {
  sightengine?: { score: number } | null;
  exif?: Record<string, unknown> | null;
  assessment?: string[];
}

export const SIGHTENGINE_OVERRIDE_THRESHOLD = 0.7;

export function assessSightengine(score: number): string | null {
  if (score > SIGHTENGINE_OVERRIDE_THRESHOLD) {
    return "likely-screen-or-software-generated";
  }
  return null;
}
