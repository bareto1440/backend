const express = require('express');
const Stripe = require('stripe');
const jwt = require('jsonwebtoken');
const db = require('../db');

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Optional auth: attach user if a valid token is present, but don't require it (guest checkout allowed)
function attachUserIfPresent(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

// POST /checkout  { items: [{ variant_id, quantity }], buyer_email }
router.post('/', async (req, res) => {
  const user = attachUserIfPresent(req);
  const { items, buyer_email } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array' });
  }

  const lineItems = [];
  const orderItemsToInsert = [];
  let totalCents = 0;
  let currency = process.env.CURRENCY || 'usd';

  for (const { variant_id, quantity } of items) {
    if (!variant_id || !quantity || quantity < 1) {
      return res.status(400).json({ error: 'Each item needs variant_id and quantity >= 1' });
    }

    const variant = db
      .prepare(
        `SELECT product_variants.*, products.name as product_name, products.currency as product_currency
         FROM product_variants
         JOIN products ON products.id = product_variants.product_id
         WHERE product_variants.id = ? AND product_variants.is_active = 1 AND products.is_active = 1`
      )
      .get(variant_id);

    if (!variant) {
      return res.status(404).json({ error: `Variant ${variant_id} not found or unavailable` });
    }
    if (variant.stock_qty < quantity) {
      return res.status(409).json({ error: `Not enough stock for "${variant.product_name}"` });
    }

    currency = variant.product_currency || currency;
    totalCents += variant.price_cents * quantity;

    const variantLabel = [variant.size, variant.color].filter(Boolean).join(' / ') || null;

    lineItems.push({
      price_data: {
        currency: variant.product_currency || currency,
        product_data: {
          name: variantLabel ? `${variant.product_name} (${variantLabel})` : variant.product_name,
        },
        unit_amount: variant.price_cents,
      },
      quantity,
    });

    orderItemsToInsert.push({
      variant_id: variant.id,
      product_name: variant.product_name,
      variant_label: variantLabel,
      unit_price_cents: variant.price_cents,
      quantity,
    });
  }

  const orderResult = db
    .prepare(
      `INSERT INTO orders (user_id, buyer_email, status, total_cents, currency)
       VALUES (?, ?, 'pending', ?, ?)`
    )
    .run(user ? user.sub : null, buyer_email || (user ? user.email : null), totalCents, currency);

  const orderId = orderResult.lastInsertRowid;

  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, variant_id, product_name, variant_label, unit_price_cents, quantity)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const item of orderItemsToInsert) {
    insertItem.run(orderId, item.variant_id, item.product_name, item.variant_label, item.unit_price_cents, item.quantity);
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      customer_email: buyer_email || (user ? user.email : undefined),
      success_url: `${process.env.FRONTEND_SUCCESS_URL}?order_id=${orderId}`,
      cancel_url: process.env.FRONTEND_CANCEL_URL,
      metadata: { order_id: String(orderId) },
    });

    db.prepare('UPDATE orders SET stripe_session_id = ? WHERE id = ?').run(session.id, orderId);
    res.json({ checkout_url: session.url, order_id: orderId });
  } catch (err) {
    console.error('Stripe session creation failed:', err.message);
    res.status(502).json({ error: 'Payment session could not be created' });
  }
});

module.exports = router;
