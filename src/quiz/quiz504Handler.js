'use strict';
const { Markup } = require('telegraf');
const { createQuizHandler } = require('./createQuizHandler');
const { getWords, findWord, addWord } = require('../words504Store');
const { getQuiz504Session, setQuiz504Session, clearQuiz504Session, isIn504Quiz } = require('./quiz504State');

const BTN_ADD_WORD = '➕ Add Word';
const BTN_BACK     = '⬅️ Back';

const MODE_ADD_WORD = 'quiz504_add_word';

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

function _addWordPrompt(ctx) {
  return ctx.reply(
    'Send word using format:\n\n`word | translation`\n\nExample:\n`achieve | հասնել`',
    { parse_mode: 'Markdown', ...Markup.keyboard([[BTN_BACK]]).resize() }
  );
}

async function _handleAddWordInput(ctx, text) {
  const userId = ctx.from.id;

  if (!text.includes('|')) {
    return ctx.reply(
      '❌ Invalid format. Use:\n\n`word | translation`\n\nExample:\n`achieve | հասնել`',
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
    return _handleAddWordInput(ctx, text);
  }

  if (text === BTN_ADD_WORD && session.mode === 'quiz504_main') {
    setQuiz504Session(userId, { mode: MODE_ADD_WORD });
    return _addWordPrompt(ctx);
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
