import * as express from "express";
import * as bodyParser from "body-parser";

import { Request, Response, NextFunction } from "express";
import { Routes } from "./routes";

const app = express();

app.use(bodyParser.json());

Routes.forEach(({ method, route, controller, action }) => {
  (app as any)[method](
    route,
    (req: Request, res: Response, next: NextFunction) => {
      const result = new (controller as any)()[action](req, res, next);
      if (result instanceof Promise) {
        controllerResult.then((controllerResult) =>
          controllerResult !== null && controllerResult !== undefined
            ? res.send(controllerResult)
            : undefined
        );
      } else if (result !== null && result !== undefined) {
        res.json(result);
      }
    }
  );
});

export default app;
