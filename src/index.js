require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const subscriptionRoutes = require('./routes/subscription');

const app = express();

// Trust Railway's reverse proxy for accurate IP-based rate limiting
app.set('trust proxy', 1);

app.use(helmet());

// CORS: only allow requests from known origins
app.use(cors({
  origin: (origin, cb) => {
    const allowed = [undefined, null, 'http://localhost:3000', 'http://localhost:3001', 'http://localhost:8081'];
    if (!origin || allowed.includes(origin)) return cb(null, true);
    // Allow all vercel.app subdomains
    if (origin.endsWith('.vercel.app')) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Type'],
}));

// Minimal logging in production (don't log request bodies or auth headers)
app.use(morgan(process.env.NODE_ENV === 'production' ? 'tiny' : 'combined'));

app.use(express.json({ limit: '50kb' }));

// Global rate limit: 100 req / 15 min per IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Strict auth limiter: 10 attempts / 15 min per IP (brute-force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later.' },
});

app.use(globalLimiter);
app.use('/auth/login', authLimiter);
app.use('/auth/register', authLimiter);

app.use('/auth', authRoutes);
app.use('/chat', chatRoutes);
app.use('/subscription', subscriptionRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Error handler: never expose stack traces in production
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (process.env.NODE_ENV !== 'production') console.error(err.stack);
  else console.error(`[${status}] ${err.message}`);

  const message = status === 500 && process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message || 'Internal server error';

  res.status(status).json({ error: message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AMA backend running on port ${PORT}`));
