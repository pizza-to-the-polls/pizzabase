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
  data: { email: string },
) =>
  await sendMGTemplate({
    from: "Crust Club @ Pizza to the Polls<crustclub@polls.pizza>",
    subject: "Couldn't Find Your Membership",
    template: "crust-club-no-membership",
    to,
    data,
  });

const sendPlainText = async ({
  from,
  subject,
  text,
  to,
}: {
  from: string;
  subject: string;
  text: string;
  to: string;
}) => {
  const mailgun = new Mailgun(FormData);
  const client = mailgun.client({
    username: "api",
    key: process.env.MAILGUN_API_KEY,
  });

  await client.messages.create("polls.pizza", {
    from,
    to,
    subject,
    text,
  });
};

export const sendPartnerLoginEmail = async (
  to: string,
  { link }: { link: string },
) =>
  await sendPlainText({
    from: "Pizza to the Polls <partners@polls.pizza>",
    subject: "Your partner report sign-in link",
    to,
    text: [
      "Hello!",
      "",
      "Click the link below to open the trusted partner report form. The link is valid for 24 hours — you can always request a fresh one from the page.",
      "",
      link,
      "",
      "If you didn't request this link, you can ignore this email.",
      "",
      "— Pizza to the Polls",
    ].join("\n"),
  });

/**
 * Welcome email for a newly approved partner (users row created via the
 * admin API — pizza-eagle adds partners on request). Sent from
 * UsersController.create on every sanctioned create path; never sent by
 * the migration seed (raw SQL, no controller).
 *
 * Points at the sign-in page rather than a minted token on purpose: a
 * welcome may be opened days later, and an expired magic link is a broken
 * first experience. The page is evergreen — enter email, get a fresh link.
 */
export const sendPartnerWelcomeEmail = async (
  to: string,
  { organization }: { organization?: string | null },
) =>
  await sendPlainText({
    from: "Pizza to the Polls <partners@polls.pizza>",
    subject: "You're approved as a Pizza to the Polls partner",
    to,
    text: [
      "Good news — you're approved as a trusted partner of Pizza to the Polls" +
        (organization ? ` (${organization})` : "") +
        ".",
      "",
      "What that means: when you report a line at a polling location, it skips our review queue and goes straight to the team that sends the pizza.",
      "",
      "To file a report:",
      "1. Visit " +
        (process.env.STATIC_SITE || "https://polls.pizza") +
        "/partners/report",
      "2. Enter your email — we'll send you a sign-in link, no password needed (links are valid for 24 hours, and you can always request a fresh one)",
      "3. Pick the polling location and how long the wait is — that's all we need. Photos and on-site contact info are optional.",
      "",
      "You can file as many reports as you need during a shift, and each one is attributed to you.",
      "",
      "If you weren't expecting this, you can ignore this email.",
      "",
      "— Pizza to the Polls",
    ].join("\n"),
  });
