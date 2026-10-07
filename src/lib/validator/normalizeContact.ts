// Linear-time email validation. Bounded quantifiers ({0,61}) and mandatory
// dot separators between labels prevent catastrophic backtracking (ReDoS).
const EMAIL_REGEX =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export const isValidEmail = (email?: string): boolean =>
  (email || "").match(EMAIL_REGEX) !== null;

const PHONE_REGEX =
  /^[+]?(1\-|1\s|1|\d{3}\-|\d{3}\s|)?((\(\d{3}\))|\d{3})(\-|\s)?(\d{3})(\-|\s)?(\d{4})$/;

export const isValidPhone = (phone?: string): boolean =>
  (phone || "").match(PHONE_REGEX) !== null;

export const normalizePhone = (phone: string): string => {
  return phone.replace(/[^\d+]/g, "");
};

/**
 * Returns the candidate stored forms of a phone number for read-time
 * matching. `normalizePhone` only strips punctuation, but the web report
 * form stores whatever the user typed (often bare 10 digits, e.g.
 * "5038938626") while Twilio always POSTs `From` as E.164
 * ("+1" + 10 digits, e.g. "+15038938626"), so exact string equality
 * never converges across the two.
 *
 * For US numbers this returns both the E.164 and bare-10-digit forms
 * (plus the "1"-prefixed form, since PHONE_REGEX accepts a leading 1).
 * For everything else — international numbers with other country codes,
 * short codes — it conservatively returns only the normalized form: no
 * invented variants. Inputs containing "@" (emails) are passed through
 * untouched (callers are phone-only today, but the guard is defensive).
 *
 * This is a read-time helper only — it does not canonicalize how
 * contactInfo / phone numbers are stored, and no data is backfilled.
 */
export const phoneVariants = (phone: string): string[] => {
  // Check the raw input before normalizing: normalizePhone strips every
  // non-digit/non-"+" character, which would destroy an email address
  // (including its "@") before the guard below could see it.
  if (phone.includes("@")) return [phone];

  const normalized = normalizePhone(phone);

  // E.164 US form: "+1" followed by exactly 10 digits
  if (/^\+1\d{10}$/.test(normalized)) {
    const bare = normalized.slice(2);
    return [normalized, bare, `1${bare}`];
  }

  // Bare 10-digit US form
  if (/^\d{10}$/.test(normalized)) {
    return [normalized, `+1${normalized}`, `1${normalized}`];
  }

  // "1"-prefixed US form (user typed 1-503-893-8626)
  if (/^1\d{10}$/.test(normalized)) {
    const bare = normalized.slice(1);
    return [normalized, `+1${bare}`, bare];
  }

  // Anything else: exact normalized match only, no invented variants
  return [normalized];
};

const isValidContact = (contact?: string): boolean =>
  isValidPhone(contact) || isValidEmail(contact);

export const normalizeContact = (contact?: string): null | string =>
  isValidContact(contact) ? contact : null;
