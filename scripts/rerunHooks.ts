import { MoreThan, createConnection } from "typeorm";
import { Report } from "../src/entity/Report";
import { zapNewReport, zapNewLocation } from "../src/lib/zapier";

const resendHooks = async (since?: string): Promise<void> => {
  await createConnection();

  const after = since || `${new Date().toISOString()}`.split("T")[0];

  const reports = await Report.find({
    where: { createdAt: MoreThan(new Date(after)) },
  });

  await Promise.all(
    reports.map((report) =>
      report.location.validatedAt
        ? zapNewReport(report)
        : zapNewLocation(report)
    )
  );
};

(async () => {
  await resendHooks(process.argv[2]);
})();
