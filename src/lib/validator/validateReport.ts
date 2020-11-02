import { normalizeAddress } from "./normalizeAddress";
import { NormalAddress, OverrideAddress } from "./types";
import { normalizeURL } from "./normalizeURL";
import { normalizeContact } from "./normalizeContact";
import { CONTACT_ERROR, ADDRESS_ERROR, URL_ERROR } from "./constants";
import { v4 as uuidv4 } from "uuid";

interface ValidationError {
  contact?: string;
  url?: string;
  address?: string;
}

export const validateReport = async (
  {
    address,
    contact,
    url,
    waitTime,
    canDistribute,
    contactFirstName,
    contactLastName,
    contactRole,
    addressOverride,
  }: {
    address?: string;
    contact?: string;
    url?: string;
    waitTime?: string;
    contactFirstName?: string;
    contactLastName?: string;
    contactRole?: string;
    canDistribute?: boolean;
    addressOverride?: OverrideAddress;
  },
  isAuthorized: boolean = false
): Promise<{
  normalizedAddress: NormalAddress;
  contactInfo: string;
  reportURL: string;
  errors: ValidationError;
  waitTime?: string;
  contactFirstName?: string;
  contactLastName?: string;
  contactRole?: string;
  canDistribute?: boolean;
}> => {
  const errors: ValidationError = {};
  const reportURL = normalizeURL(
    url ? url : isAuthorized ? `http://trusted.url/${uuidv4()}` : ""
  );
  if (!reportURL) {
    errors.url = URL_ERROR;
  }

  const contactInfo = normalizeContact(
    contact ? contact : isAuthorized ? "trusted@example.com" : ""
  );
  if (!contactInfo) {
    errors.contact = CONTACT_ERROR;
  }

  const normalizedAddress: null | NormalAddress = await normalizeAddress(
    address,
    isAuthorized ? addressOverride : null
  );
  if (!normalizedAddress) {
    errors.address = ADDRESS_ERROR;
  }

  return {
    errors,
    normalizedAddress,
    contactInfo,
    reportURL,
    waitTime,
    contactFirstName,
    contactLastName,
    contactRole: contactRole || isAuthorized ? "Trusted" : undefined,
    canDistribute,
  };
};
