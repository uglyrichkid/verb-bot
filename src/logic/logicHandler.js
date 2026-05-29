'use strict';
const { Markup } = require('telegraf');
const openai = require('../services/openaiService');

const BTN_LOGIC = '🧠 English Logic Trainer';

const CB = {
  CHUNK:        'logic_chunk',
  NEXT:         'logic_next',
  JOURNAL:      'logic_journal',
  JOURNAL_AGAIN:'logic_journal_again',
  PATTERNS:     'logic_patterns',
  CHECK:        'logic_check',
  CHECK_AGAIN:  'logic_check_again',
  BACK:         'logic_back',
  CAT_STATUS:   'logic_cat_status',
  CAT_PROBLEM:  'logic_cat_problem',
  CAT_PROGRESS: 'logic_cat_progress',
  CAT_WAITING:  'logic_cat_waiting',
  CAT_FUTURE:   'logic_cat_future',
  CAT_REQUEST:  'logic_cat_request',
};

const CATEGORY_LABELS = {
  [CB.CAT_STATUS]:   'Status',
  [CB.CAT_PROBLEM]:  'Problem',
  [CB.CAT_PROGRESS]: 'Progress',
  [CB.CAT_WAITING]:  'Waiting',
  [CB.CAT_FUTURE]:   'Future',
  [CB.CAT_REQUEST]:  'Request',
};

const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      waitingForChunkAnswer: false,
      waitingForJournal: false,
      waitingForSentenceCheck: false,
      currentPattern: null,
    });
  }
  return sessions.get(userId);
}

function clearLogicSession(userId) {
  sessions.delete(userId);
}

function isInLogic(userId) {
  const s = sessions.get(userId);
  if (!s) return false;
  return s.waitingForChunkAnswer || s.waitingForJournal || s.waitingForSentenceCheck;
}

function menuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔁 Chunk Replacement', CB.CHUNK)],
    [Markup.button.callback('📓 Daily Work Journal', CB.JOURNAL)],
    [Markup.button.callback('🧩 Sentence Patterns', CB.PATTERNS)],
    [Markup.button.callback('✅ Check My Sentence', CB.CHECK)],
    [Markup.button.callback('🔙 Back', CB.BACK)],
  ]);
}

function categoriesKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Status', CB.CAT_STATUS),   Markup.button.callback('Problem', CB.CAT_PROBLEM)],
    [Markup.button.callback('Progress', CB.CAT_PROGRESS), Markup.button.callback('Waiting', CB.CAT_WAITING)],
    [Markup.button.callback('Future', CB.CAT_FUTURE),   Markup.button.callback('Request', CB.CAT_REQUEST)],
    [Markup.button.callback('🔙 Back', CB.BACK)],
  ]);
}

async function handleLogicCommand(ctx) {
  const s = getSession(ctx.from.id);
  s.waitingForChunkAnswer = false;
  s.waitingForJournal = false;
  s.waitingForSentenceCheck = false;
  s.currentPattern = null;
  await ctx.reply(
    '🧠 *English Logic Trainer*\n\nChoose a mode:',
    { parse_mode: 'Markdown', ...menuKeyboard() },
  );
}

async function handleLogicText(ctx) {
  const userId = ctx.from.id;
  const s = getSession(userId);

  if (s.waitingForChunkAnswer) {
    s.waitingForChunkAnswer = false;
    const pattern = s.currentPattern;
    await ctx.reply('Checking your sentence... ⏳');
    try {
      const feedback = await openai.checkChunkSentence(pattern, ctx.message.text);
      await ctx.reply(feedback, Markup.inlineKeyboard([
        [Markup.button.callback('➡️ Next Pattern', CB.NEXT)],
        [Markup.button.callback('🔙 Back to menu', CB.BACK)],
      ]));
    } catch {
      await ctx.reply('❌ Could not check. Try again.', menuKeyboard());
    }
    return;
  }

  if (s.waitingForJournal) {
    s.waitingForJournal = false;
    await ctx.reply('Checking your journal... ⏳');
    try {
      const feedback = await openai.checkWorkJournal(ctx.message.text);
      await ctx.reply(feedback, Markup.inlineKeyboard([
        [Markup.button.callback('📓 Write another journal', CB.JOURNAL_AGAIN)],
        [Markup.button.callback('🔙 Back to menu', CB.BACK)],
      ]));
    } catch {
      await ctx.reply('❌ Could not check. Try again.', menuKeyboard());
    }
    return;
  }

  if (s.waitingForSentenceCheck) {
    s.waitingForSentenceCheck = false;
    await ctx.reply('Checking your sentence... ⏳');
    try {
      const feedback = await openai.checkEnglishSentence(ctx.message.text);
      await ctx.reply(feedback, Markup.inlineKeyboard([
        [Markup.button.callback('✅ Check another sentence', CB.CHECK_AGAIN)],
        [Markup.button.callback('🔙 Back to menu', CB.BACK)],
      ]));
    } catch {
      await ctx.reply('❌ Could not check. Try again.', menuKeyboard());
    }
  }
}

