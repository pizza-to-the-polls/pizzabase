import { TWITTER_ERROR, OUR_TWITTER_ERROR, FACEBOOK_ERROR } from "./constants";

// Linear-time URL validation. Every quantifier is bounded ({0,61}) or
// separated by mandatory literals (".", "/") so pathological input cannot
// trigger catastrophic backtracking (ReDoS). Private/reserved IPv4 ranges
// are still rejected.
const URL_REGEX =
  /^(?:(?:https?|ftp):)?\/\/(?:[a-z0-9~._%-]+(?::[a-z0-9~._%-]*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d?\d)){3}|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}))(?::\d{1,5})?(?:[/?#]\S*)?$/i;
const EMAIL_REGEX =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

const isValidURL = (url?: string): boolean =>
  (url || "").match(URL_REGEX) !== null &&
  (url || "").match(EMAIL_REGEX) === null;

const removeSearchParams = (url: string) => url.split("?")[0];

export const normalizeURL = (maybeUrl?: string): null | string => {
  const url = (maybeUrl || "")
    .replace(/<[^>]*>/g, "")
    .trim()
    .toLowerCase();

  if (!isValidURL(url)) return null;

  if (url.includes("twitter.com")) {
    if (url.includes("/pizzatothepolls")) {
      throw OUR_TWITTER_ERROR;
    }
    if (url.includes("status")) {
      return removeSearchParams(url);
    }
    throw TWITTER_ERROR;
  }

  if (url.includes("instagram.com")) {
    return removeSearchParams(url);
  }

  if (url.includes("facebook.com")) {
    if (url.includes("/story") || url.includes("/photo")) {
      throw FACEBOOK_ERROR;
    }
    return removeSearchParams(url);
  }

  if (url.includes("tiktok.com")) {
    return removeSearchParams(url);
  }

  return url;
};
