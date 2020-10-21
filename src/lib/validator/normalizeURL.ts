const URL_REGEX = /((([A-Za-z]{3,9}:(?:\/\/)?)(?:[\-;:&=\+\$,\w]+@)?[A-Za-z0-9\.\-]+|(?:www\.|[\-;:&=\+\$,\w]+@)[A-Za-z0-9\.\-]+)((?:\/[\+~%\/\.\w\-_]*)?\??(?:[\-\+=&;%@\.\w_]*)#?(?:[\.\!\/\\\w]*))?)/;

const isValidURL = (url?: string): boolean =>
  (url || "").match(URL_REGEX) !== null;

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
