const express = require('express');
const db = require('../db');

const router = express.Router();

function attachVariantsAndRating(product) {
  const variants = db
    .prepare(
      `SELECT id, size, color, price_cents, stock_qty, image_url
       FROM product_variants
       WHERE product_id = ? AND is_active = 1
       ORDER BY id`
    )
    .all(product.id);

  const images = db
    .prepare('SELECT image_url FROM product_images WHERE product_id = ? ORDER BY sort_order')
    .all(product.id)
    .map((row) => row.image_url);

  const ratingRow = db
    .prepare('SELECT AVG(rating) as avg_rating, COUNT(*) as review_count FROM reviews WHERE product_id = ?')
    .get(product.id);

  const inStock = variants.some((v) => v.stock_qty > 0);
  const minPrice = variants.length ? Math.min(...variants.map((v) => v.price_cents)) : null;

  return {
    ...product,
    variants,
    images,
    in_stock: inStock,
    starting_price_cents: minPrice,
    avg_rating: ratingRow.avg_rating ? Math.round(ratingRow.avg_rating * 10) / 10 : null,
    review_count: ratingRow.review_count,
  };
}

// GET /products?search=&category=&color=&size=&in_stock=true&min_price=&max_price=
router.get('/', (req, res) => {
  const { search, category, color, size, in_stock, min_price, max_price } = req.query;

  let products = db
    .prepare('SELECT * FROM products WHERE is_active = 1 ORDER BY created_at DESC')
    .all();

  if (search) {
    const term = search.toLowerCase();
    products = products.filter(
      (p) => p.name.toLowerCase().includes(term) || (p.description || '').toLowerCase().includes(term)
    );
  }
  if (category) {
    products = products.filter((p) => p.category === category);
  }

  let full = products.map(attachVariantsAndRating);

  if (color) {
    full = full.filter((p) => p.variants.some((v) => v.color === color));
  }
  if (size) {
    full = full.filter((p) => p.variants.some((v) => v.size === size));
  }
  if (in_stock === 'true') {
    full = full.filter((p) => p.in_stock);
  }
  if (min_price) {
    full = full.filter((p) => p.starting_price_cents !== null && p.starting_price_cents >= Number(min_price));
  }
  if (max_price) {
    full = full.filter((p) => p.starting_price_cents !== null && p.starting_price_cents <= Number(max_price));
  }

  res.json(full);
});

// GET /products/:id
router.get('/:id', (req, res) => {
  const product = db
    .prepare('SELECT * FROM products WHERE id = ? AND is_active = 1')
    .get(req.params.id);

  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  const images = db
    .prepare('SELECT image_url FROM product_images WHERE product_id = ? ORDER BY sort_order')
    .all(product.id)
    .map((r) => r.image_url);

  const reviews = db
    .prepare(
      `SELECT reviews.id, reviews.rating, reviews.comment, reviews.created_at, users.name as user_name
       FROM reviews JOIN users ON users.id = reviews.user_id
       WHERE product_id = ? ORDER BY reviews.created_at DESC`
    )
    .all(product.id);

  res.json({ ...attachVariantsAndRating(product), images, reviews });
});

// GET /products/meta/filters — distinct categories/colors/sizes for building filter UI
router.get('/meta/filters', (req, res) => {
  const categories = db
    .prepare('SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND is_active = 1')
    .all()
    .map((r) => r.category);
  const colors = db
    .prepare('SELECT DISTINCT color FROM product_variants WHERE color IS NOT NULL AND is_active = 1')
    .all()
    .map((r) => r.color);
  const sizes = db
    .prepare('SELECT DISTINCT size FROM product_variants WHERE size IS NOT NULL AND is_active = 1')
    .all()
    .map((r) => r.size);

  res.json({ categories, colors, sizes });
});

module.exports = router;
