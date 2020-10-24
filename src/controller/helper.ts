import { Request, Response, NextFunction } from "express";

import { APIKey } from "../entity/APIKey";

export const findOr404 = (
  object: any,
  response: Response,
  next: NextFunction
): any => {
  const obj = object;
  if (obj) return obj;

  response.status(404).send({ errors: ["Not found"] });
  next();
};

export const checkAuthorization = async (
  request: Request
): Promise<boolean> => {
  const { authorization } = request.headers;
  const key = (authorization || "").replace("Basic ", "");

  return (await APIKey.count({ where: { key } })) > 0;
};

export const isAuthorized = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<boolean> => {
  if (await checkAuthorization(request)) {
    return true;
  }

  response.status(401).send({ errors: ["Not authorized"] });
  next();
  return false;
};
