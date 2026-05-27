'use strict';
const { Markup } = require('telegraf');
const { CATEGORIES, getCategoryById, getUnitById, getUnitsForCategory } = require('../data/grammarUnits');
const openai = require('../services/openaiService');

// userId → { waitingForGrammarAnswer: bool, selectedUnit: object|null, selectedCategoryId: string|null }
const state = new Map();

function getState(userId) {
  if (!state.has(userId)) state.set(userId, { waitingForGrammarAnswer: false, selectedUnit: null, selectedCategoryId: null });
  return state.get(userId);
}

function isWaitingForGrammarAnswer(userId) {
  const s = state.get(userId);
  return !!(s && s.waitingForGrammarAnswer);
}

// ── Keyboards ──────────────────────────────────────────────────────────────────

function categoriesKeyboard() {
  const rows = [];
  for (let i = 0; i < CATEGORIES.length; i += 2) {
    const row = [Markup.button.callback(CATEGORIES[i].name, `topic_cat:${CATEGORIES[i].id}`)];
    if (CATEGORIES[i + 1]) row.push(Markup.button.callback(CATEGORIES[i + 1].name, `topic_cat:${CATEGORIES[i + 1].id}`));
    rows.push(row);
  }
  return Markup.inlineKeyboard(rows);
}

function unitsKeyboard(categoryId) {
  const units = getUnitsForCategory(categoryId);
  const rows = units.map(u => {
    const label = u.title.length > 32 ? u.title.slice(0, 30) + '…' : u.title;
    return [Markup.button.callback(`${u.id}. ${label}`, `topic_unit:${u.id}`)];
  });
  rows.push([Markup.button.callback('🔙 Back to Categories', 'topic_back_categories')]);
  return Markup.inlineKeyboard(rows);
}

function unitMenuKeyboard(unit) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📘 Explain',    `topic_explain:${unit.id}`),
     Markup.button.callback('🧩 Rules',      `topic_rules:${unit.id}`)],
    [Markup.button.callback('✍️ Examples',   `topic_examples:${unit.id}`),
     Markup.button.callback('🎯 Exercises',  `topic_exercises:${unit.id}`)],
    [Markup.button.callback('✅ Check My Answer', `topic_check:${unit.id}`)],
    [Markup.button.callback('🔙 Back to Units', `topic_back_units:${unit.categoryId}`)],
  ]);
}

function unitPageText(unit) {
  const cat = getCategoryById(unit.categoryId);
  return `📘 *Unit ${unit.id} — ${escapeMarkdown(unit.title)}*\n_Category: ${cat ? cat.name : unit.categoryId}_\n\nChoose what to practice:`;
}

