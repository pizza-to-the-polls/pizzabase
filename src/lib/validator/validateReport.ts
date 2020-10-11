import { normalizeAddress, NormalAddress } from "./normalizeAddress";
import { normalizeURL } from "./normalizeURL";
import { normalizeContact } from "./normalizeContact";

interface ValidationError {
  contact?: string;
  url?: string;
  address?: string;
}

export const validateReport = async ({
  address,
  contact,
  url,
}: {
  address?: string;
  contact?: string;
  url?: string;
}): Promise<{
  normalizedAddress: NormalAddress;
  contactInfo: string;
  reportURL: string;
  errors: ValidationError;
}> => {
  const errors: ValidationError = {};

  const reportURL = normalizeURL(url);
  if (!reportURL) {
    errors.url = "Invalid URL - please supply a valid URL";
  }

  const contactInfo = normalizeContact(contact);
  if (!contactInfo) {
    errors.contact =
      "Invalid contact - please supply an email address or phone number";
  }

  const normalizedAddress: null | NormalAddress = await normalizeAddress(
    address
  );
  if (!normalizedAddress) {
    errors.address = "Invalid address - please supply a valid address";
  }

  return { errors, normalizedAddress, contactInfo, reportURL };
};
