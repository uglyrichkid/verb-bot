const vocabulary = require('../vocabulary');

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getRoundPool(size) {
  return shuffle(vocabulary).slice(0, Math.min(size, vocabulary.length));
}

function getRandomWord() {
  return vocabulary[Math.floor(Math.random() * vocabulary.length)];
}

function validateAnswer(word, userAnswer, direction) {
  const normalized = userAnswer.trim().toLowerCase();
  if (direction === 'en-hy') {
    return word.hy.some(h => h.trim().toLowerCase() === normalized);
  }
  return word.en.trim().toLowerCase() === normalized;
}

function getCorrectDisplay(word, direction) {
  return direction === 'en-hy' ? word.hy.join(' / ') : word.en;
}

function formatDuration(ms) {
  const totalSecs = Math.floor(ms / 1000);
  const mins = String(Math.floor(totalSecs / 60)).padStart(2, '0');
  const secs = String(totalSecs % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

function groupByType(words) {
  const groups = {};
  for (const w of words) {
    if (!groups[w.type]) groups[w.type] = [];
    groups[w.type].push(w);
  }
  return groups;
}

// ── Spaced-repetition helpers (word-list-agnostic) ────────────────────────────

function _wordWeight(w, rawStats) {
  const ws = rawStats[w.id];
  if (!ws || ws.shown === 0) return 1.0; // unseen: medium weight
  const difficulty = Math.min(ws.wrong / (ws.shown + 1), 1.0);
  const daysSince = (Date.now() - ws.lastPracticed) / 86400000;
  const recency = Math.min(daysSince / 3, 1.0); // ramps up over 3 days
  return 0.3 + difficulty * 0.5 + recency * 0.2;
}

function getWeightedRandomWordFrom(wordList, rawStats) {
  if (!wordList || wordList.length === 0) return null;
  const weights = wordList.map(w => _wordWeight(w, rawStats));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < wordList.length; i++) {
    r -= weights[i];
    if (r <= 0) return wordList[i];
  }
  return wordList[wordList.length - 1];
}

function getWeightedRoundPool(size, wordList, rawStats) {
  const available = [...wordList];
  const picked = [];
  const limit = Math.min(size, available.length);
  while (picked.length < limit && available.length > 0) {
    const weights = available.map(w => _wordWeight(w, rawStats));
    const total = weights.reduce((s, w) => s + w, 0);
    let r = Math.random() * total;
    let idx = available.length - 1;
    for (let i = 0; i < available.length; i++) {
      r -= weights[i];
      if (r <= 0) { idx = i; break; }
    }
    picked.push(available.splice(idx, 1)[0]);
  }
  return picked;
}

// Generate 4 options (1 correct + 3 random wrong) for multiple-choice questions.
function generateMCOptions(correctWord, direction, wordList) {
  const correct = direction === 'en-hy' ? correctWord.hy[0] : correctWord.en;
  const candidates = shuffle(wordList.filter(w => w.id !== correctWord.id));
  const wrongOptions = [];
  for (const w of candidates) {
    const opt = direction === 'en-hy' ? w.hy[0] : w.en;
    if (opt !== correct && !wrongOptions.includes(opt)) wrongOptions.push(opt);
    if (wrongOptions.length === 3) break;
  }
  return { options: shuffle([correct, ...wrongOptions]), correct };
}

module.exports = {
  shuffle,
  getRoundPool,
  getRandomWord,
  validateAnswer,
  getCorrectDisplay,
  formatDuration,
  groupByType,
  vocabulary,
  getWeightedRandomWordFrom,
  getWeightedRoundPool,
  generateMCOptions,
};