function escapeMarkdown(text) {
  return text.replace(/[_*[\]()~`>#+=|{}.!]/g, '\\$&');
}

// Split text that exceeds Telegram's 4096-char message limit
function splitMessage(text, maxLen = 4000) {
  if (text.length <= maxLen) return [text];
  const parts = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let idx = remaining.lastIndexOf('\n', maxLen);
    if (idx < 0) idx = maxLen;
    parts.push(remaining.slice(0, idx));
    remaining = remaining.slice(idx).trimStart();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleTopicsCommand(ctx) {
  const s = getState(ctx.from.id);
  s.waitingForGrammarAnswer = false;
  await ctx.reply('📚 *Grammar Topics*\n\nChoose a category:', {
    parse_mode: 'Markdown',
    ...categoriesKeyboard(),
  });
}

async function handleGrammarAnswer(ctx) {
  const userId = ctx.from.id;
  const s = getState(userId);
  s.waitingForGrammarAnswer = false;

  const unit = s.selectedUnit;
  if (!unit) {
    await ctx.reply('Please select a unit first. Use /topics to start.');
    return;
  }

  const userAnswer = ctx.message.text;
  const loadingMsg = await ctx.reply('Checking your answer... ⏳');

  try {
    const result = await openai.checkUserAnswer(unit, userAnswer);
    const parts = splitMessage(result);
    await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, parts[0]);
    for (let i = 1; i < parts.length; i++) await ctx.reply(parts[i]);
  } catch (err) {
    const msg = err.message === 'OPENAI_API_KEY not configured'
      ? '⚠️ OpenAI API key is not configured. Please add OPENAI_API_KEY to .env'
      : '😔 Sorry, I could not check your answer now. Please try again.';
    await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, msg);
  }

  // Return to unit menu so the user can keep practicing
  await ctx.reply(unitPageText(unit), { parse_mode: 'Markdown', ...unitMenuKeyboard(unit) });
}

// Shared helper for the four OpenAI content actions
async function handleContentAction(ctx, unitId, loadingLabel, generator) {
  await ctx.answerCbQuery();
  const unit = getUnitById(parseInt(unitId, 10));
  if (!unit) return;

  const loadingMsg = await ctx.reply(`${loadingLabel}... ⏳`);

  try {
    const text = await generator(unit);
    const parts = splitMessage(text);
    await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, parts[0]);
    for (let i = 1; i < parts.length; i++) await ctx.reply(parts[i]);
  } catch (err) {
    const msg = err.message === 'OPENAI_API_KEY not configured'
      ? '⚠️ OpenAI API key is not configured. Please add OPENAI_API_KEY to .env'
      : '😔 Sorry, I could not generate this now. Please try again.';
    await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, msg);
  }
}

// ── Register all bot.action() and bot.command() handlers ──────────────────────

function init(bot) {
  bot.command('topics', (ctx) => handleTopicsCommand(ctx));

  bot.action('topic_back_categories', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('📚 *Grammar Topics*\n\nChoose a category:', {
      parse_mode: 'Markdown',
      ...categoriesKeyboard(),
    });
  });

  bot.action(/^topic_cat:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const categoryId = ctx.match[1];
    const cat = getCategoryById(categoryId);
    if (!cat) return;
    getState(ctx.from.id).selectedCategoryId = categoryId;
    await ctx.editMessageText(`📂 *${cat.name}*\n\nChoose a unit:`, {
      parse_mode: 'Markdown',
      ...unitsKeyboard(categoryId),
    });
  });

  bot.action(/^topic_back_units:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const categoryId = ctx.match[1];
    const cat = getCategoryById(categoryId);
    if (!cat) return;
    await ctx.editMessageText(`📂 *${cat.name}*\n\nChoose a unit:`, {
      parse_mode: 'Markdown',
      ...unitsKeyboard(categoryId),
    });
  });

  bot.action(/^topic_unit:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const unit = getUnitById(parseInt(ctx.match[1], 10));
    if (!unit) return;
    getState(ctx.from.id).selectedUnit = unit;
    await ctx.editMessageText(unitPageText(unit), {
      parse_mode: 'Markdown',
      ...unitMenuKeyboard(unit),
    });
  });

  bot.action(/^topic_explain:(\d+)$/, (ctx) =>
    handleContentAction(ctx, ctx.match[1], '📘 Generating explanation', openai.generateUnitExplanation));

  bot.action(/^topic_rules:(\d+)$/, (ctx) =>
    handleContentAction(ctx, ctx.match[1], '🧩 Generating rules', openai.generateUnitRules));

  bot.action(/^topic_examples:(\d+)$/, (ctx) =>
    handleContentAction(ctx, ctx.match[1], '✍️ Generating examples', openai.generateUnitExamples));

  bot.action(/^topic_exercises:(\d+)$/, (ctx) =>
    handleContentAction(ctx, ctx.match[1], '🎯 Generating exercises', openai.generateUnitExercises));

  bot.action(/^topic_check:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const unit = getUnitById(parseInt(ctx.match[1], 10));
    if (!unit) return;
    const s = getState(ctx.from.id);
    s.waitingForGrammarAnswer = true;
    s.selectedUnit = unit;
    await ctx.reply(
      `✍️ Write a sentence or answer for *Unit ${unit.id} — ${escapeMarkdown(unit.title)}*\n\nI will check it for you!`,
      { parse_mode: 'Markdown' },
    );
  });
}

module.exports = { init, handleTopicsCommand, handleGrammarAnswer, isWaitingForGrammarAnswer };
