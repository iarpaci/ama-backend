const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const { requireSubscription, incrementMessageCount } = require('../middleware/subscription');
const { processMessage } = require('../services/claude');
const { supabase } = require('../middleware/auth');

const router = express.Router();

const VALID_MODES = ['revision', 'interpretation', 'technical', 'peer_review', 'citation', 'translation'];

// POST /chat/message
router.post('/message', requireAuth, requireSubscription, async (req, res, next) => {
  try {
    const { message, mode, conversation_id } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'message is required' });
    }
    if (message.length > 20000) {
      return res.status(400).json({ error: 'Message too long (max 20,000 characters)' });
    }

    const forcedMode = mode && VALID_MODES.includes(mode) ? mode : null;

    // Fetch conversation history (last 10 turns) if conversation_id provided
    let conversationHistory = [];
    if (conversation_id) {
      const { data } = await supabase
        .from('messages')
        .select('role, content')
        .eq('conversation_id', conversation_id)
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: true })
        .limit(20);
      conversationHistory = data || [];
    }

    const result = await processMessage({
      userMessage: message.trim(),
      conversationHistory,
      forcedMode,
    });

    // Persist messages
    const convId = conversation_id || uuidv4();
    await supabase.from('messages').insert([
      { conversation_id: convId, user_id: req.user.id, role: 'user', content: message.trim() },
      { conversation_id: convId, user_id: req.user.id, role: 'assistant', content: result.message },
    ]);

    // Increment usage counter
    await incrementMessageCount(req.user.id, req.userPlan.plan);

    res.json({
      conversation_id: convId,
      message: result.message,
      mode: result.mode,
    });
  } catch (err) {
    next(err);
  }
});

// GET /chat/conversations
router.get('/conversations', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('conversation_id, content, created_at')
      .eq('user_id', req.user.id)
      .eq('role', 'user')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    // Group by conversation_id, take first message as preview
    const seen = new Set();
    const conversations = [];
    for (const row of data) {
      if (!seen.has(row.conversation_id)) {
        seen.add(row.conversation_id);
        conversations.push({
          id: row.conversation_id,
          preview: row.content.slice(0, 100),
          created_at: row.created_at,
        });
      }
    }

    res.json(conversations);
  } catch (err) {
    next(err);
  }
});

// GET /chat/conversations/:id
router.get('/conversations/:id', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('role, content, created_at')
      .eq('conversation_id', req.params.id)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
