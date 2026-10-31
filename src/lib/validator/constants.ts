export const CONTACT_ERROR =
  "Whoops! We that's not a valid phone number. Try sending us a real one so we can follow up.";
export const ADDRESS_ERROR =
  "Whoops! We couldn't verify that address. Try searching again for a valid location.";
export const URL_ERROR =
  "Whoops! That's not a valid URL. Try sending us a real one so we can verify there's a line";

/**
 * Georgia Senate Bill 22 (2025) makes it illegal to give food or beverages
 * to voters waiting in line at or near a polling place, so Pizza to the
 * Polls cannot accept line reports from Georgia. Mirrored in the polls.pizza
 * report form (form-report.tsx GEORGIA_ERROR) — keep the copy in sync.
 */
export const GEORGIA_ERROR =
  "Whoops! Georgia's Senate Bill 22 (SB 22) bans giving food or beverages to voters waiting in line, so we can't accept reports for polling places in Georgia.";

export const TWITTER_ERROR =
  "Whoops! That's not a link to a specific tweet. Try sending us a real one so we can verify there's a line";
export const OUR_TWITTER_ERROR =
  "Whoops! That's just... our twitter account. Try sending us a real one so we can verify there's a line";
export const FACEBOOK_ERROR =
  "Whoops! We usually can't view links to photos or stories in facebook - try sending us a public link";

export const COST_ERROR =
  "Whoops! That's not a valid cost. Try sending us a real one like a number or something";
export const FILE_HASH_ERROR =
  "Whoops! Something didn't work with your upload. Try the upload again";
export const FILE_TYPE_ERROR =
  "Whoops! That's not a valid file. Try sending us an image or video (mp4, mov, webm)";
export const ORDER_TYPE_ERROR =
  "Whoops! That's not a valid order type. Try sending pizzas or donuts or something else";
export const AMOUNT_ERROR =
  "Whoops! That's not a valid donation amount - send a number";
export const EMAIL_ERROR = "Whoops! That's not a valid email";

export const UPLOAD_CONTENT_TYPES = {
  gif: "image/gif",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};
