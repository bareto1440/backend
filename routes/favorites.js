const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function buildFavoritePayload(row) {
  return {
    id: row.favorite_id,
    product_id: row.product_id,
    product_name: row.product_name,
    description: row.description,
    category: row.category,
    currency: row.currency,
    created_at: row.created_at,
    image_url: row.image_url,
    starting_price_cents: row.starting_price_cents,
    in_stock: Boolean(row.in_stock),
    avg_rating: row.avg_rating,
    review_count: row.review_count,
  };
}

router.get('/', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT f.id AS favorite_id, f.product_id, f.created_at,
              p.name AS product_name, p.description, p.category, p.currency,
              (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY sort_order LIMIT 1) AS image_url,
              (SELECT MIN(price_cents) FROM product_variants WHERE product_id = p.id AND is_active = 1) AS starting_price_cents,
              (SELECT COUNT(*) FROM product_variants WHERE product_id = p.id AND is_active = 1 AND stock_qty > 0) AS in_stock_count,
              (SELECT AVG(rating) FROM reviews WHERE product_id = p.id) AS avg_rating,
              (SELECT COUNT(*) FROM reviews WHERE product_id = p.id) AS review_count
       FROM favorites f
       JOIN products p ON p.id = f.product_id
       WHERE f.user_id = ?
       ORDER BY f.created_at DESC`
    )
    .all(req.user.sub);

  res.json(rows.map(buildFavoritePayload));
});

router.post('/', requireAuth, (req, res) => {
  const { product_id } = req.body;

  if (!product_id || !Number.isInteger(Number(product_id))) {
    return res.status(400).json({ error: 'A valid product id is required.' });
  }

  const product = db.prepare('SELECT id FROM products WHERE id = ? AND is_active = 1').get(product_id);
  if (!product) {
    return res.status(404).json({ error: 'Product not found.' });
  }

  const existing = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND product_id = ?').get(req.user.sub, product_id);
  if (existing) {
    return res.status(200).json({ message: 'Favorite already exists.', already_saved: true });
  }

  const insert = db.prepare('INSERT INTO favorites (user_id, product_id) VALUES (?, ?)').run(req.user.sub, product_id);

  const favorite = db
    .prepare(
      `SELECT f.id AS favorite_id, f.product_id, f.created_at,
              p.name AS product_name, p.description, p.category, p.currency,
              (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY sort_order LIMIT 1) AS image_url,
              (SELECT MIN(price_cents) FROM product_variants WHERE product_id = p.id AND is_active = 1) AS starting_price_cents,
              (SELECT COUNT(*) FROM product_variants WHERE product_id = p.id AND is_active = 1 AND stock_qty > 0) AS in_stock_count,
              (SELECT AVG(rating) FROM reviews WHERE product_id = p.id) AS avg_rating,
              (SELECT COUNT(*) FROM reviews WHERE product_id = p.id) AS review_count
       FROM favorites f
       JOIN products p ON p.id = f.product_id
       WHERE f.id = ?`
    )
    .get(insert.lastInsertRowid);

  res.status(201).json(buildFavoritePayload(favorite));
});

router.delete('/:product_id', requireAuth, (req, res) => {
  const productId = Number(req.params.product_id);
  const deleted = db.prepare('DELETE FROM favorites WHERE user_id = ? AND product_id = ?').run(req.user.sub, productId);

  if (deleted.changes === 0) {
    return res.status(404).json({ error: 'Favorite not found.' });
  }

  res.json({ success: true });
});

module.exports = router;
