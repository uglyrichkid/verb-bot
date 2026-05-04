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

module.exports = {
  shuffle,
  getRoundPool,
  getRandomWord,
  validateAnswer,
  getCorrectDisplay,
  formatDuration,
  groupByType,
  vocabulary,
};
