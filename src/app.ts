import * as express from "express";
import * as bodyParser from "body-parser";
import * as cors from "cors";

import { Request, Response, NextFunction } from "express";
import { Routes, PREFIX } from "./routes";

const app = express();

app.use(
  cors({
    origin: "*.polls.pizza, polls.pizza",
    optionsSuccessStatus: 200,
  })
);
app.use(bodyParser.json());

Routes.forEach(({ method, route, controller, action, noPrefix }) => {
  (app as any)[method](
    `${noPrefix ? "" : PREFIX}${route}`,
    (req: Request, res: Response, next: NextFunction) => {
      const result = new (controller as any)()[action](req, res, next);
      if (result instanceof Promise) {
        result.then((controllerResult) =>
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
