'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, '..', 'data');
const JSON_PATH = path.join(DATA_DIR, 'words504.json');
const TXT_PATH  = path.join(__dirname, '..', '504.txt');
const UNIT_SIZE = 20;

let _words = null;

function _loadFromTxt() {
  const raw = fs.readFileSync(TXT_PATH, 'utf8');
  const result = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\.\s+(.+)/);
    if (!match) continue;
    const id   = parseInt(match[1]);
    const rest = match[2];
    const parts = rest.split(/\s+[—–]\s+/);
    if (parts.length < 3) continue;
    const en  = parts[0].trim();
    const ipa = parts[1] ? parts[1].trim() : null;
    const hy  = parts[2].split(',').map(s => s.trim()).filter(Boolean);
    if (en && hy.length > 0) result.push({ id, type: 'word', en, ipa, hy });
  }
  return result;
}

function _assignUnitIds(arr) {
  arr.sort((a, b) => a.id - b.id);
  for (let i = 0; i < arr.length; i++) {
    if (arr[i].unitId == null) {
      arr[i].unitId = Math.ceil((i + 1) / UNIT_SIZE);
    }
  }
}

function _nextUnitId(arr) {
  if (arr.length === 0) return 1;
  const maxUnit = arr.reduce((m, w) => Math.max(m, w.unitId || 1), 1);
  const inLast = arr.filter(w => w.unitId === maxUnit).length;
  return inLast < UNIT_SIZE ? maxUnit : maxUnit + 1;
}

function loadWords() {
  if (_words) return _words;
  let needsSave = false;
  if (fs.existsSync(JSON_PATH)) {
    _words = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
    if (_words.some(w => w.unitId == null)) {
      _assignUnitIds(_words);
      needsSave = true;
    }
  } else {
    _words = _loadFromTxt();
    _assignUnitIds(_words);
    needsSave = true;
  }
  if (needsSave) saveWords(_words);
  return _words;
}

function saveWords(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(JSON_PATH, JSON.stringify(list, null, 2), 'utf8');
}

function findWord(en) {
  const lower = en.toLowerCase();
  return loadWords().find(w => w.en.toLowerCase() === lower) || null;
}

function addWord(en, hy) {
  const arr = loadWords();
  const maxId = arr.reduce((m, w) => Math.max(m, w.id), 0);
  const unitId = _nextUnitId(arr);
  const word = { id: maxId + 1, unitId, type: 'word', en: en.trim(), ipa: null, hy: [hy.trim()] };
  arr.push(word);
  saveWords(arr);
  return word;
}

function addWordsBulk(items) {
  const arr = loadWords();
  let maxId = arr.reduce((m, w) => Math.max(m, w.id), 0);
  let added = 0;
  let duplicates = 0;

  for (const { en, hy } of items) {
    const lower = en.toLowerCase();
    const exists = arr.find(w => w.en.toLowerCase() === lower);
    if (exists) { duplicates++; continue; }
    maxId++;
    const unitId = _nextUnitId(arr);
    arr.push({ id: maxId, unitId, type: 'word', en: en.trim(), ipa: null, hy: [hy.trim()] });
    added++;
  }

  if (added > 0) saveWords(arr);
  return { added, duplicates };
}

function getWords() {
  return loadWords();
}

function getUnits() {
  const words = loadWords();
  const map = {};
  for (const w of words) {
    if (!map[w.unitId]) map[w.unitId] = [];
    map[w.unitId].push(w);
  }
  return Object.keys(map)
    .sort((a, b) => Number(a) - Number(b))
    .map(uid => ({ unitId: Number(uid), words: map[uid] }));
}

function getWordsInUnit(unitId) {
  return loadWords().filter(w => w.unitId === unitId);
}

module.exports = { loadWords, saveWords, findWord, addWord, addWordsBulk, getWords, getUnits, getWordsInUnit, UNIT_SIZE };
