require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');

const webhookRoutes = require('./routes/webhook');
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const reviewRoutes = require('./routes/reviews');
const checkoutRoutes = require('./routes/checkout');
const offerRoutes = require('./routes/offers');
const favoriteRoutes = require('./routes/favorites');
const adminProductRoutes = require('./routes/adminProducts');
const adminOrderRoutes = require('./routes/adminOrders');
const adminRoutes = require('./routes/admin');

const app = express();
app.use(cors());

// Serve uploaded images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Stripe webhook needs the raw body for signature verification —
// must be mounted BEFORE express.json().
app.use('/webhook', webhookRoutes);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.SESSION_SECRET || 'dev-secret'));

// ---- Public / buyer-facing ----
app.use('/auth', authRoutes);
app.use('/products', productRoutes);
app.use('/reviews', reviewRoutes);
app.use('/checkout', checkoutRoutes);
app.use('/offers', offerRoutes);
app.use('/favorites', favoriteRoutes);

// ---- Admin-only (gated inside each router) ----
app.use('/admin/products', adminProductRoutes);
app.use('/admin/orders', adminOrderRoutes);
app.use('/admin', adminRoutes);

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
