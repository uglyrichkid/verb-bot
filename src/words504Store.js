'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, '..', 'data');
const JSON_PATH = path.join(DATA_DIR, 'words504.json');
const TXT_PATH  = path.join(__dirname, '..', '504.txt');

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

function loadWords() {
  if (_words) return _words;
  if (fs.existsSync(JSON_PATH)) {
    _words = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  } else {
    _words = _loadFromTxt();
    saveWords(_words);
  }
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
  const word = { id: maxId + 1, type: 'word', en: en.trim(), ipa: null, hy: [hy.trim()] };
  arr.push(word);
  saveWords(arr);
  return word;
}

function getWords() {
  return loadWords();
}

module.exports = { loadWords, saveWords, findWord, addWord, getWords };
