import "reflect-metadata";
import { initializeDataSource } from "./data-source";
import { Order } from "./entity/Order";
import { socialPost } from "./lib/social";

/**
 * Standalone Lambda handler for asynchronous social media posting.
 *
 * Called by the main app Lambda via InvocationType.Event (fire-and-forget).
 * The handler lazily initializes the DataSource so it survives across
 * container reuse (same pattern as refresh-threads-token).
 *
 * Idempotency note: an Event invocation may be redelivered by AWS. We
 * currently accept duplicate posts (the old in-process fire-and-forget had
 * the same exposure). A future improvement could guard by checking an
 * order-level "posts already fired" flag, but adding a "postsSentAt"
 * column to the Order entity and a quick check here is deferred.
 */

let dataSourcePromise: Promise<unknown> | null = null;

function getDataSource(): Promise<unknown> {
  if (!dataSourcePromise) {
    dataSourcePromise = initializeDataSource();
  }
  return dataSourcePromise;
}

export async function handler(event: {
  orderId: number;
}): Promise<{ success: boolean; orderId: number }> {
  await getDataSource();

  const order = await Order.findOne({ where: { id: event.orderId } });
  if (!order) {
    console.error(`onSocialPost: order ${event.orderId} not found`);
    return { success: false, orderId: event.orderId };
  }

  await socialPost(order);

  return { success: true, orderId: event.orderId };
}
