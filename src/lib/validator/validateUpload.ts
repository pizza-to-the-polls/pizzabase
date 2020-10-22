import { normalizeAddress, NormalAddress } from "./normalizeAddress";
import { UPLOAD_ERROR, ADDRESS_ERROR } from "./constants";
import { UPLOAD_CONTENT_TYPES } from "./constants";

interface ValidationError {
  fileName?: string;
  address?: string;
}

const CONTENT_TYPES = new Set(Object.keys(UPLOAD_CONTENT_TYPES));

export const validateUpload = async ({
  fileName,
  address,
}: {
  fileName?: string;
  address?: string;
}): Promise<{
  errors: ValidationError;
  fileExt: string | null;
  normalizedAddress: NormalAddress | null;
}> => {
  const errors: ValidationError = {};

  const [fileExt] = (fileName || "").toLowerCase().split(".").reverse();

  if (!CONTENT_TYPES.has(fileExt)) {
    errors.fileName = UPLOAD_ERROR;
  }

  const normalizedAddress = await normalizeAddress(address);
  if (!normalizedAddress) {
    errors.address = ADDRESS_ERROR;
  }

  return { errors, fileExt, normalizedAddress };
};
