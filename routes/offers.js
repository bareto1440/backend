const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function buildOfferPayload(row) {
  const variantLabel = [row.size, row.color].filter(Boolean).join(' / ');
  return {
    id: row.id,
    buyer_id: row.buyer_id,
    buyer_name: row.buyer_name,
    buyer_email: row.buyer_email,
    product_id: row.product_id,
    product_name: row.product_name,
    variant_id: row.variant_id,
    variant_label: variantLabel || null,
    offered_price_cents: row.offered_price_cents,
    message: row.message,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

router.get('/', requireAuth, (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const rows = isAdmin
    ? db
        .prepare(
          `SELECT o.*, u.name AS buyer_name, u.email AS buyer_email, p.name AS product_name
           FROM offer_requests o
           JOIN users u ON u.id = o.buyer_id
           JOIN products p ON p.id = o.product_id
           ORDER BY o.created_at DESC`
        )
        .all()
    : db
        .prepare(
          `SELECT o.*, u.name AS buyer_name, u.email AS buyer_email, p.name AS product_name
           FROM offer_requests o
           JOIN users u ON u.id = o.buyer_id
           JOIN products p ON p.id = o.product_id
           WHERE o.buyer_id = ?
           ORDER BY o.created_at DESC`
        )
        .all(req.user.sub);

  res.json(rows.map(buildOfferPayload));
});

router.post('/', requireAuth, (req, res) => {
  const { product_id, variant_id, offered_price_cents, message } = req.body;
  const price = Number(offered_price_cents);

  if (!product_id || !Number.isInteger(Number(product_id))) {
    return res.status(400).json({ error: 'A valid product id is required.' });
  }
  if (!Number.isFinite(price) || price <= 0) {
    return res.status(400).json({ error: 'Offer price must be greater than zero.' });
  }

  const product = db.prepare('SELECT id FROM products WHERE id = ? AND is_active = 1').get(product_id);
  if (!product) {
    return res.status(404).json({ error: 'Product not found.' });
  }

  if (variant_id) {
    const variant = db.prepare('SELECT id FROM product_variants WHERE id = ? AND product_id = ?').get(variant_id, product_id);
    if (!variant) {
      return res.status(400).json({ error: 'Selected variant does not belong to this product.' });
    }
  }

  const insert = db
    .prepare(
      `INSERT INTO offer_requests (buyer_id, product_id, variant_id, offered_price_cents, message, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    )
    .run(req.user.sub, product_id, variant_id || null, Math.round(price), message || null);

  const created = db
    .prepare(
      `SELECT o.*, u.name AS buyer_name, u.email AS buyer_email, p.name AS product_name
       FROM offer_requests o
       JOIN users u ON u.id = o.buyer_id
       JOIN products p ON p.id = o.product_id
       WHERE o.id = ?`
    )
    .get(insert.lastInsertRowid);

  res.status(201).json(buildOfferPayload(created));
});

router.patch('/:id/decision', requireAdmin, (req, res) => {
  const offerId = Number(req.params.id);
  const { action } = req.body;

  const offer = db
    .prepare(
      `SELECT o.*, u.name AS buyer_name, u.email AS buyer_email, p.name AS product_name
       FROM offer_requests o
       JOIN users u ON u.id = o.buyer_id
       JOIN products p ON p.id = o.product_id
       WHERE o.id = ?`
    )
    .get(offerId);

  if (!offer) {
    return res.status(404).json({ error: 'Offer not found.' });
  }

  if (!['accept', 'decline'].includes(action)) {
    return res.status(400).json({ error: 'Action must be either accept or decline.' });
  }

  db.prepare(`UPDATE offer_requests SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(action === 'accept' ? 'accepted' : 'declined', offerId);

  const updated = db
    .prepare(
      `SELECT o.*, u.name AS buyer_name, u.email AS buyer_email, p.name AS product_name
       FROM offer_requests o
       JOIN users u ON u.id = o.buyer_id
       JOIN products p ON p.id = o.product_id
       WHERE o.id = ?`
    )
    .get(offerId);

  res.json(buildOfferPayload(updated));
});

module.exports = router;
