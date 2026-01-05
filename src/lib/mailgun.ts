import Mailgun from "mailgun.js";
import FormData from "form-data";

const sendMGTemplate = async ({
  from,
  subject,
  template,
  to,
  data,
}: {
  from: string;
  subject: string;
  template: string;
  to: string;
  data: { [id: string]: string };
}) => {
  const mailgun = new Mailgun(FormData);
  const client = mailgun.client({
    username: "api",
    key: process.env.MAILGUN_API_KEY,
  });

  const messageData = {
    from,
    to,
    subject,
    template,
    "h:X-Mailgun-Variables": JSON.stringify(data),
  };

  await client.messages.create("polls.pizza", messageData);
};

export const sendCrustClubEmail = async (to: string, data: { token: string }) =>
  await sendMGTemplate({
    from: "Crust Club @ Pizza to the Polls<crustclub@polls.pizza>",
    subject: "Log into Crust Club",
    template: "crust-club-log-in",
    to,
    data,
  });

export const sendNoMembershipFoundEmail = async (
  to: string,
  data: { email: string }
) =>
  await sendMGTemplate({
    from: "Crust Club @ Pizza to the Polls<crustclub@polls.pizza>",
    subject: "Couldn't Find Your Membership",
    template: "crust-club-no-membership",
    to,
    data,
  });
