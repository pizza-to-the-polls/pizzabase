/**
 * Lambda integration test adapter.
 *
 * Sends requests through the EXACT production execution path:
 *   API Gateway event → serverless-http → Express app → Routes → Controllers
 *
 * Why this matters:
 *   - Tests middleware: CORS, body-parser raw (webhooks), Bugsnag
 *   - Tests routing: URL params, query strings, 404s
 *   - Tests response serialization: JSON, status codes, headers
 *   - Tests the handler Promise pattern: first call = cold start, rest = warm
 */

import serverlessHttp from "serverless-http";

let cachedHandlerPromise: Promise<
  ReturnType<typeof serverlessHttp>
> | null = null;

/**
 * Lazy handler initialization with deferred app import.
 *
 * By importing the Express app dynamically inside the handler promise,
 * we guarantee that jest.setup.ts (which runs beforeAll first) has had
 * a chance to set env vars like ALLOWED_ORIGINS before app.ts reads them.
 */
export const getHandler = async (): Promise<
  ReturnType<typeof serverlessHttp>
> => {
  if (!cachedHandlerPromise) {
    cachedHandlerPromise = (async () => {
      // DB is already initialized by jest.setup.ts beforeAll().
      // We defer the Express app import until here so env vars
      // (like ALLOWED_ORIGINS) are set before app.ts reads them.
      const appModule = await import("../app");
      const app = appModule.default || appModule;

      return serverlessHttp(app);
    })();
  }
  return cachedHandlerPromise;
};

// ── Event factory ──────────────────────────────────────────────

const makeEvent = (
  method: string,
  path: string,
  body?: object,
  headers?: Record<string, string>
): any => ({
  httpMethod: method,
  path,
  headers: body
    ? { "Content-Type": "application/json", ...headers }
    : headers || {},
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  pathParameters: null,
  stageVariables: null,
  requestContext: {
    requestId: `test-${Date.now()}-${Math.random()}`,
    identity: { sourceIp: "127.0.0.1" },
  } as any,
  resource: "",
  multiValueHeaders: {},
  isBase64Encoded: false,
  body: body ? JSON.stringify(body) : null,
});

const makeContext = (): any => ({
  awsRequestId: `test-${Date.now()}`,
  functionName: "pizzabase-dev-app",
  memoryLimitInMB: "1024",
  invokedFunctionArn:
    "arn:aws:lambda:us-west-2:123456789:function:pizzabase-dev-app",
  getRemainingTimeInMillis: () => 30000,
  done: () => undefined,
  fail: () => undefined,
  succeed: () => undefined,
});

// ── Public API ─────────────────────────────────────────────────

export const lambdaRequest = async (
  method: string,
  path: string,
  body?: object,
  headers?: Record<string, string>
): Promise<any> => {
  const handler = await getHandler();
  return handler(makeEvent(method, path, body, headers), makeContext());
};

export const lambdaGet = (path: string, headers?: Record<string, string>) =>
  lambdaRequest("GET", path, undefined, headers);

export const lambdaPost = (
  path: string,
  body: object,
  headers?: Record<string, string>
) => lambdaRequest("POST", path, body, headers);

export const lambdaPut = (
  path: string,
  body: object,
  headers?: Record<string, string>
) => lambdaRequest("PUT", path, body, headers);

export const lambdaDelete = (path: string, headers?: Record<string, string>) =>
  lambdaRequest("DELETE", path, undefined, headers);
