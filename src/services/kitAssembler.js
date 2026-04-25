const fs = require('fs');
const path = require('path');

const PROMPTS_DIR = path.join(__dirname, '..', 'prompts');

// KIT-ACTIVATION-MAP: which kits are ACT (fully active) per mode
const ACTIVATION_MAP = {
  revision: [
    'STYLE', 'HUMANIZE', 'OUTPUT-SPEC', 'INPUT-SPEC',
    'SCOPE-REJECTION', 'INTEGRITY', 'REVISION-TRACKING',
    // conditional: RESULTS-INTERPRETATION, DISCUSSION-INTEGRATION, LIMITATION-BIAS
  ],
  interpretation: [
    'STYLE', 'HUMANIZE', 'OUTPUT-SPEC', 'INPUT-SPEC',
    'SCOPE-REJECTION', 'INTEGRITY',
    'STATISTICAL-OUTPUT', 'STATISTICAL-THRESHOLDS', 'RESULTS-INTERPRETATION',
  ],
  technical: [
    'STYLE', 'HUMANIZE', 'OUTPUT-SPEC', 'INPUT-SPEC',
    'SCOPE-REJECTION', 'INTEGRITY',
    'TECHNICAL-ACADEMIC', 'EXPERIMENTAL-DESIGN',
  ],
  peer_review: [
    'STYLE', 'HUMANIZE', 'OUTPUT-SPEC', 'INPUT-SPEC',
    'SCOPE-REJECTION', 'INTEGRITY',
    'PEER-REVIEW-EVALUATION', 'LIMITATION-BIAS',
  ],
  citation: [
    'OUTPUT-SPEC', 'INPUT-SPEC', 'SCOPE-REJECTION', 'INTEGRITY',
    'CITATION',
  ],
  translation: [
    'STYLE', 'HUMANIZE', 'OUTPUT-SPEC', 'INPUT-SPEC',
    'SCOPE-REJECTION', 'INTEGRITY',
    'TRANSLATION-QUALITY',
  ],
};

const KIT_FILE_MAP = {
  'STYLE':                  'STYLE-KIT.txt',
  'HUMANIZE':               'HUMANIZE-KIT.txt',
  'OUTPUT-SPEC':            'OUTPUT-SPEC-KIT.txt',
  'INPUT-SPEC':             'INPUT-SPEC-KIT.txt',
  'SCOPE-REJECTION':        'SCOPE-REJECTION-KIT.txt',
  'INTEGRITY':              null, // embedded in CORE — skip
  'REVISION-TRACKING':      'REVISION-TRACKING-KIT.txt',
  'STATISTICAL-OUTPUT':     'STATISTICAL-OUTPUT-KIT.txt',
  'STATISTICAL-THRESHOLDS': 'STATISTICAL-THRESHOLDS-KIT.txt',
  'RESULTS-INTERPRETATION': 'RESULTS-INTERPRETATION-KIT.txt',
  'DISCUSSION-INTEGRATION': 'DISCUSSION-INTEGRATION-KIT.txt',
  'LIMITATION-BIAS':        'LIMITATION-BIAS-KIT.txt',
  'TECHNICAL-ACADEMIC':     'TECHNICAL-ACADEMIC-KIT.txt',
  'EXPERIMENTAL-DESIGN':    'EXPERIMENTAL-DESIGN-KIT.txt',
  'PEER-REVIEW-EVALUATION': 'PEER-REVIEW-EVALUATION-KIT.txt',
  'CITATION':               'CITATION-KIT.txt',
  'TRANSLATION-QUALITY':    'TRANSLATION-QUALITY-KIT.txt',
  'TABLE-FORMATTING':       'TABLE-FORMATTING-KIT.txt',
  'DOMAIN':                 'DOMAIN-KIT.txt',
};

let corePrompt = null;
const kitCache = {};

function loadCore() {
  if (!corePrompt) {
    corePrompt = fs.readFileSync(path.join(PROMPTS_DIR, 'core.txt'), 'utf-8');
  }
  return corePrompt;
}

function loadKit(kitName) {
  const fileName = KIT_FILE_MAP[kitName];
  if (!fileName) return null;
  if (kitCache[kitName]) return kitCache[kitName];
  const filePath = path.join(PROMPTS_DIR, 'kits', fileName);
  if (!fs.existsSync(filePath)) return null;
  kitCache[kitName] = fs.readFileSync(filePath, 'utf-8');
  return kitCache[kitName];
}

// Detect mode from user message content
function detectMode(userMessage) {
  const msg = userMessage.toLowerCase();

  // Citation: reference list or citation check
  if (/reference list|in-text citation|apa.*format|cite.*check|citation.*format/.test(msg)) {
    return 'citation';
  }
  // Statistical interpretation: raw stats output
  if (/spss|amos|pls.?sem|cronbach|factor load|rmsea|cfi|tli|srmr|avr|bootstrap|t-value|p[\s=<>]+\.\d/.test(msg)) {
    return 'interpretation';
  }
  // Technical/experimental
  if (/algorithm|architecture|model config|hyperparameter|experimental procedure|code fragment|engineering spec/.test(msg)) {
    return 'technical';
  }
  // Peer review
  if (/peer review|evaluate.*manuscript|assess.*paper|reviewer/.test(msg)) {
    return 'peer_review';
  }
  // Translation: Turkish → English or explicit request
  if (/translate|çevir|translation/.test(msg)) {
    return 'translation';
  }
  // Check if input is primarily Turkish text (simple heuristic)
  const turkishChars = (msg.match(/[şğüöıçŞĞÜÖİÇ]/g) || []).length;
  const wordCount = msg.split(/\s+/).length;
  if (turkishChars / wordCount > 0.05) {
    return 'translation';
  }

  // Default: revision
  return 'revision';
}

function assembleSystemPrompt(mode, extraKits = []) {
  const core = loadCore();
  const activeKits = [...(ACTIVATION_MAP[mode] || ACTIVATION_MAP.revision), ...extraKits];
  const uniqueKits = [...new Set(activeKits)];

  const kitSections = uniqueKits
    .map(k => loadKit(k))
    .filter(Boolean)
    .join('\n\n---\n\n');

  return `${core}\n\n---\n\n${kitSections}`;
}

module.exports = { assembleSystemPrompt, detectMode };
