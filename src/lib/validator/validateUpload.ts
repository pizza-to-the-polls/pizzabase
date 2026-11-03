import { normalizeAddress } from "./normalizeAddress";
import { NormalAddress } from "./types";
import { GeocodingError } from "./geocode";
import { FILE_HASH_ERROR, FILE_TYPE_ERROR } from "./constants";
import { UPLOAD_CONTENT_TYPES } from "./constants";

interface ValidationError {
  fileName?: string;
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
    // BUG-037: a null geocode is NOT a client error — it means the geocoder
    // could not normalize the address to a full street address (locality-only
    // Places picks like "Miami, FL, USA", route-level partial matches,
    // ZERO_RESULTS). Photo uploads do not need a rooftop-precise address: the
    // Location link is a convenience (uploads.location_id is nullable since
    // #341) and /report independently validates the address the user submits
    // (validateReport). Only system-level geocoding failures surface here.
    const normalizedAddress = await normalizeAddress(address);
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
