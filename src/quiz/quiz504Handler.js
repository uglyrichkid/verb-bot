'use strict';
const { Markup } = require('telegraf');
const { createQuizHandler } = require('./createQuizHandler');
const { getWords, findWord, addWord, addWordsBulk } = require('../words504Store');
const { getQuiz504Session, setQuiz504Session, clearQuiz504Session, isIn504Quiz } = require('./quiz504State');

const BTN_ADD_WORD   = '➕ Add Word';
const BTN_ADD_SINGLE = '➕ Add Single Word';
const BTN_BULK_ADD   = '📥 Bulk Add Words';
const BTN_BACK       = '⬅️ Back';

const MODE_ADD_WORD   = 'quiz504_add_word';
const MODE_ADD_SINGLE = 'quiz504_add_single';
const MODE_BULK_ADD   = 'quiz504_bulk_add';

const handler = createQuizHandler({
  source:            'quiz504',
  entryBtn:          '📖 Quiz 504',
  title:             '📖 Quiz 504 — Essential Words',
  wordList:          getWords(),
  getSession:        getQuiz504Session,
  setSession:        setQuiz504Session,
  clearSession:      clearQuiz504Session,
  isActive:          isIn504Quiz,
  extraMainMenuRows: [[BTN_ADD_WORD]],
});

function _addWordSubMenu(ctx) {
  return ctx.reply(
    '➕ Add Word — Choose an option:',
    Markup.keyboard([[BTN_ADD_SINGLE], [BTN_BULK_ADD], [BTN_BACK]]).resize()
  );
}

function _addSinglePrompt(ctx) {
  return ctx.reply(
    'Send word using format:\n\n`word | translation`\n\nExample:\n`achieve | հասնել`',
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
      '❌ Invalid format. Use:\n\n`word | translation`\n\nExample:\n`achieve | հаснел`',
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
    `✅ Word added!\n\n*${newWord.en}* — ${newWord.hy[0]}\n\nNow available in Quiz 504.`,
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

function handle504QuizText(ctx) {
  const userId = ctx.from.id;
  const text    = ctx.message.text;
  const session = getQuiz504Session(userId);

  if (session.mode === MODE_ADD_WORD) {
    if (text === BTN_BACK) {
      setQuiz504Session(userId, { mode: 'quiz504_main' });
      return ctx.reply('📖 Quiz 504 — Essential Words\n\nChoose an option:', {
        parse_mode: 'Markdown', ...handler.getMainMenu(),
      });
    }
    if (text === BTN_ADD_SINGLE) {
      setQuiz504Session(userId, { mode: MODE_ADD_SINGLE });
      return _addSinglePrompt(ctx);
    }
    if (text === BTN_BULK_ADD) {
      setQuiz504Session(userId, { mode: MODE_BULK_ADD });
      return _bulkPrompt(ctx);
    }
    return _addWordSubMenu(ctx);
  }

  if (session.mode === MODE_ADD_SINGLE) {
    if (text === BTN_BACK) {
      setQuiz504Session(userId, { mode: MODE_ADD_WORD });
      return _addWordSubMenu(ctx);
    }
    return _handleAddSingleInput(ctx, text);
  }

  if (session.mode === MODE_BULK_ADD) {
    if (text === BTN_BACK) {
      setQuiz504Session(userId, { mode: MODE_ADD_WORD });
      return _addWordSubMenu(ctx);
    }
    return _handleBulkInput(ctx, text);
  }

  if (text === BTN_ADD_WORD && session.mode === 'quiz504_main') {
    setQuiz504Session(userId, { mode: MODE_ADD_WORD });
    return _addWordSubMenu(ctx);
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
