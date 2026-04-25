const express = require('express');
const crypto = require('crypto');
const { requireAuth, supabase } = require('../middleware/auth');
const { getUserPlan } = require('../middleware/subscription');

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function timingSafeCompare(a, b) {
  try {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) {
      // Still run comparison to avoid timing leak
      crypto.timingSafeEqual(bufA, bufA);
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// GET /subscription/status
router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const sub = await getUserPlan(req.user.id);
    const FREE_TRIAL_LIMIT = parseInt(process.env.FREE_TRIAL_LIMIT || '5');
    const BASIC_MONTHLY_LIMIT = parseInt(process.env.BASIC_MONTHLY_LIMIT || '100');

    res.json({
      plan: sub.plan,
      trial_messages_used: sub.plan === 'trial' ? sub.message_count : null,
      trial_messages_limit: sub.plan === 'trial' ? FREE_TRIAL_LIMIT : null,
      monthly_messages_used: sub.plan === 'basic' ? sub.monthly_message_count : null,
      monthly_messages_limit: sub.plan === 'basic' ? BASIC_MONTHLY_LIMIT : null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /subscription/webhook (RevenueCat)
router.post('/webhook', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    const expected = process.env.REVENUECAT_WEBHOOK_AUTH_HEADER || '';

    // Timing-safe comparison prevents timing attacks
    if (!timingSafeCompare(authHeader, expected)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const event = req.body;
    const eventType = event?.event?.type;
    const appUserId = event?.event?.app_user_id;
    const productId = String(event?.event?.product_id || '');

    if (!appUserId || typeof appUserId !== 'string') {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    // Validate appUserId is a valid UUID (Supabase user ID format)
    if (!UUID_RE.test(appUserId)) {
      return res.status(400).json({ error: 'Invalid app_user_id format' });
    }

    const isPro = productId.toLowerCase().includes('pro');
    const isBasic = productId.toLowerCase().includes('basic');
    let newPlan = null;

    switch (eventType) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'PRODUCT_CHANGE':
        newPlan = isPro ? 'pro' : isBasic ? 'basic' : null;
        break;
      case 'CANCELLATION':
      case 'EXPIRATION':
        newPlan = 'trial';
        break;
      default:
        return res.json({ received: true });
    }

    if (newPlan) {
      await supabase
        .from('user_subscriptions')
        .upsert({
          user_id: appUserId,
          plan: newPlan,
          monthly_message_count: 0,
          period_start: new Date().toISOString(),
        }, { onConflict: 'user_id' });
    }

    res.json({ received: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
