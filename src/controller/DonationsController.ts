import { NextFunction, Request, Response } from "express";
import Stripe from 'stripe';

export class DonationsController {
  async create(request: Request, _response: Response, _next: NextFunction) {
    const {
      amountUsd,
      referrer
    } = request.body;

    const numberOfPizzas = Math.ceil(amountUsd / 20);
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: '2020-08-27',
      });    

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          description: `About ${numberOfPizzas} ${numberOfPizzas === 1 ? 'pizza' : 'pizzas'}`,
          price_data: {
            product: process.env.DONATION_PRODUCT_ID,
            unit_amount: amountUsd * 100,
            currency: 'usd',
          },
          quantity: 1,
        }],
        mode: 'payment',
        metadata: {
          referrer
        },
        success_url: `${process.env.CLIENT_APP_URL}/donate?success=true&amount_usd=${amountUsd}`,
        cancel_url: `${process.env.CLIENT_APP_URL}/donate`,
      });        
        
      return { success: true, checkoutSessionId: session.id };
    } catch (e) {
      console.error(e);
      return {success: false }
    }
  }
}
