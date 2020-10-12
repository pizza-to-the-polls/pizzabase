import fetch from "node-fetch";

import { Report } from "../entity/Report";
import { toStateName } from "./states";

const zapReport = async (report: Report, url: string) => {
  const { location, ...rest } = report;

  await fetch(url, {
    ...rest,
    ...report.location,
    stateName: toStateName(report.location.state),
  });
};

export const zapNewReport = async (report: Report) =>
  zapReport(report, process.env.ZAP_NEW_REPORT);
export const zapNewLocation = async (report: Report) =>
  zapReport(report, process.env.ZAP_NEW_LOCATION);
