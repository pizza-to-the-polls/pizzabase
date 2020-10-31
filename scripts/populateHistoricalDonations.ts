import { createConnection, getConnection } from "typeorm";
import Stripe from "stripe";

import { Donation } from "../src/entity/Donation";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2020-08-27",
});
const maxChargesPerPage = 100; // 1 to 100

(async () => {
  await createConnection();
  const { manager } = await getConnection();

  // Stripe orders charges from most recent to oldest.
  // Get the most recent transactions.
  let charges = await stripe.charges.list({
    limit: maxChargesPerPage,
  });
  const errors = [];

  // Paginate until we run out of transactions.
  while (charges.data.length > 0) {
    for (const charge of charges.data) {
      // save the charge if not refunded
      if (charge.amount > 0 && charge.amount_refunded === 0) {
        console.log(charge.id);
        if ((await Donation.count({ where: { stripeId: charge.id } })) === 0) {
          try {
            const donation = await Donation.succeedCharge(charge);
            const donated = new Date(charge.created * 1000);
            await manager.query(`
                  UPDATE donations SET created_at = '${donated.toISOString()}', updated_at = '${donated.toISOString()}' WHERE id = ${
              donation.id
            }
                `);
          } catch (e) {
            console.error(e);
            errors.push(charge);
            console.warn(`Could not process ${errors.length}`);
          }
        } else {
          console.error("skipped");
        }
      }
    }
    // Get the next page.
    console.log("Getting Next page");
    charges = await stripe.charges.list({
      limit: maxChargesPerPage,
      starting_after: charges.data[charges.data.length - 1].id,
    });
  }
  console.error(JSON.stringify(errors));
})();
