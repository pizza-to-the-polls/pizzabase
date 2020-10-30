import { Donation } from "../src/entity/Donation";

// See Stripe documentation here: https://stripe.com/docs/api/charges/list?lang=node

const stripe = require('stripe')('sk_test_23aRsCkc4f9KwNcYm5fKUtQY');
const maxChargesPerPage = 100; // 1 to 100

(async () => {
  // Stripe orders charges from most recent to oldest.
  // Get the most recent transactions.
  let charges = await stripe.charges.list({
    limit: maxChargesPerPage,
  });

  // Paginate until we run out of transactions.
  while (charges.data.length > 0) {
    for (let index in charges.data) {
      let charge = charges.data[index];
      console.log(charge.id);
      // save the charge
      if (charge.amount_captured > 0) {
        Donation.succeedCharge(charge);
      }
    }
    // Get the next page. 
    console.log("Getting Next page");
    charges = await stripe.charges.list({
      limit: maxChargesPerPage,
      starting_after: charges.data[charges.data.length - 1].id
    });
  }
})();