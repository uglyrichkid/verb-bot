'use strict';
const { Markup } = require('telegraf');
const { createQuizHandler } = require('./createQuizHandler');
const { getWords, findWord, addWord, addWordsBulk, getUnits, getWordsInUnit } = require('../words504Store');
const { getQuiz504Session, setQuiz504Session, clearQuiz504Session, isIn504Quiz } = require('./quiz504State');
const { getRawWordStats } = require('../wordStats');

const BTN_ADD_WORD   = '➕ Add Word';
const BTN_ADD_SINGLE = '➕ Add Single Word';
const BTN_BULK_ADD   = '📥 Bulk Add Words';
const BTN_UNITS      = '📖 Units';
const BTN_SHOW_WORDS = '📖 Show Words';
const BTN_QUIZ_UNIT  = '🎯 Quiz Unit';
const BTN_REV_UNIT   = '🔄 Reverse Unit';
const BTN_PROGRESS   = '📊 Progress';
const BTN_BACK       = '⬅️ Back';

const MODE_ADD_WORD   = 'quiz504_add_word';
const MODE_ADD_SINGLE = 'quiz504_add_single';
const MODE_BULK_ADD   = 'quiz504_bulk_add';
const MODE_UNITS_LIST = 'quiz504_units_list';
const MODE_UNIT_VIEW  = 'quiz504_unit_view';

const UNIT_BTN_RE = /^Unit (\d+) \(\d+ words?\)$/;

const handler = createQuizHandler({
  source:            'quiz504',
  entryBtn:          '📖 Quiz 504',
  title:             '📖 Quiz 504 — Essential Words',
  wordList:          getWords(),
  getSession:        getQuiz504Session,
  setSession:        setQuiz504Session,
  clearSession:      clearQuiz504Session,
  isActive:          isIn504Quiz,
  extraMainMenuRows: [[BTN_UNITS], [BTN_ADD_WORD]],
});

// ── Keyboards ─────────────────────────────────────────────────────────────────

function _unitsListMenu(units) {
  const rows = units.map(u => [`Unit ${u.unitId} (${u.words.length} words)`]);
  return Markup.keyboard([...rows, [BTN_BACK]]).resize();
}

function _unitViewMenu() {
  return Markup.keyboard([
    [BTN_SHOW_WORDS],
    [BTN_QUIZ_UNIT, BTN_REV_UNIT],
    [BTN_PROGRESS],
    [BTN_BACK],
  ]).resize();
}

// ── Unit helpers ──────────────────────────────────────────────────────────────

function _showUnitsList(ctx) {
  const units = getUnits();
  setQuiz504Session(ctx.from.id, { mode: MODE_UNITS_LIST });
  return ctx.reply('📖 *Units*\n\nChoose a unit:', {
    parse_mode: 'Markdown',
    ..._unitsListMenu(units),
  });
}

function _showUnitView(ctx, unitId) {
  const words = getWordsInUnit(unitId);
  setQuiz504Session(ctx.from.id, { mode: MODE_UNIT_VIEW, currentUnitId: unitId });
  return ctx.reply(
    `📖 *Unit ${unitId}*\n${words.length} words\n\nChoose an action:`,
    { parse_mode: 'Markdown', ..._unitViewMenu() }
  );
}

function _showUnitWords(ctx, unitId) {
  const words = getWordsInUnit(unitId);
  const lines = words.map((w, i) => `${i + 1}. ${w.en} — ${w.hy.join(', ')}`);
  return ctx.reply(
    `📖 *Unit ${unitId} Words*\n\n${lines.join('\n')}`,
    { parse_mode: 'Markdown', ..._unitViewMenu() }
  );
}

function _showProgress(ctx) {
  const userId = ctx.from.id;
  const units = getUnits();
  const rawStats = getRawWordStats(userId, 'quiz504');
  const lines = units.map(u => {
    const practiced = u.words.filter(w => rawStats[w.id] && rawStats[w.id].shown > 0).length;
    return `Unit ${u.unitId}\n${practiced}/${u.words.length} words`;
  });
  return ctx.reply(
    `📊 *Progress*\n\n${lines.join('\n\n')}`,
    { parse_mode: 'Markdown', ..._unitViewMenu() }
  );
}

// ── Add word helpers ──────────────────────────────────────────────────────────

function _addWordSubMenu(ctx) {
  return ctx.reply(
    '➕ Add Word — Choose an option:',
    Markup.keyboard([[BTN_ADD_SINGLE], [BTN_BULK_ADD], [BTN_BACK]]).resize()
  );
}

function _addSinglePrompt(ctx) {
  return ctx.reply(
    'Send word using format:\n\n`word | translation`\n\nExample:\n`achieve | հаснел`',
    { parse_mode: 'Markdown', ...Markup.keyboard([[BTN_BACK]]).resize() }
  );
}

function _bulkPrompt(ctx) {
  return ctx.reply(
    'Send words in this format, one per line:\n\n`word | translation`\n\nExample:\n`make a decision | որոշում կայացնել`\n`make a mistake | սխալ անել`',
    { parse_mode: 'Markdown', ...Markup.keyboard([[BTN_BACK]]).resize() }
  );
}

