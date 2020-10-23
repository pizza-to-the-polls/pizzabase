const ONE_MINUTE = 1000 * 60;
const ONE_HOUR = ONE_MINUTE * 60;

// After three hours trucks will move on
export const TRUCK_DECAY = ONE_HOUR * 3;

// Reports older than four hours shouldn't be considered related
export const REPORT_DECAY = ONE_HOUR * 4;

// Maximum number of uploads
export const UPLOAD_DECAY = ONE_MINUTE * 30;
export const UPLOAD_MAX = 6;
