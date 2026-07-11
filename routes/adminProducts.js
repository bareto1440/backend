const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAdmin);
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '..', 'uploads'));
  },
  filename: function (req, file, cb) {
    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    cb(null, safeName);
  },
});
const upload = multer({ storage });

// GET /admin/products — everything, including hidden products and their variants
router.get('/', (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
  const withVariants = products.map((p) => ({
    ...p,
    variants: db.prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY id').all(p.id),
    images: db.prepare('SELECT id, image_url FROM product_images WHERE product_id = ? ORDER BY sort_order').all(p.id),
  }));
  res.json(withVariants);
});

// POST /admin/products — create base product (no variants yet)
router.post('/', (req, res) => {
  const { name, description, category, currency } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  const result = db
    .prepare('INSERT INTO products (name, description, category, currency) VALUES (?, ?, ?, ?)')
    .run(name, description || null, category || null, currency || 'usd');

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(product);
});

// PATCH /admin/products/:id
router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  const fields = ['name', 'description', 'category', 'currency', 'is_active'];
  const updates = [];
  const values = [];
  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(req.body[field]);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);
  db.prepare(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
});

// DELETE /admin/products/:id — soft hide, preserves order history
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  db.prepare("UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.status(204).send();
});

// ---- VARIANTS (size / color / price / stock) ----

// POST /admin/products/:id/variants — add a new size/color combo
router.post('/:id/variants', (req, res) => {
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const { size, color, sku, price_cents, stock_qty, image_url } = req.body;
  if (!price_cents) {
    return res.status(400).json({ error: 'price_cents is required' });
  }

  const result = db
    .prepare(
      `INSERT INTO product_variants (product_id, size, color, sku, price_cents, stock_qty, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.params.id,
      size || null,
      color || null,
      sku || null,
      price_cents,
      stock_qty ?? 0,
      image_url || null
    );

  res.status(201).json(db.prepare('SELECT * FROM product_variants WHERE id = ?').get(result.lastInsertRowid));
});

// PATCH /admin/products/:productId/variants/:variantId — edit price, stock, or hide a variant
router.patch('/:productId/variants/:variantId', (req, res) => {
  const variant = db
    .prepare('SELECT * FROM product_variants WHERE id = ? AND product_id = ?')
    .get(req.params.variantId, req.params.productId);
  if (!variant) return res.status(404).json({ error: 'Variant not found' });

  const fields = ['size', 'color', 'sku', 'price_cents', 'stock_qty', 'image_url', 'is_active'];
  const updates = [];
  const values = [];
  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(req.body[field]);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  updates.push("updated_at = datetime('now')");
  values.push(req.params.variantId);
  db.prepare(`UPDATE product_variants SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  res.json(db.prepare('SELECT * FROM product_variants WHERE id = ?').get(req.params.variantId));
});

// DELETE /admin/products/:productId/variants/:variantId
router.delete('/:productId/variants/:variantId', (req, res) => {
  const variant = db
    .prepare('SELECT * FROM product_variants WHERE id = ? AND product_id = ?')
    .get(req.params.variantId, req.params.productId);
  if (!variant) return res.status(404).json({ error: 'Variant not found' });

  db.prepare("UPDATE product_variants SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(
    req.params.variantId
  );
  res.status(204).send();
});

// ---- IMAGES ----

// POST /admin/products/:id/images — upload an image file only
router.post('/:id/images', upload.single('image'), (req, res) => {
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  if (!req.file) return res.status(400).json({ error: 'image file is required' });

  const sort_order = req.body.sort_order ?? 0;
  const image_url = `/uploads/${req.file.filename}`;

  const result = db
    .prepare('INSERT INTO product_images (product_id, image_url, sort_order) VALUES (?, ?, ?)')
    .run(req.params.id, image_url, sort_order);

  res.status(201).json(db.prepare('SELECT * FROM product_images WHERE id = ?').get(result.lastInsertRowid));
});

// DELETE /admin/products/:productId/images/by-url
router.delete('/:productId/images/by-url', (req, res) => {
  const image_url = req.body?.image_url || req.query?.image_url;
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (!image_url) return res.status(400).json({ error: 'image_url is required' });

  const normalizedUrl = image_url.replace(/^https?:\/\/[\w.-]+(:\d+)?/, '');
  const candidates = [
    normalizedUrl,
    normalizedUrl.startsWith('/') ? normalizedUrl.slice(1) : `/${normalizedUrl}`,
  ];

  let image = null;
  for (const candidate of candidates) {
    image = db
      .prepare('SELECT * FROM product_images WHERE product_id = ? AND image_url = ?')
      .get(req.params.productId, candidate);
    if (image) break;
  }

  if (!image) {
    const basename = normalizedUrl.split('/').pop();
    if (basename) {
      image = db
        .prepare('SELECT * FROM product_images WHERE product_id = ? AND image_url LIKE ?')
        .get(req.params.productId, `%${basename}`);
    }
  }

  if (!image) {
    return res.status(404).json({ error: 'Image not found' });
  }

  db.prepare('DELETE FROM product_images WHERE id = ?').run(image.id);
  res.status(204).send();
});

// DELETE /admin/products/:productId/images/:imageId
router.delete('/:productId/images/:imageId', (req, res) => {
  const image = db
    .prepare('SELECT * FROM product_images WHERE id = ? AND product_id = ?')
    .get(req.params.imageId, req.params.productId);
  if (!image) return res.status(404).json({ error: 'Image not found' });

  db.prepare('DELETE FROM product_images WHERE id = ?').run(req.params.imageId);
  res.status(204).send();
});

// DELETE /admin/products/:productId/images?image_url=...
router.delete('/:productId/images', (req, res) => {
  const { image_url } = req.query;
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (!image_url) return res.status(400).json({ error: 'image_url is required' });

  const normalizedUrl = image_url.replace(/^https?:\/\/[\w.-]+(:\d+)?/, '');
  const candidates = [normalizedUrl, normalizedUrl.startsWith('/') ? normalizedUrl.slice(1) : `/${normalizedUrl}`];

  let image = null;
  for (const candidate of candidates) {
    image = db
      .prepare('SELECT * FROM product_images WHERE product_id = ? AND image_url = ?')
      .get(req.params.productId, candidate);
    if (image) break;
  }

  if (!image) {
    const basename = normalizedUrl.split('/').pop();
    if (basename) {
      image = db
        .prepare('SELECT * FROM product_images WHERE product_id = ? AND image_url LIKE ?')
        .get(req.params.productId, `%${basename}`);
    }
  }

  if (!image) {
    return res.status(404).json({ error: 'Image not found' });
  }

  db.prepare('DELETE FROM product_images WHERE id = ?').run(image.id);
  res.status(204).send();
});

module.exports = router;
