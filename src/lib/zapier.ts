import { Report } from "../entity/Report";
import { Order } from "../entity/Order";
import { Upload } from "../entity/Upload";
import { Truck } from "../entity/Truck";
import { cdnUrlFromStoredUrl } from "./media-cdn";

enum ZapHooks {
  ZAP_NEW_REPORT = "ZAP_NEW_REPORT",
  ZAP_NEW_LOCATION = "ZAP_NEW_LOCATION",
  ZAP_NEW_ORDER = "ZAP_NEW_ORDER",
  ZAP_NEW_TRUCK = "ZAP_NEW_TRUCK",
  ZAP_NEW_UPLOAD = "ZAP_NEW_UPLOAD",
  ZAP_NEW_MMS_UPLOAD = "ZAP_NEW_MMS_UPLOAD",
  ZAP_ORDER_REPORT = "ZAP_ORDER_REPORT",
  ZAP_CANCEL_ORDER_REPORT = "ZAP_CANCEL_ORDER_REPORT",
  ZAP_SKIP_REPORT = "ZAP_SKIP_REPORT",
  ZAP_TRUCK_REPORT = "ZAP_TRUCK_REPORT",
}

const zapReport = async (report: Report, hook: ZapHooks): Promise<void> =>
  zapAny(
    {
      report: report.asJSONPrivate(),
      location: await report.location.asJSONPrivate(),
      order: report.order
        ? {
            ...report.order.asJSONPrivate(),
            distributor: await report.order.distributor(),
          }
        : undefined,
      truck: report.truck ? report.truck.asJSON() : undefined,
    },
    hook,
  );

const zapOrder = async (order: Order, hook: ZapHooks): Promise<void> =>
  zapAny(
    {
      reports: (await order.reports).map((report) => report.asJSONPrivate()),
      location: await order.location.asJSONPrivate(),
      order: {
        ...order.asJSONPrivate(),
        distributor: await order.distributor(),
      },
    },
    hook,
  );

const zapUpload = async (upload: Upload, hook: ZapHooks): Promise<void> =>
  zapAny(
    {
      location: await upload.location.asJSONPrivate(),
      upload: {
        filePath: upload.filePath,
        ipAddress: upload.ipAddress,
        // Stable permalink (302s to the processed output) — the legacy
        // filePath key sits in the private raw bucket and no longer serves.
        permalink: `${process.env.PIZZABASE_API_URL || "https://base.polls.pizza"}/uploads/${upload.filePath.split("/").pop()}`,
      },
    },
    hook,
  );

const zapTruck = async (truck: Truck, hook: ZapHooks): Promise<void> =>
  zapAny(
    {
      ...truck.asJSON(),
      location: await truck.location.asJSONPrivate(),
      reports: (await truck.reports).map((report) => report.asJSONPrivate()),
    },
    hook,
  );

const zapAny = async (objs: any, hook: ZapHooks): Promise<void> => {
  if (process.env[hook as string]) {
    await fetch(process.env[hook as string], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hook, ...objs }),
    });
  }
};

/**
 * Form-encoded variant of zapAny for hooks whose Zap expects
 * application/x-www-form-urlencoded rather than a JSON body. Fields are
 * flat key/value pairs; `hook` rides along as the first pair so the Zap can
 * route on it exactly like the JSON hooks do.
 */
