import { Donation } from "../src/entity/Donation";
import * as Stripe from "stripe"
// See Stripe documentation here: https://stripe.com/docs/api/charges/list?lang=node

const stripe = Stripe(process.env.STRIPE_KEY);
const maxChargesPerPage = 100; // 1 to 100

(async () => {
  // Stripe orders charges from most recent to oldest.
  // Get the most recent transactions.
  let charges = await stripe.charges.list({
    limit: maxChargesPerPage,
  });

  // Paginate until we run out of transactions.
  while (charges.data.length > 0) {
    for (const index of charges.data) {
      const charge = charges.data[index];
      console.log(charge.id);
      // save the charge if not refunded
      if (charge.amount > 0 && charge.amount_refunded === 0) {
        const donation = await Donation.succeedCharge(charge);
        donation.createdAt = charge.created;
        donation.updatedAt = charge.created;
        donation.save();
      }
    }
    // Get the next page.
    console.log("Getting Next page");
    charges = await stripe.charges.list({
      limit: maxChargesPerPage,
      starting_after: charges.data[charges.data.length - 1].id,
    });
  }
})();
