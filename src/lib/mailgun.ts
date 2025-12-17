import mailgun = require("mailgun-js");

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
  const mg = mailgun({
    apiKey: process.env.MAILGUN_API_KEY,
    domain: "polls.pizza",
  });

  await new Promise((resolve, reject) => {
    mg.messages().send(
      {
        from,
        subject,
        template,
        "h:X-Mailgun-Variables": JSON.stringify(data),
        to,
      },
      (error, body) => {
        error ? reject(error) : resolve(body);
      }
    );
  });
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
