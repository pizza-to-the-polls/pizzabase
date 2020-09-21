import * as express from "express";
import * as bodyParser from "body-parser";

import { Request, Response } from "express";
import { Routes } from "./routes";

const app = express();

app.use(bodyParser.json());

Routes.forEach(({ method, route, controller, action }) => {
  (app as any)[method](route, (req: Request, res: Response, next: Function) => {
    const result = new (controller as any)()[action](req, res, next);
    if (result instanceof Promise) {
      result.then((result) =>
        result !== null && result !== undefined ? res.send(result) : undefined
      );
    } else if (result !== null && result !== undefined) {
      res.json(result);
    }
  });
});

export default app;
