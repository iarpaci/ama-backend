const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_LANGUAGES = ['en', 'tr'];

// POST /auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, language = 'en' } = req.body;

    if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const lang = ALLOWED_LANGUAGES.includes(language) ? language : 'en';

    const { data, error } = await supabase.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { language: lang },
    });

    if (error) {
      // Don't reveal whether email already exists
      if (error.message.toLowerCase().includes('already')) {
        return res.status(400).json({ error: 'Registration failed. Please try again.' });
      }
      return res.status(400).json({ error: 'Registration failed. Please try again.' });
    }

    res.status(201).json({ user_id: data.user.id, email: data.user.email });
  } catch (err) {
    next(err);
  }
});

// POST /auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'email and password required' });
    }
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'email and password required' });
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    // Always return same message for invalid credentials (prevent user enumeration)
    if (error) return res.status(401).json({ error: 'Invalid email or password' });

    res.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      user: {
        id: data.user.id,
        email: data.user.email,
        language: data.user.user_metadata?.language || 'en',
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token || typeof refresh_token !== 'string') {
      return res.status(400).json({ error: 'refresh_token required' });
    }

    const { data, error } = await supabase.auth.refreshSession({ refresh_token });
    if (error) return res.status(401).json({ error: 'Invalid or expired refresh token' });

    res.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
