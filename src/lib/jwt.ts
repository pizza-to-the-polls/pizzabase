import * as jwt from "jsonwebtoken";

const secret = process.env.JWT_SECRET || "shhhh";
const DEFAULT_EXPIRES_IN = 60 * 15;

// JWTs include two periods (.) which don't encode to URLs well - replace with a pipe (|)

export const pack = async (
  data,
  expiresIn: number = DEFAULT_EXPIRES_IN,
): Promise<string> => (await packRaw(data, expiresIn)).replace(/\./g, "|");

const packRaw = async (
  data: { [id: string]: any },
  expiresIn: number,
): Promise<string> =>
  await new Promise((succeed, fail) => {
    jwt.sign(data, secret, { expiresIn }, (err, token) =>
      err ? fail(err) : succeed(token),
    );
  });

export const unpack = async (
  token?: string,
): Promise<{ [index: string]: string }> =>
  await unpackRaw(`${token}`.replace(/\|/g, "."));
const unpackRaw = async (token): Promise<{ [index: string]: string }> =>
  await new Promise((succeed, fail) => {
    jwt.verify(token, secret, (err, decoded) =>
      err ? fail(err) : succeed(decoded),
    );
  });
