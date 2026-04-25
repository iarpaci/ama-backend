const Anthropic = require('@anthropic-ai/sdk');
const { assembleSystemPrompt, detectMode } = require('./kitAssembler');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 8192;

async function processMessage({ userMessage, conversationHistory = [], forcedMode = null }) {
  const mode = forcedMode || detectMode(userMessage);
  const systemPrompt = assembleSystemPrompt(mode);

  // Build messages array from conversation history + new message
  const messages = [
    ...conversationHistory.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' }, // prompt caching — reduces cost
      },
    ],
    messages,
  });

  const assistantMessage = response.content[0].text;

  return {
    message: assistantMessage,
    mode,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens || 0,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens || 0,
    },
  };
}

module.exports = { processMessage };
