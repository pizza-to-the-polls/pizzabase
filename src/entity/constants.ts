const ONE_MINUTE = 1000 * 60;
const ONE_HOUR = ONE_MINUTE * 60;

// After three hours trucks will move on
export const TRUCK_DECAY = ONE_HOUR * 3;

// Reports older than four hours shouldn't be considered related
export const REPORT_DECAY = ONE_HOUR * 4;

// A pizza order placed for a location inside this window means pizza is
// already on the way: fresh reports there auto-skip instead of queueing
// for volunteer triage (src/lib/auto-skip.ts).
export const RECENT_ORDER_SKIP_WINDOW = ONE_HOUR; // 60 minutes

// Maximum number of uploads
export const UPLOAD_DECAY = ONE_MINUTE * 30;
export const UPLOAD_MAX = 6;
