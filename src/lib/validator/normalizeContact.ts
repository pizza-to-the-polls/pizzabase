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

const isValidContact = (contact?: string): boolean =>
  isValidPhone(contact) || isValidEmail(contact);

export const normalizeContact = (contact?: string): null | string =>
  isValidContact(contact) ? contact : null;
