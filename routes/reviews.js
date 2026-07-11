const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// POST /reviews { product_id, rating, comment }
router.post('/', requireAuth, (req, res) => {
  const { product_id, rating, comment } = req.body;

  if (!product_id || !rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'product_id and rating (1-5) are required' });
  }

  const product = db.prepare('SELECT id FROM products WHERE id = ? AND is_active = 1').get(product_id);
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  const existing = db
    .prepare('SELECT id FROM reviews WHERE product_id = ? AND user_id = ?')
    .get(product_id, req.user.sub);
  if (existing) {
    return res.status(409).json({ error: 'You already reviewed this product' });
  }

  const result = db
    .prepare('INSERT INTO reviews (product_id, user_id, rating, comment) VALUES (?, ?, ?, ?)')
    .run(product_id, req.user.sub, rating, comment || null);

  const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(review);
});

// DELETE /reviews/:id — a user can remove their own review
router.delete('/:id', requireAuth, (req, res) => {
  const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
  if (!review) {
    return res.status(404).json({ error: 'Review not found' });
  }
  if (review.user_id !== req.user.sub && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Not authorized to delete this review' });
  }

  db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

module.exports = router;
