const express = require('express');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const mammoth = require('mammoth');
const { requireAuth } = require('../middleware/auth');
const { requireSubscription, incrementMessageCount } = require('../middleware/subscription');
const { processMessage } = require('../services/claude');
const { supabase } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const VALID_MODES = ['revision', 'interpretation', 'technical', 'peer_review', 'citation', 'translation'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    // Validate conversation_id is a proper UUID to prevent injection
    const safeConvId = conversation_id && UUID_RE.test(conversation_id) ? conversation_id : null;
    const forcedMode = mode && VALID_MODES.includes(mode) ? mode : null;

    let conversationHistory = [];
    if (safeConvId) {
      const { data } = await supabase
        .from('messages')
        .select('role, content')
        .eq('conversation_id', safeConvId)
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

    const convId = safeConvId || uuidv4();
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
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid conversation id' });
    }
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

// POST /chat/review — file upload + review prompt
router.post('/review', requireAuth, requireSubscription, upload.single('file'), async (req, res, next) => {
  try {
    let documentText = '';

    if (req.file) {
      const ext = req.file.originalname.split('.').pop().toLowerCase();
      if (ext === 'docx') {
        const result = await mammoth.extractRawText({ buffer: req.file.buffer });
        documentText = result.value;
      } else if (ext === 'txt') {
        documentText = req.file.buffer.toString('utf-8');
      } else {
        return res.status(400).json({ error: 'Only .docx and .txt files are supported' });
      }
    } else if (req.body.text) {
      documentText = req.body.text;
    } else {
      return res.status(400).json({ error: 'File or text is required' });
    }

    if (documentText.length > 50000) {
      return res.status(400).json({ error: 'Document too long (max 50,000 characters)' });
    }

    const userPrompt = req.body.prompt ||
      'Please review the completed sections, identify any errors, inconsistencies, and gaps, and present your findings as follows: for each issue, state the section it appears in, describe the problem, and if a sentence or phrase requires correction, quote the original and provide the revised version in clear, humanized academic English aligned with APA 7.1.';

    const fullMessage = `${userPrompt}\n\n---\n\n${documentText}`;

    const result = await processMessage({
      userMessage: fullMessage,
      conversationHistory: [],
      forcedMode: 'revision',
    });

    const convId = uuidv4();
    await supabase.from('messages').insert([
      { conversation_id: convId, user_id: req.user.id, role: 'user', content: fullMessage.slice(0, 5000) },
      { conversation_id: convId, user_id: req.user.id, role: 'assistant', content: result.message },
    ]);

    await incrementMessageCount(req.user.id, req.userPlan.plan);

    res.json({
      conversation_id: convId,
      message: result.message,
      document_length: documentText.length,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
