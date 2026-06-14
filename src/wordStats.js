'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'wordStats.json');

function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) return {};
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getUser(data, userId) {
  const id = String(userId);
  if (!data[id]) data[id] = { daily: {}, goalPerDay: 20, words: {}, mistakes: {} };
  return data[id];
}

// Record one answer for a specific word. Updates daily stats, per-word stats, and mistakes list.
function recordWordAnswer(userId, source, wordId, isCorrect) {
  const data = load();
  const u = getUser(data, userId);
  const key = `${source}:${wordId}`;
  const d = todayKey();

  if (!u.daily[d]) u.daily[d] = { answered: 0, correct: 0 };
  u.daily[d].answered++;
  if (isCorrect) u.daily[d].correct++;

  if (!u.words[key]) u.words[key] = { shown: 0, correct: 0, wrong: 0, lastPracticed: Date.now(), streak: 0 };
  const ws = u.words[key];
  ws.shown++;
  ws.lastPracticed = Date.now();
  if (isCorrect) {
    ws.correct++;
    ws.streak = (ws.streak || 0) + 1;
  } else {
    ws.wrong++;
    ws.streak = 0;
  }

  if (!u.mistakes[source]) u.mistakes[source] = [];
  if (isCorrect) {
    if (ws.streak >= 3) {
      u.mistakes[source] = u.mistakes[source].filter(m => m.wordId !== wordId);
    }
  } else {
    const already = u.mistakes[source].find(m => m.wordId === wordId);
    if (!already) u.mistakes[source].push({ wordId, addedAt: Date.now() });
  }

  save(data);
}

// Raw per-word stats keyed by wordId for spaced repetition weight calculations.
function getRawWordStats(userId, source) {
  const data = load();
  const u = getUser(data, userId);
  const result = {};
  for (const [key, val] of Object.entries(u.words)) {
    const sep = key.indexOf(':');
    if (key.slice(0, sep) === source) result[parseInt(key.slice(sep + 1))] = val;
  }
  return result;
}

function getMistakeWordIds(userId, source) {
  const data = load();
  const u = getUser(data, userId);
  return (u.mistakes[source] || []).map(m => m.wordId);
}

function getDailyProgress(userId) {
  const data = load();
  const u = getUser(data, userId);
  const d = todayKey();
  const day = u.daily[d] || { answered: 0, correct: 0 };
  return { answered: day.answered, correct: day.correct, goal: u.goalPerDay, date: d };
}

// Returns top `limit` words with lowest accuracy, enriched with word object.
function getHardWords(userId, source, allWords, limit) {
  const data = load();
  const u = getUser(data, userId);
  const n = limit || 10;

  return allWords
    .map(w => {
      const ws = u.words[`${source}:${w.id}`];
      if (!ws || ws.shown === 0) return null;
      return { word: w, shown: ws.shown, correct: ws.correct, wrong: ws.wrong, accuracy: ws.correct / ws.shown };
    })
    .filter(Boolean)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, n);
}

function getMasteryLevel(ws) {
  if (!ws || ws.shown === 0) return 'new';
  const accuracy = ws.correct / ws.shown;
  if (ws.shown >= 10 && (accuracy >= 0.9 || (ws.streak || 0) >= 5)) return 'mastered';
  if (ws.shown >= 5 && accuracy >= 0.6) return 'known';
  return 'learning';
}

function getMasteryStats(userId, source, allWords) {
  const data = load();
  const u = getUser(data, userId);
  const result = { new: [], learning: [], known: [], mastered: [] };
  for (const word of allWords) {
    const ws = u.words[`${source}:${word.id}`];
    result[getMasteryLevel(ws)].push(word);
  }
  return result;
}

module.exports = { recordWordAnswer, getRawWordStats, getMistakeWordIds, getDailyProgress, getHardWords, getMasteryLevel, getMasteryStats };
