const URL_REGEX = /^(?:(?:(?:https?|ftp):)?\/\/)(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})).?)(?::\d{2,5})?(?:[/?#]\S*)?$/i;
const EMAIL_REGEX = /(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/;

const isValidURL = (url?: string): boolean =>
  (url || "").match(URL_REGEX) !== null &&
  (url || "").match(EMAIL_REGEX) === null;

const removeSearchParams = (url: string) => url.split("?")[0];

export const normalizeURL = (maybeUrl?: string): null | string => {
  const url = (maybeUrl || "").replace(/<[^>]*>/g, "").toLowerCase();

  if (!isValidURL(url)) return null;

  if (url.includes("twitter.com")) {
    if (url === "https://twitter.com/pizzatothepolls") return null;
    if (url === "https://twitter.com/") return null;
    return removeSearchParams(url);
  }

  if (url.includes("instagram.com")) {
    return removeSearchParams(url);
  }

  if (url.includes("facebook.com")) {
    if (url === "https://facebook.com/story") return null;
    if (url === "https://facebook.com/photo") return null;
    return removeSearchParams(url);
  }

  if (url.includes("tiktok.com")) {
    return removeSearchParams(url);
  }

  return url;
};
