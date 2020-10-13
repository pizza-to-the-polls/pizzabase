import fetch from "node-fetch";

import { Report } from "../entity/Report";

const zapReport = async (report: Report, url: string): Promise<void> =>
  url &&
  (await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      report: report.asJSONPrivate(),
      location: report.location.asJSON(),
    }),
  }));

export const zapNewReport = async (report: Report) =>
  zapReport(report, process.env.ZAP_NEW_REPORT);
export const zapNewLocation = async (report: Report) =>
  zapReport(report, process.env.ZAP_NEW_LOCATION);
