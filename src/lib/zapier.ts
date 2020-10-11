import fetch from "node-fetch";

import { Report } from "../entity/Report";
import { toStateName } from "./states";

export const zapNewReport = async (report: Report) => {
  const { location, ...rest } = report;

  await fetch(process.env.ZAP_NEW_REPORT, {
    ...rest,
    ...report.location,
    stateName: toStateName(report.location.state),
  });
};
