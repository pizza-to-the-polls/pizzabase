import { MoreThan, createConnection } from "typeorm";
import { Report } from "../src/entity/Report";

const sendText = async (to) =>
  await fetch(process.env[ZAP_SEND_MESSAGE], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      To: `+1${contactInfo}`,
      From: "+15412307211",
      Body: `Hey it's Pizza to the Polls!
Sorry we missed sending you some za yesterday, our 🍕🤖 was misbehavin.
Definitely hit us up next time you're in a line and thanks for being a voter.`,
    }),
  });

const resendHooks = async (since?: string): Promise<void> => {
  await createConnection();

  const after = since || `${new Date().toISOString()}`.split("T")[0];
  const before = new Date(new Date().valueOf() + 60 * 60 * 24 * 1000);

  const reports = await Report.find({
    where: { createdAt: MoreThan(new Date(after)) },
  });

  await Promise.all(
    reports
      .filter((report) => !report.order && report.createdAt < before)
      .map(({ contactInfo }) => sendText(contactInfo))
  );
};

(async () => {
  await resendHooks(process.argv[2]);
})();
