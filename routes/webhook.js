const express = require('express');
const Stripe = require('stripe');
const db = require('../db');

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Must receive the RAW body — see server.js mounting order.
router.post('/', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orderId = session.metadata?.order_id;

    if (orderId) {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);

      if (order && order.status === 'pending') {
        const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);

        const updateStock = db.prepare(
          'UPDATE product_variants SET stock_qty = stock_qty - ? WHERE id = ?'
        );
        const tx = db.transaction(() => {
          for (const item of items) {
            updateStock.run(item.quantity, item.variant_id);
          }
          db.prepare("UPDATE orders SET status = 'paid', updated_at = datetime('now') WHERE id = ?").run(orderId);
        });
        tx();

        console.log(`Order ${orderId} marked paid, variant stock decremented.`);
      }
    }
  }

  res.json({ received: true });
});

module.exports = router;