const zapAnyForm = async (
  fields: Record<string, string>,
  hook: ZapHooks,
): Promise<void> => {
  if (!process.env[hook as string]) return;

  const params = new URLSearchParams();
  params.append("hook", hook);
  for (const [key, value] of Object.entries(fields)) {
    if (value != null) params.append(key, value);
  }

  await fetch(process.env[hook as string], {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
};

export const zapNewReport = async (report: Report) =>
  zapReport(report, ZapHooks.ZAP_NEW_REPORT);
export const zapNewLocation = async (report: Report) =>
  zapReport(report, ZapHooks.ZAP_NEW_LOCATION);
export const zapNewOrder = async (order: Order) => {
  await zapOrder(order, ZapHooks.ZAP_NEW_ORDER);
  const reports = await Report.find({
    where: { order: { id: order.id } },
    relations: ["location"],
  });

  for (const report of reports) {
    await zapOrderReport(report);
  }
};
export const zapNewTruck = async (truck: Truck) => {
  await zapTruck(truck, ZapHooks.ZAP_NEW_TRUCK);
  const reports = await Report.find({
    where: { truck: { id: truck.id } },
    relations: ["location"],
  });

  for (const report of reports) {
    await zapTruckReport(report);
  }
};
export const zapNewUpload = async (upload: Upload) =>
  zapUpload(upload, ZapHooks.ZAP_NEW_UPLOAD);

// Only these processedFilePath keys are CDN-served processed outputs.
// `jobId` (mid-transcode bookkeeping) and anything unknown are excluded.
const PROCESSED_MEDIA_KEYS = new Set(["webp", "jpeg", "jpg", "mp4", "gif"]);

/**
 * ZAP_NEW_MMS_UPLOAD — notify an internal channel when MMS reply media
 * finishes the async pipeline (MMS-004, epic #255). The Zap on the other
 * end of the hook routes the payload to the internal channel.
 *
 * Safety properties:
 *   - No-op unless ZAP_NEW_MMS_UPLOAD is configured (env-optional zapAny).
 *   - Only MMS-origin uploads notify; web uploads keep using zapNewUpload.
 *   - Flagged/rejected uploads never notify — a human reviews those in Retool.
 *   - Only processed (EXIF-scrubbed) CDN URLs are shared, never raw paths.
 *   - Failures are swallowed: a Zapier outage must never break the media
 *     pipeline lambdas (logged only, no Bugsnag — non-critical).
 */
export const zapNewMmsUpload = async (upload: Upload): Promise<void> => {
  if (upload.source !== "mms") return;

  // Flagged/rejected media is reviewed by a human in Retool — never notify.
  if (
    upload.moderationStatus === "flagged" ||
    upload.moderationStatus === "rejected"
  ) {
    return;
  }

  try {
    // The report relation is not eager — lambda call sites load uploads
    // without it, so reload when the report isn't already attached. It may
    // legitimately be null (nullable relation, onDelete SET NULL).
    let report = upload.report ?? null;
    if (upload.id != null && !report) {
      const loaded = await Upload.findOne({
        where: { id: upload.id },
        relations: ["report"],
      });
      report = loaded?.report ?? null;
    }

    // Report.order is eager, so whenever a report resolved above, its order
    // (if any) came along. Include the order details (pizzas sent,
    // restaurant) so the internal channel gets full context.
    const order = report?.order ?? null;

    const processed = (upload.processedFilePath || {}) as Record<
      string,
      string
    >;
    const mediaLinks = Object.entries(processed)
      .filter(([key]) => PROCESSED_MEDIA_KEYS.has(key))
      .map(([, stored]) => cdnUrlFromStoredUrl(stored))
      .filter((url): url is string => Boolean(url));

    // ZAP_NEW_MMS_UPLOAD's Zap consumes a form-encoded (flat) body, not
    // JSON — send every key on every call (empty string for absent
    // values) so Zapier field mappings stay stable across events.
    const location = upload.location;
    await zapAnyForm(
      {
        upload_id: String(upload.id),
        source: upload.source,
        source_phone: upload.sourcePhone ?? "",
        media_status: upload.mediaStatus ?? "",
        moderation_status: upload.moderationStatus ?? "",
        sightengine_score:
          upload.sightengineScore != null
            ? String(upload.sightengineScore)
            : "",
        report_id: report ? String(report.id) : "",
        report_url: report?.reportURL ?? "",
        ...(order
          ? {
              pizzas: String(order.quantity),
              restaurant: order.restaurant ?? "",
              order_type: order.orderType,
              order_created_at: String(order.createdAt),
              order_cancelled_at: order.cancelledAt
                ? String(order.cancelledAt)
                : "",
            }
          : {
              pizzas: "",
              restaurant: "",
              order_type: "",
              order_created_at: "",
              order_cancelled_at: "",
            }),
        location_full_address: location.fullAddress,
        location_city: location.city,
        location_state: location.state,
        media_links: mediaLinks.join(","),
      },
      ZapHooks.ZAP_NEW_MMS_UPLOAD,
    );
  } catch (err) {
    // Swallowed deliberately: Zapier being down must never break the media
    // pipeline, and this integration is too non-critical for Bugsnag noise.
    console.error(
      "[zap-new-mms-upload] Zapier notify failed (swallowed):",
      err,
    );
  }
};
const zapOrderReport = async (report: Report) =>
  zapReport(report, ZapHooks.ZAP_ORDER_REPORT);
export const zapCancelOrderReport = async (report: Report) =>
  zapReport(report, ZapHooks.ZAP_CANCEL_ORDER_REPORT);
export const zapSkipReport = async (report: Report) =>
  zapReport(report, ZapHooks.ZAP_SKIP_REPORT);
const zapTruckReport = async (report: Report) =>
  zapReport(report, ZapHooks.ZAP_TRUCK_REPORT);