async function startChunkMode(ctx) {
  try {
    const pattern = await openai.generateChunkPattern();
    const s = getSession(ctx.from.id);
    s.currentPattern = pattern;
    s.waitingForChunkAnswer = true;
    return pattern;
  } catch {
    return null;
  }
}

function init(bot) {
  // ── Back / menu ──────────────────────────────────────────────────────────────
  bot.action(CB.BACK, async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    s.waitingForChunkAnswer = false;
    s.waitingForJournal = false;
    s.waitingForSentenceCheck = false;
    s.currentPattern = null;
    await ctx.editMessageText(
      '🧠 *English Logic Trainer*\n\nChoose a mode:',
      { parse_mode: 'Markdown', ...menuKeyboard() },
    );
  });

  // ── Chunk Replacement ────────────────────────────────────────────────────────
  async function doChunk(ctx) {
    await ctx.editMessageText('Generating a pattern... ⏳');
    const pattern = await startChunkMode(ctx);
    if (!pattern) {
      await ctx.editMessageText('❌ Could not generate pattern. Try again.', menuKeyboard());
      return;
    }
    await ctx.editMessageText(
      `🔁 *Chunk Replacement*\n\nYour pattern:\n\n*${pattern}*\n\nWrite one sentence using this pattern:`,
      { parse_mode: 'Markdown' },
    );
  }

  bot.action(CB.CHUNK, async (ctx) => { await ctx.answerCbQuery(); await doChunk(ctx); });
  bot.action(CB.NEXT,  async (ctx) => { await ctx.answerCbQuery(); await doChunk(ctx); });

  // ── Daily Work Journal ───────────────────────────────────────────────────────
  async function doJournal(ctx) {
    const s = getSession(ctx.from.id);
    s.waitingForJournal = true;
    await ctx.editMessageText(
      '📓 *Daily Work Journal*\n\n' +
      'Write 5 sentences about today:\n\n' +
      '1. What I did today\n' +
      '2. What I checked\n' +
      '3. What problem I found\n' +
      '4. What I am waiting for\n' +
      '5. What I will do tomorrow\n\n' +
      'Send your text:',
      { parse_mode: 'Markdown' },
    );
  }

  bot.action(CB.JOURNAL,       async (ctx) => { await ctx.answerCbQuery(); await doJournal(ctx); });
  bot.action(CB.JOURNAL_AGAIN, async (ctx) => { await ctx.answerCbQuery(); await doJournal(ctx); });

  // ── Sentence Patterns ────────────────────────────────────────────────────────
  bot.action(CB.PATTERNS, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      '🧩 *Sentence Patterns*\n\nChoose a category:',
      { parse_mode: 'Markdown', ...categoriesKeyboard() },
    );
  });

  for (const [cbKey, label] of Object.entries(CATEGORY_LABELS)) {
    bot.action(cbKey, async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.editMessageText(`Generating ${label} patterns... ⏳`);
      try {
        const patterns = await openai.generateSentencePatterns(label);
        await ctx.editMessageText(patterns, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🧩 Other category', CB.PATTERNS)],
            [Markup.button.callback('🔙 Back to menu', CB.BACK)],
          ]),
        });
      } catch {
        await ctx.editMessageText('❌ Could not generate patterns. Try again.', categoriesKeyboard());
      }
    });
  }

  // ── Check My Sentence ────────────────────────────────────────────────────────
  async function doCheck(ctx) {
    const s = getSession(ctx.from.id);
    s.waitingForSentenceCheck = true;
    await ctx.editMessageText(
      '✅ *Check My Sentence*\n\nSend any English sentence and I will check it:',
      { parse_mode: 'Markdown' },
    );
  }

  bot.action(CB.CHECK,       async (ctx) => { await ctx.answerCbQuery(); await doCheck(ctx); });
  bot.action(CB.CHECK_AGAIN, async (ctx) => { await ctx.answerCbQuery(); await doCheck(ctx); });
}

module.exports = {
  BTN_LOGIC,
  init,
  handleLogicCommand,
  handleLogicText,
  isInLogic,
  clearLogicSession,
};
