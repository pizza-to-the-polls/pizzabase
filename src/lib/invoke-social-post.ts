import {
  LambdaClient,
  InvokeCommand,
  InvocationType,
} from "@aws-sdk/client-lambda";

const client = new LambdaClient({ region: "us-west-2" });
const DEFAULT_FUNCTION_NAME = "pizzabase-dev-onSocialPost";

function getFunctionName(): string {
  return process.env.SOCIAL_POST_FUNCTION_NAME ?? DEFAULT_FUNCTION_NAME;
}

/**
 * Invoke the social-post Lambda asynchronously (fire-and-forget).
 *
 * Uses InvocationType.Event so the caller gets an immediate 202-style
 * response from AWS and the social-post Lambda runs independently.
 */
export async function invokeSocialPost(orderId: number): Promise<void> {
  const command = new InvokeCommand({
    FunctionName: getFunctionName(),
    InvocationType: InvocationType.Event,
    Payload: new TextEncoder().encode(JSON.stringify({ orderId })),
  });

  try {
    await client.send(command);
    console.log(`invokeSocialPost: invoked for order ${orderId}`);
  } catch (err) {
    // Log but never throw — this is already fire-and-forget; the order
    // placement has already succeeded. A failed invocation means the post
    // won't happen, but the caller gets their response.
    console.error(
      `invokeSocialPost: failed to invoke for order ${orderId}:`,
      err,
    );
  }
}
