import { invokeSocialPost } from "./invoke-social-post";
import {
  LambdaClient,
  InvokeCommand,
  InvocationType,
} from "@aws-sdk/client-lambda";

// `mockSend` is referenced from the hoisted jest.mock factory below. Jest only
// allows out-of-scope references whose name begins with "mock", and the
// reference is safe despite hoisting: the factory merely creates a closure
// around it — the variable is only *read* when `send` is invoked during a
// test, long after the top-level initialization has run.
const mockSend = jest.fn();

jest.mock("@aws-sdk/client-lambda", () => ({
  // The client in invoke-social-post.ts is a module-level singleton created
  // once at import time, so per-test reconfiguration must go through this
  // delegation rather than re-implementing the constructor.
  LambdaClient: jest.fn().mockImplementation(() => ({
    send: (...args: unknown[]) => mockSend(...args),
  })),
  // Echo the arguments so tests can inspect the command object passed to
  // `send`.
  InvokeCommand: jest.fn().mockImplementation((args: unknown) => args),
  InvocationType: { Event: "Event" },
}));

const MockLambdaClient = LambdaClient as unknown as jest.Mock;
const MockInvokeCommand = InvokeCommand as unknown as jest.Mock;

describe("invokeSocialPost", () => {
  beforeEach(() => {
    mockSend.mockReset().mockResolvedValue(undefined);
    MockLambdaClient.mockClear();
    MockInvokeCommand.mockClear();
  });

  it("invokes the onSocialPost Lambda with InvocationType.Event", async () => {
    await invokeSocialPost(42);

    expect(MockInvokeCommand).toHaveBeenCalledTimes(1);
    expect(MockInvokeCommand).toHaveBeenCalledWith({
      FunctionName: expect.stringContaining("onSocialPost"),
      InvocationType: InvocationType.Event,
      Payload: new TextEncoder().encode(JSON.stringify({ orderId: 42 })),
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(
      MockInvokeCommand.mock.results[0].value,
    );
  });

  it("uses SOCIAL_POST_FUNCTION_NAME env var when set", async () => {
    const original = process.env.SOCIAL_POST_FUNCTION_NAME;
    process.env.SOCIAL_POST_FUNCTION_NAME = "my-custom-func";
    try {
      await invokeSocialPost(7);

      expect(MockInvokeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          FunctionName: "my-custom-func",
        }),
      );
    } finally {
      if (original === undefined) {
        delete process.env.SOCIAL_POST_FUNCTION_NAME;
      } else {
        process.env.SOCIAL_POST_FUNCTION_NAME = original;
      }
    }
  });

  it("falls back to the default function name when env var is unset", async () => {
    const original = process.env.SOCIAL_POST_FUNCTION_NAME;
    delete process.env.SOCIAL_POST_FUNCTION_NAME;
    try {
      await invokeSocialPost(5);

      expect(MockInvokeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          FunctionName: expect.stringContaining("onSocialPost"),
        }),
      );
    } finally {
      if (original !== undefined) {
        process.env.SOCIAL_POST_FUNCTION_NAME = original;
      }
    }
  });

  it("logs but does not throw when invoke fails", async () => {
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    mockSend.mockRejectedValueOnce(new Error("Internal error"));

    await expect(invokeSocialPost(1)).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });
});
