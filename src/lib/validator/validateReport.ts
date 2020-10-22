import { normalizeAddress, NormalAddress } from "./normalizeAddress";
import { normalizeURL } from "./normalizeURL";
import { normalizeContact } from "./normalizeContact";
import { CONTACT_ERROR, ADDRESS_ERROR, URL_ERROR } from "./constants";

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
    errors.url = URL_ERROR;
  }

  const contactInfo = normalizeContact(contact);
  if (!contactInfo) {
    errors.contact = CONTACT_ERROR;
  }

  const normalizedAddress: null | NormalAddress = await normalizeAddress(
    address
  );
  if (!normalizedAddress) {
    errors.address = ADDRESS_ERROR;
  }

  return { errors, normalizedAddress, contactInfo, reportURL };
};
