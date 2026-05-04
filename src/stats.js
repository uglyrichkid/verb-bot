const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STATS_FILE)) return {};
  return JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
}

function save(data) {
  fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function getUserStats(userId) {
  const data = load();
  const defaults = { total: 0, correct: 0, wrong: 0, completedRounds: 0, bestRoundMs: null };
  return { ...defaults, ...(data[userId] ?? {}) };
}

function recordAnswer(userId, isCorrect) {
  const data = load();
  if (!data[userId]) data[userId] = { total: 0, correct: 0, wrong: 0, completedRounds: 0, bestRoundMs: null };
  data[userId].total += 1;
  if (isCorrect) data[userId].correct += 1;
  else data[userId].wrong += 1;
  save(data);
}

function recordRound(userId, { durationMs }) {
  const data = load();
  if (!data[userId]) data[userId] = { total: 0, correct: 0, wrong: 0, completedRounds: 0, bestRoundMs: null };
  const u = data[userId];
  u.completedRounds = (u.completedRounds || 0) + 1;
  if (!u.bestRoundMs || durationMs < u.bestRoundMs) {
    u.bestRoundMs = durationMs;
  }
  save(data);
}

module.exports = { getUserStats, recordAnswer, recordRound };
