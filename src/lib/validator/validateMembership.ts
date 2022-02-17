import { isValidEmail } from "./normalizeContact";
import { EMAIL_ERROR } from "./constants";

interface ValidationError {
  email?: string;
}

export const validateMembership = ({
  email: sentEmail,
}: {
  email?: string;
}): {
  email?: string;
  errors: ValidationError;
} => {
  const errors: ValidationError = {};

  const email: null | string = isValidEmail(sentEmail) ? sentEmail : null;
  if (!email) {
    errors.email = EMAIL_ERROR;
  }

  return { errors, email };
};
