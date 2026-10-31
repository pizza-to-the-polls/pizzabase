import express from "express";
import bodyParser from "body-parser";
import cors from "cors";

import { Request, Response, NextFunction } from "express";
import { Routes } from "./routes";
import { initBugSnagMiddleware } from "./lib/middleware/bugsnag";
import { requestLogging } from "./lib/middleware/requestLogging";

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(",");

const { addBugSnagRequestHandler, addBugSnagErrorHandler } =
  initBugSnagMiddleware();

const app = express();

addBugSnagRequestHandler(app);

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
  }),
);
app.use("/webhook", bodyParser.raw({ type: "*/*" }));
// feedflag's bulk intake carries description JSONB blobs; a single
// fat-but-valid observation near the default 100kb would be rejected at the
// door (feedflag #76 — senders now batch by bytes and stay polite, but one
// oversized row must still LAND, not 413 at the middleware before the
// controller can even log it). Scoped to the route prefix so every other
// route keeps the default limit.
app.use("/feed-observations", bodyParser.json({ limit: "512kb" }));
app.use(bodyParser.json());
// Twilio inbound webhooks POST application/x-www-form-urlencoded (MMS-003).
app.use(bodyParser.urlencoded({ extended: false }));

app.set("trust proxy", true);

// Structured per-request logging (FEAT-004) — mounted before route
// registration so it wraps every controller action.
app.use(requestLogging);

Routes.forEach(({ method, route, controller, action }) => {
  (app as any)[method](
    route,
    (req: Request, res: Response, next: NextFunction) => {
      // Capture the registered route pattern for request logging so log
      // lines stay low-cardinality (no raw URLs, no query strings).
      (req as any).routePattern = route;
      const result = new (controller as any)()[action](req, res, next);
      if (result instanceof Promise) {
        result
          .then((controllerResult) =>
            controllerResult !== null && controllerResult !== undefined
              ? res.send(controllerResult)
              : undefined,
          )
          .catch((e) => {
            next(e);
          });
      } else if (result !== null && result !== undefined) {
        res.json(result);
      }
    },
  );
});

addBugSnagErrorHandler(app);

export default app;
