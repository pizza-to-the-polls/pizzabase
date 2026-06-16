import { normalizeAddress } from "./normalizeAddress";
import { NormalAddress } from "./types";
import { GeocodingError } from "./geocode";
import { FILE_HASH_ERROR, FILE_TYPE_ERROR, ADDRESS_ERROR } from "./constants";
import { UPLOAD_CONTENT_TYPES } from "./constants";

interface ValidationError {
  fileName?: string;
  address?: string;
  _geocoding?: string;
}

const CONTENT_TYPES = new Set(Object.keys(UPLOAD_CONTENT_TYPES));

export const validateUpload = async ({
  fileHash,
  fileName,
  address,
}: {
  fileName?: string;
  fileHash?: string;
  address?: string;
}): Promise<{
  errors: ValidationError;
  fileExt: string | null;
  fileHash: string | null;
  normalizedAddress: NormalAddress | null;
}> => {
  const errors: ValidationError = {};

  if (!fileHash) {
    errors.fileName = FILE_HASH_ERROR;
  }

  const [fileExt] = (fileName || "").toLowerCase().split(".").reverse();

  if (!CONTENT_TYPES.has(fileExt)) {
    errors.fileName = FILE_TYPE_ERROR;
  }

  try {
    const normalizedAddress = await normalizeAddress(address);
    if (!normalizedAddress) {
      errors.address = ADDRESS_ERROR;
    }
    return { errors, fileExt, fileHash, normalizedAddress };
  } catch (e) {
    if (e instanceof GeocodingError) {
      // Surface system-level geocoding failures so they don't fail silently
      errors._geocoding = e.message;
      return { errors, fileExt, fileHash, normalizedAddress: null };
    }
    throw e;
  }
};
