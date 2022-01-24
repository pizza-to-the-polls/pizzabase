import { Jwt as jwt } from "jsonwebtoken";

const secret = process.env.MEMBERSHIP_JWT_SECRET || "shhhh";
const expiresIn = 60 * 15;

export const pack = async (package): Promise<string> =>
  await new Promise((succeed, fail) => {
    jwt.sign(package, secret, { expiresIn }, (err, token) =>
      err ? fail(err) : succeed(token)
    );
  });

export const unpack = async (
  token
): Promise<{ [index: string]: string | number }> =>
  await new Promise((succeed, fail) => {
    jwt.verify(token, secret, (err, decoded) =>
      err ? fail(err) : succeed(decoded)
    );
  });
