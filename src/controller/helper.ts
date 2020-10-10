import { Response } from "express";

export const FindOr404 = (object: any, response: Response): any => {
  const obj = object;
  if (obj) return obj;

  response.status(404);
  return { errors: ["Not found"] };
};
