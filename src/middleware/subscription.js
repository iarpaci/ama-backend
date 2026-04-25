const { supabase } = require('./auth');

const FREE_TRIAL_LIMIT = parseInt(process.env.FREE_TRIAL_LIMIT || '5');
const BASIC_MONTHLY_LIMIT = parseInt(process.env.BASIC_MONTHLY_LIMIT || '100');

// Plans: 'trial' | 'basic' | 'pro'
async function getUserPlan(userId) {
  const { data, error } = await supabase
    .from('user_subscriptions')
    .select('plan, message_count, monthly_message_count, period_start')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    // New user — create trial record
    await supabase.from('user_subscriptions').insert({
      user_id: userId,
      plan: 'trial',
      message_count: 0,
      monthly_message_count: 0,
      period_start: new Date().toISOString(),
    });
    return { plan: 'trial', message_count: 0, monthly_message_count: 0 };
  }

  return data;
}

function isNewMonth(periodStart) {
  const start = new Date(periodStart);
  const now = new Date();
  return start.getMonth() !== now.getMonth() || start.getFullYear() !== now.getFullYear();
}

async function requireSubscription(req, res, next) {
  const userId = req.user.id;
  const sub = await getUserPlan(userId);

  if (sub.plan === 'trial') {
    if (sub.message_count >= FREE_TRIAL_LIMIT) {
      return res.status(403).json({
        error: 'trial_exhausted',
        message: 'Free trial limit reached. Please subscribe to continue.',
      });
    }
  } else if (sub.plan === 'basic') {
    // Reset monthly count if new month
    if (isNewMonth(sub.period_start)) {
      await supabase
        .from('user_subscriptions')
        .update({ monthly_message_count: 0, period_start: new Date().toISOString() })
        .eq('user_id', userId);
      sub.monthly_message_count = 0;
    }
    if (sub.monthly_message_count >= BASIC_MONTHLY_LIMIT) {
      return res.status(403).json({
        error: 'monthly_limit_reached',
        message: 'Monthly message limit reached. Upgrade to Pro for unlimited access.',
      });
    }
  }
  // pro: no limit

  req.userPlan = sub;
  next();
}

async function incrementMessageCount(userId, plan) {
  if (plan === 'trial') {
    await supabase.rpc('increment_message_count', { p_user_id: userId });
  } else if (plan === 'basic') {
    await supabase.rpc('increment_monthly_message_count', { p_user_id: userId });
  }
  // pro: no tracking needed
}

module.exports = { requireSubscription, incrementMessageCount, getUserPlan };
