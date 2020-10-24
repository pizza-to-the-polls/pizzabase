import fetch from "node-fetch";

import { Report } from "../entity/Report";
import { Order } from "../entity/Order";
import { Upload } from "../entity/Upload";
import { Truck } from "../entity/Truck";

enum ZapHooks {
  ZAP_NEW_REPORT = "ZAP_NEW_REPORT",
  ZAP_NEW_LOCATION = "ZAP_NEW_LOCATION",
  ZAP_NEW_ORDER = "ZAP_NEW_ORDER",
  ZAP_NEW_UPLOAD = "ZAP_NEW_UPLOAD",
  ZAP_ORDER_REPORT = "ZAP_ORDER_REPORT",
  ZAP_SKIP_REPORT = "ZAP_SKIP_REPORT",
  ZAP_TRUCK_REPORT = "ZAP_TRUCK_REPORT",
}

const zapReport = async (report: Report, hook: ZapHooks): Promise<void> =>
  zapAny(
    {
      report: report.asJSONPrivate(),
      location: await report.location.asJSONPrivate(),
      order: report.order?.asJSONPrivate(),
    },
    hook
  );

const zapOrder = async (order: Order, hook: ZapHooks): Promise<void> =>
  zapAny(
    {
      reports: (await order.reports).map((report) => report.asJSONPrivate()),
      location: await order.location.asJSONPrivate(),
      order: order.asJSONPrivate(),
    },
    hook
  );

const zapUpload = async (upload: Upload, hook: ZapHooks): Promise<void> =>
  zapAny(
    {
      location: await upload.location.asJSONPrivate(),
      upload: {
        filePath: upload.filePath,
        ipAddress: upload.ipAddress,
      },
    },
    hook
  );

const zapAny = async (objs: any, hook: ZapHooks): Promise<void> =>
  process.env[hook as string] &&
  (await fetch(process.env[hook as string], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hook, ...objs }),
  }));

export const zapNewReport = async (report: Report) =>
  zapReport(report, ZapHooks.ZAP_NEW_REPORT);
export const zapNewLocation = async (report: Report) =>
  zapReport(report, ZapHooks.ZAP_NEW_LOCATION);
export const zapNewOrder = async (order: Order, reports: Report[]) => {
  await zapOrder(order, ZapHooks.ZAP_NEW_ORDER);
  for (const report of reports) {
    await zapOrderReport(report);
  }
};
export const zapNewUpload = async (upload: Upload) =>
  zapUpload(upload, ZapHooks.ZAP_NEW_UPLOAD);
const zapOrderReport = async (report: Report) =>
  zapReport(report, ZapHooks.ZAP_ORDER_REPORT);
export const zapSkipReport = async (report: Report) =>
  zapReport(report, ZapHooks.ZAP_SKIP_REPORT);
export const zapTruckReport = async (report: Report) =>
  zapReport(report, ZapHooks.ZAP_TRUCK_REPORT);