async function _handleAddSingleInput(ctx, text) {
  const userId = ctx.from.id;

  if (!text.includes('|')) {
    return ctx.reply(
      '❌ Invalid format. Use:\n\n`word | translation`\n\nExample:\n`achieve | հasnel`',
      { parse_mode: 'Markdown' }
    );
  }

  const [enPart, hyPart] = text.split('|').map(s => s.trim());

  if (!enPart || !hyPart) {
    return ctx.reply(
      '❌ Both word and translation are required.\n\nFormat: `word | translation`',
      { parse_mode: 'Markdown' }
    );
  }

  const existing = findWord(enPart);
  if (existing) {
    return ctx.reply(
      `⚠️ "*${existing.en}*" already exists: ${existing.hy.join(', ')}`,
      { parse_mode: 'Markdown' }
    );
  }

  const newWord = addWord(enPart, hyPart);
  setQuiz504Session(userId, { mode: 'quiz504_main' });

  return ctx.reply(
    `✅ Word added!\n\n*${newWord.en}* — ${newWord.hy[0]}\nUnit ${newWord.unitId}\n\nNow available in Quiz 504.`,
    { parse_mode: 'Markdown', ...handler.getMainMenu() }
  );
}

async function _handleBulkInput(ctx, text) {
  const userId = ctx.from.id;
  const valid = [];
  const invalidLines = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (!trimmed.includes('|')) {
      invalidLines.push(trimmed);
      continue;
    }

    const [enPart, hyPart] = trimmed.split('|').map(s => s.trim());
    if (!enPart || !hyPart) {
      invalidLines.push(trimmed);
      continue;
    }

    valid.push({ en: enPart, hy: hyPart });
  }

  const { added, duplicates } = addWordsBulk(valid);
  setQuiz504Session(userId, { mode: 'quiz504_main' });

  let msg = `✅ Bulk import completed\n\nAdded: ${added}\nSkipped duplicates: ${duplicates}\nInvalid lines: ${invalidLines.length}`;
  if (invalidLines.length > 0) {
    msg += '\n\n*Invalid lines:*\n' + invalidLines.map(l => `• ${l}`).join('\n');
  }

  return ctx.reply(msg, { parse_mode: 'Markdown', ...handler.getMainMenu() });
}

// ── Main text handler ─────────────────────────────────────────────────────────

function handle504QuizText(ctx) {
  const userId = ctx.from.id;
  const text    = ctx.message.text;
  const session = getQuiz504Session(userId);

  // Add word submenu
  if (session.mode === MODE_ADD_WORD) {
    if (text === BTN_BACK)       { setQuiz504Session(userId, { mode: 'quiz504_main' }); return ctx.reply('📖 Quiz 504 — Essential Words\n\nChoose an option:', { parse_mode: 'Markdown', ...handler.getMainMenu() }); }
    if (text === BTN_ADD_SINGLE) { setQuiz504Session(userId, { mode: MODE_ADD_SINGLE }); return _addSinglePrompt(ctx); }
    if (text === BTN_BULK_ADD)   { setQuiz504Session(userId, { mode: MODE_BULK_ADD });   return _bulkPrompt(ctx); }
    return _addWordSubMenu(ctx);
  }

  if (session.mode === MODE_ADD_SINGLE) {
    if (text === BTN_BACK) { setQuiz504Session(userId, { mode: MODE_ADD_WORD }); return _addWordSubMenu(ctx); }
    return _handleAddSingleInput(ctx, text);
  }

  if (session.mode === MODE_BULK_ADD) {
    if (text === BTN_BACK) { setQuiz504Session(userId, { mode: MODE_ADD_WORD }); return _addWordSubMenu(ctx); }
    return _handleBulkInput(ctx, text);
  }

  // Units list
  if (session.mode === MODE_UNITS_LIST) {
    if (text === BTN_BACK) {
      setQuiz504Session(userId, { mode: 'quiz504_main' });
      return ctx.reply('📖 Quiz 504 — Essential Words\n\nChoose an option:', { parse_mode: 'Markdown', ...handler.getMainMenu() });
    }
    const m = text.match(UNIT_BTN_RE);
    if (m) return _showUnitView(ctx, Number(m[1]));
    return _showUnitsList(ctx);
  }

  // Inside a unit
  if (session.mode === MODE_UNIT_VIEW) {
    const unitId = session.currentUnitId;
    if (text === BTN_BACK)       return _showUnitsList(ctx);
    if (text === BTN_SHOW_WORDS) return _showUnitWords(ctx, unitId);
    if (text === BTN_PROGRESS)   return _showProgress(ctx);
    if (text === BTN_QUIZ_UNIT) {
      const pool = getWordsInUnit(unitId);
      return handler.startUnitPractice(ctx, 'en-hy', pool);
    }
    if (text === BTN_REV_UNIT) {
      const pool = getWordsInUnit(unitId);
      return handler.startUnitPractice(ctx, 'hy-en', pool);
    }
    return _showUnitView(ctx, unitId);
  }

  // Entry points from main mode
  if (session.mode === 'quiz504_main') {
    if (text === BTN_UNITS)    return _showUnitsList(ctx);
    if (text === BTN_ADD_WORD) { setQuiz504Session(userId, { mode: MODE_ADD_WORD }); return _addWordSubMenu(ctx); }
  }

  return handler.handleText(ctx);
}

module.exports = {
  BTN_QUIZ_504:        handler.ENTRY_BTN,
  init504:             (fn) => handler.init(fn),
  handle504QuizText,
  isIn504Quiz:         (userId) => handler.isActive(userId),
  clearQuiz504Session: (userId) => handler.clearSession(userId),
};
