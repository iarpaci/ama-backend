const express = require('express');
const { requireAuth, supabase } = require('../middleware/auth');
const { getUserPlan } = require('../middleware/subscription');

const router = express.Router();

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

// POST /subscription/webhook  (RevenueCat webhook)
router.post('/webhook', async (req, res, next) => {
  try {
    // Verify RevenueCat webhook authorization header
    const authHeader = req.headers.authorization;
    if (authHeader !== process.env.REVENUECAT_WEBHOOK_AUTH_HEADER) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const event = req.body;
    const eventType = event?.event?.type;
    const appUserId = event?.event?.app_user_id; // should be Supabase user ID
    const productId = event?.event?.product_id || '';

    if (!appUserId) return res.status(400).json({ error: 'Missing app_user_id' });

    // Map product IDs to plan names (adjust to match your RevenueCat product IDs)
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
        newPlan = 'trial'; // revert to trial on cancel/expire
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
