import { normalizeAddress, NormalAddress } from "./normalizeAddress";
import { ADDRESS_ERROR } from "./constants";

interface ValidationError {
  address?: string;
}

export const validateTruck = async ({
  address,
  identifier,
}: {
  address?: string;
  identifier?: string;
}): Promise<{
  normalizedAddress: NormalAddress;
  identifier?: string;
  errors: ValidationError;
}> => {
  const errors: ValidationError = {};

  const normalizedAddress: null | NormalAddress = await normalizeAddress(
    address
  );
  if (!normalizedAddress) {
    errors.address = ADDRESS_ERROR;
  }

  return { errors, normalizedAddress, identifier };
};
