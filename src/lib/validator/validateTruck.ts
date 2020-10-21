import { normalizeAddress, NormalAddress } from "./normalizeAddress";

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
    errors.address = "Invalid address - please supply a valid address";
  }

  return { errors, normalizedAddress, identifier };
};
