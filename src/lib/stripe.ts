import Stripe from "stripe";

interface NewSubscription {
  type: "subscription";
  subscriptionTier: string;
  amountUsd: number;
  url: string;
  referrer?: string;
}

interface NewDonation {
  type: "donation";
  url: string;
  amountUsd: number;
  referrer?: string;
  giftName?: string;
  giftEmail?: string;
}

const initStripe = (maxNetworkRetries: number = 6, timeout: number = 5_000) =>
  new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2020-08-27",
    maxNetworkRetries,
    timeout,
  });

const processSubscription = async (body: NewSubscription): Promise<string> => {
  const { amountUsd, referrer, url } = body;
  const stripe = initStripe();

  const { data } = await stripe.prices.list({
    type: "recurring",
    active: true,
  });

  const { id: price } = data.find(
    ({ unit_amount }) => unit_amount === amountUsd * 100
  ) || { id: null };

  if (!price) throw new Error("Not a valid subscription level!");

  const { id } = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    shipping_address_collection: {
      allowed_countries: ["US"],
    },
    line_items: [
      {
        price,
        quantity: 1,
      },
    ],
    mode: "subscription",
    subscription_data: {
      metadata: {
        referrer,
        url,
      },
    },
    success_url: `${process.env.STATIC_SITE}/crustclub/?success=true&amount_usd=${amountUsd}`,
    cancel_url: `${
      (url || `${process.env.STATIC_SITE}/donate`).split("?")[0]
    }?amount_usd=${amountUsd}&type=subscription`,
  });

  return id;
};

const processDonation = async (body: NewDonation): Promise<string> => {
  const { amountUsd, url, referrer, giftName, giftEmail } = body;
  const isGift = giftName && giftEmail;

  const numberOfPizzas = Math.ceil(amountUsd / 20);

  const stripe = initStripe();

  const { id } = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: [
      {
        description: `${isGift ? "Gift of about" : "About"} ${numberOfPizzas} ${
          numberOfPizzas === 1 ? "pizza" : "pizzas"
        }`,
        price_data: {
          product: process.env.STRIPE_PRODUCT_ID,
          unit_amount: amountUsd * 100,
          currency: "usd",
        },
        quantity: 1,
      },
    ],
    mode: "payment",
    payment_intent_data: {
      metadata: {
        referrer,
        url,
        ...(isGift ? { giftName, giftEmail } : {}),
      },
    },
    success_url: `${process.env.STATIC_SITE}/${
      isGift ? "gift" : "donate"
    }/?success=true&amount_usd=${amountUsd}${
      isGift ? `&gift_name=${giftName}` : ""
    }`,
    cancel_url: `${process.env.STATIC_SITE}/${isGift ? "gift" : "donate"}/`,
  });

  return id;
};

export const findCustomer = async (email: string): Promise<string> => {
  const stripe = initStripe(6, 10_000);

  const {
    data: [customer],
  } = await stripe.customers.list({
    email,
  });
  const { id } = customer || { id: null };

  return id;
};

export const processWebhook = (
  body: string | Buffer,
  secret: string
): { event: any; type: string } => {
  const stripe = initStripe(3, 10_000);

  const {
    data: { object: event },
    type,
  } = stripe.webhooks.constructEvent(
    body,
    secret,
    process.env.STRIPE_SECRET_WH
  );

  return { event, type };
};

export const sessionForCheckout = async (
  incoming: NewDonation | NewSubscription
): Promise<string | null> => {
  switch (incoming.type) {
    case "donation":
      return await processDonation(incoming);
    case "subscription":
      return await processSubscription(incoming);
    default:
      console.error(`Unhandled event type`);
  }
};

export const sessionForPortal = async (id: string): Promise<string> => {
  const stripe = initStripe(6, 10_000);

  const { url } = await stripe.billingPortal.sessions.create({
    customer: id,
    return_url: `${process.env.STATIC_SITE}/crustclub`,
  });
  return url;
};
