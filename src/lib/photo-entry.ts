/**
 * Rich photo entries for clip kits: each photo in a compilation (or single
 * clip) carries where it was taken and what was happening there — the
 * address of the polling place and the pizzas ordered around that time —
 * so the Zapier message can tell the story behind the photo.
 */

import { Between } from "typeorm";
import { Upload } from "../entity/Upload";
import { Order } from "../entity/Order";
import { uploadPermalink } from "./upload-permalink";

export interface ClipPhotoEntry {
  /** Public permalink to the photo (302s to the processed output). */
  url: string;
  /** Street address of the polling place, e.g. "5525 N Lark Ellen Ave". */
  address: string;
  city: string;
  state: string;
  /** Total pizzas ordered at this location around the submission (±2 days). */
  pizzas: number | null;
  /** Distinct restaurants those orders came from, comma-joined. */
  restaurant: string | null;
}

/** Orders at the location within ±2 days of the submission — the pizzas on
 * the ground when the photo was taken. Legacy submissions predate the
 * report→order link, so the location-window is the durable semantic. */
export async function photoEntryForUpload(
  upload: Upload,
): Promise<ClipPhotoEntry> {
  const location = upload.location;
  const since = new Date(new Date(upload.createdAt).getTime() - 2 * 86400000);
  const until = new Date(new Date(upload.createdAt).getTime() + 2 * 86400000);
  const orders = await Order.find({
    where: {
      location: { id: location.id },
      createdAt: Between(since, until),
    },
  });
  const pizzas = orders.reduce((sum, order) => sum + (order.quantity || 0), 0);
  const restaurants = [
    ...new Set(
      orders
        .map((order) => order.restaurant)
        .filter((r): r is string => typeof r === "string" && !!r),
    ),
  ];
  return {
    url: uploadPermalink(upload),
    address: location.address,
    city: location.city,
    state: location.state,
    pizzas: orders.length > 0 ? pizzas : null,
    restaurant: restaurants.length > 0 ? restaurants.join(", ") : null,
  };
}
