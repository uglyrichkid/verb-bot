'use strict';
const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, '..', '504.txt'), 'utf8');

const words = [];
for (const line of raw.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed) continue;

  const match = trimmed.match(/^(\d+)\.\s+(.+)/);
  if (!match) continue;

  const id = parseInt(match[1]);
  const rest = match[2];

  // Split on em-dash or en-dash (both variants appear in the wild)
  const parts = rest.split(/\s+[—–]\s+/);
  if (parts.length < 3) continue;

  const en = parts[0].trim();
  const ipa = parts[1] ? parts[1].trim() : null;
  const hy = parts[2].split(',').map(s => s.trim()).filter(Boolean);

  if (en && hy.length > 0) {
    words.push({ id, type: 'word', en, ipa, hy });
  }
}

module.exports = words;
