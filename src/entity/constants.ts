const ONE_MINUTE = 1000 * 60;
const ONE_HOUR = ONE_MINUTE * 60;

// After three hours trucks will move on
export const TRUCK_DECAY = ONE_HOUR * 3;

// Reports older than four hours shouldn't be considered related
export const REPORT_DECAY = ONE_HOUR * 4;

// Maximum number of uploads
export const UPLOAD_DECAY = ONE_MINUTE * 30;
export const UPLOAD_MAX = 6;

// Media pipeline lifecycle states
export const MEDIA_STATUS = {
  NONE: "none",
  PROCESSING: "processing",
  READY: "ready",
  FAILED: "failed",
} as const;

// Moderation states for Sightengine on-demand reviews
export const MODERATION_STATUS = {
  PENDING: "pending",
  CLEAN: "clean",
  FLAGGED: "flagged",
  REJECTED: "rejected",
} as const;

// Image processing defaults
export const IMAGE_MAX_DIMENSION = 1920;
export const IMAGE_QUALITY = 85;
export const VIDEO_MAX_DIMENSION = 1080;

// Upload size limit (50 MB)
export const UPLOAD_MAX_SIZE = 52428800;
