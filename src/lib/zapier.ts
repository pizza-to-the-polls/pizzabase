import fetch from "node-fetch";

import { Report } from "../entity/Report";
import { Order } from "../entity/Order";
import { Upload } from "../entity/Upload";
import { Truck } from "../entity/Truck";

enum ZapHooks {
  ZAP_NEW_REPORT = "ZAP_NEW_REPORT",
  ZAP_NEW_LOCATION = "ZAP_NEW_LOCATION",
  ZAP_NEW_ORDER = "ZAP_NEW_ORDER",
  ZAP_NEW_TRUCK = "ZAP_NEW_TRUCK",
  ZAP_NEW_UPLOAD = "ZAP_NEW_UPLOAD",
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
    hook
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

const zapTruck = async (truck: Truck, hook: ZapHooks): Promise<void> =>
  zapAny(
    {
      ...truck.asJSON(),
      location: await truck.location.asJSONPrivate(),
      reports: (await truck.reports).map((report) => report.asJSONPrivate()),
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
const zapOrderReport = async (report: Report) =>
  zapReport(report, ZapHooks.ZAP_ORDER_REPORT);
export const zapCancelOrderReport = async (report: Report) =>
  zapReport(report, ZapHooks.ZAP_CANCEL_ORDER_REPORT);
export const zapSkipReport = async (report: Report) =>
  zapReport(report, ZapHooks.ZAP_SKIP_REPORT);
const zapTruckReport = async (report: Report) =>
  zapReport(report, ZapHooks.ZAP_TRUCK_REPORT);
