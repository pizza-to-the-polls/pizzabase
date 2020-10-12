import { Request, Response, NextFunction } from "express";

import { APIKey } from "../entity/APIKey";

export const FindOr404 = (
  object: any,
  response: Response,
  next: NextFunction
): any => {
  const obj = object;
  if (obj) return obj;

  response.status(404).send({ errors: ["Not found"] });
  next();
};

export const isAuthorized = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<boolean> => {
  const { authorization } = request.headers;
  const key = (authorization || "").replace("Basic ", "");

  const apiKey = await APIKey.findOne({ where: { key } });

  if (!apiKey) {
    response.status(401).send({ errors: ["Not authorized"] });
    next();
    return false;
  }

  return true;
};
