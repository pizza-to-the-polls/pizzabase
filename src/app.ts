import * as express from "express";
import * as bodyParser from "body-parser";
import * as cors from "cors";

import { Request, Response, NextFunction } from "express";
import { Routes } from "./routes";

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(",");

const app = express();

app.use(
  cors({
    origin: (origin, callback) => {
      if (
        ALLOWED_ORIGINS &&
        (origin || "").match(new RegExp(ALLOWED_ORIGINS.join("|")))
      )
        return callback(null, origin);
      callback(null, process.env.STATIC_SITE || "http://polls.pizza");
    },
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    allowedHeaders: "Content-Type,Authorization",
    optionsSuccessStatus: 200,
  })
);
app.use(bodyParser.json());

app.set("trust proxy", true);

Routes.forEach(({ method, route, controller, action }) => {
  (app as any)[method](
    route,
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
