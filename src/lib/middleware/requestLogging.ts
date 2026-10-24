import { Request, Response, NextFunction } from "express";

/**
 * Per-request structured logging middleware.
 *
 * Emits exactly one JSON line per HTTP request when the response finishes,
 * e.g.:
 *   {"event":"http_request","method":"post","route":"/reports","status":422,"durationMs":1234}
 *
 * The route is the registered route pattern (e.g. "/locations/:idOrAddress"),
 * captured by the per-route closure in app.ts via `req.routePattern`. When
 * absent, it falls back to `req.path`/`req.url` with any query string
 * stripped, keeping log lines low-cardinality and PII-free.
 *
 * NEVER logs request or response bodies — they contain phone numbers,
 * contact names, and addresses.
 */
export const requestLogging = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const start = Date.now();
  const method = req.method.toLowerCase();

  res.on("finish", () => {
    const route =
      (req as any).routePattern ?? req.path ?? req.url?.split("?")[0] ?? "/";

    console.log(
      JSON.stringify({
        event: "http_request",
        method,
        route,
        status: res.statusCode,
        durationMs: Date.now() - start,
      }),
    );
  });

  next();
};
