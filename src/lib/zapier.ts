import fetch from "node-fetch";

import { Report } from "../entity/Report";

export const zapNewReport = async (report: Report) => {
  const { location, ...rest } = report;

  await fetch(process.env.ZAP_NEW_REPORT, {
    ...rest,
    ...report.location,
  });
};
