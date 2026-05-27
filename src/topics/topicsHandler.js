'use strict';
const { Markup } = require('telegraf');
const { CATEGORIES, getCategoryById, getUnitById, getUnitsForCategory } = require('../data/grammarUnits');
const openai = require('../services/openaiService');

// userId → {
//   waitingForGrammarAnswer: bool,
//   waitingForExerciseAnswer: bool,
//   selectedUnit: object|null,
//   selectedCategoryId: string|null,
//   currentExercise: object|null,
//   exerciseNumber: number,
// }
const state = new Map();

function getState(userId) {
  if (!state.has(userId)) {
    state.set(userId, {
      waitingForGrammarAnswer: false,
      waitingForExerciseAnswer: false,
      selectedUnit: null,
      selectedCategoryId: null,
      currentExercise: null,
      exerciseNumber: 0,
    });
  }
  return state.get(userId);
}

function isWaitingForGrammarAnswer(userId) {
  const s = state.get(userId);
  return !!(s && s.waitingForGrammarAnswer);
}

function isWaitingForExerciseAnswer(userId) {
  const s = state.get(userId);
  return !!(s && s.waitingForExerciseAnswer);
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
    [Markup.button.callback('📘 Explain',   `topic_explain:${unit.id}`),
     Markup.button.callback('🧩 Rules',     `topic_rules:${unit.id}`)],
    [Markup.button.callback('✍️ Examples',  `topic_examples:${unit.id}`),
     Markup.button.callback('🎯 Exercises', `topic_exercise_start:${unit.id}`)],
    [Markup.button.callback('✅ Check My Answer', `topic_check:${unit.id}`)],
    [Markup.button.callback('🔙 Back to Units', `topic_back_units:${unit.categoryId}`)],
  ]);
}

function exerciseFeedbackKeyboard(unitId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➡️ Next Exercise', `topic_exercise_next:${unitId}`),
     Markup.button.callback('🔙 Back to Unit',  `topic_back_unit:${unitId}`)],
  ]);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function escapeMarkdown(text) {
  return text.replace(/[_*[\]()~`>#+=|{}.!]/g, '\\$&');
}

function unitPageText(unit) {
  const cat = getCategoryById(unit.categoryId);
  return `📘 *Unit ${unit.id} — ${escapeMarkdown(unit.title)}*\n_Category: ${cat ? cat.name : unit.categoryId}_\n\nChoose what to practice:`;
}

// Strip markdown code fences that the model sometimes wraps JSON in
function parseExerciseJson(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && parsed.instruction && parsed.question) return parsed;
    return null;
  } catch {
    return null;
  }
}

function exerciseText(exercise, exerciseNumber) {
  if (exercise.raw) {
    return `🎯 Exercise ${exerciseNumber}\n\n${exercise.raw}\n\n✏️ Write your answer below:`;
  }
  const hint = exercise.hint ? `\n💡 ${exercise.hint}` : '';
  return `🎯 Exercise ${exerciseNumber}\n${exercise.instruction}\n\n${exercise.question}${hint}\n\n✏️ Write your answer below:`;
}

// Split text that exceeds Telegram's 4096-char limit
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

const KEY_ERR = '⚠️ OpenAI API key is not configured. Please add OPENAI_API_KEY to .env';
const GEN_ERR = '😔 Sorry, I could not generate this now. Please try again.';

function openaiErrMsg(err) {
  return err.message === 'OPENAI_API_KEY not configured' ? KEY_ERR : GEN_ERR;
}

// ── Exercise core ──────────────────────────────────────────────────────────────

async function runExercise(ctx, unit, exerciseNumber) {
  const loadingMsg = await ctx.reply('Generating exercise... ⏳');

  let exercise;
  try {
    const raw = await openai.generateSingleExercise(unit, exerciseNumber);
    const parsed = parseExerciseJson(raw);
    exercise = parsed || { raw };
  } catch (err) {
    await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, openaiErrMsg(err));
    return null;
  }

  const text = exerciseText(exercise, exerciseNumber);
  await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, text);
  return exercise;
}

// ── Public text handlers ───────────────────────────────────────────────────────

async function handleTopicsCommand(ctx) {
  const s = getState(ctx.from.id);
  s.waitingForGrammarAnswer = false;
  s.waitingForExerciseAnswer = false;
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

  const loadingMsg = await ctx.reply('Checking your answer... ⏳');

  try {
    const result = await openai.checkUserAnswer(unit, ctx.message.text);
    const parts = splitMessage(result);
    await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, parts[0]);
    for (let i = 1; i < parts.length; i++) await ctx.reply(parts[i]);
  } catch (err) {
    await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, openaiErrMsg(err));
  }

  await ctx.reply(unitPageText(unit), { parse_mode: 'Markdown', ...unitMenuKeyboard(unit) });
}

async function handleExerciseAnswer(ctx) {
  const userId = ctx.from.id;
  const s = getState(userId);
  s.waitingForExerciseAnswer = false;

  const unit = s.selectedUnit;
  const exercise = s.currentExercise;
  if (!unit || !exercise) {
    await ctx.reply('Please select a unit first. Use /topics to start.');
    return;
  }

  const loadingMsg = await ctx.reply('Checking... ⏳');

  try {
    const feedback = await openai.checkExerciseAnswer(unit, exercise, ctx.message.text);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      null,
      feedback,
      { reply_markup: exerciseFeedbackKeyboard(unit.id).reply_markup },
    );
  } catch (err) {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      null,
      openaiErrMsg(err),
      { reply_markup: exerciseFeedbackKeyboard(unit.id).reply_markup },
    );
  }
}

// Shared helper for Explain / Rules / Examples
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
    await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, openaiErrMsg(err));
  }
}

// ── Register all bot.action() and bot.command() handlers ──────────────────────

function init(bot) {
  bot.command('topics', (ctx) => handleTopicsCommand(ctx));

  // Navigation
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
    const s = getState(ctx.from.id);
    s.selectedUnit = unit;
    s.waitingForExerciseAnswer = false;
    await ctx.editMessageText(unitPageText(unit), {
      parse_mode: 'Markdown',
      ...unitMenuKeyboard(unit),
    });
  });

  // Back to unit from exercise feedback
  bot.action(/^topic_back_unit:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const unit = getUnitById(parseInt(ctx.match[1], 10));
    if (!unit) return;
    const s = getState(ctx.from.id);
    s.waitingForExerciseAnswer = false;
    s.currentExercise = null;
    await ctx.editMessageText(unitPageText(unit), {
      parse_mode: 'Markdown',
      ...unitMenuKeyboard(unit),
    });
  });

  // Content: Explain, Rules, Examples
  bot.action(/^topic_explain:(\d+)$/, (ctx) =>
    handleContentAction(ctx, ctx.match[1], '📘 Generating explanation', openai.generateUnitExplanation));

  bot.action(/^topic_rules:(\d+)$/, (ctx) =>
    handleContentAction(ctx, ctx.match[1], '🧩 Generating rules', openai.generateUnitRules));

  bot.action(/^topic_examples:(\d+)$/, (ctx) =>
    handleContentAction(ctx, ctx.match[1], '✍️ Generating examples', openai.generateUnitExamples));

  // Exercise: start first exercise
  bot.action(/^topic_exercise_start:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const unit = getUnitById(parseInt(ctx.match[1], 10));
    if (!unit) return;

    const s = getState(ctx.from.id);
    s.selectedUnit = unit;
    s.exerciseNumber = 1;
    s.waitingForExerciseAnswer = false;

    const exercise = await runExercise(ctx, unit, 1);
    if (!exercise) return;

    s.currentExercise = exercise;
    s.waitingForExerciseAnswer = true;
  });

  // Exercise: next exercise
  bot.action(/^topic_exercise_next:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const unit = getUnitById(parseInt(ctx.match[1], 10));
    if (!unit) return;

    const s = getState(ctx.from.id);
    s.selectedUnit = unit;
    s.exerciseNumber = (s.exerciseNumber || 0) + 1;
    s.waitingForExerciseAnswer = false;

    // Edit the feedback message to show the new exercise
    const exerciseNumber = s.exerciseNumber;
    await ctx.editMessageText('Generating exercise... ⏳');

    let exercise;
    try {
      const raw = await openai.generateSingleExercise(unit, exerciseNumber);
      const parsed = parseExerciseJson(raw);
      exercise = parsed || { raw };
    } catch (err) {
      await ctx.editMessageText(openaiErrMsg(err));
      return;
    }

    s.currentExercise = exercise;
    s.waitingForExerciseAnswer = true;
    await ctx.editMessageText(exerciseText(exercise, exerciseNumber));
  });

  // Check My Answer
  bot.action(/^topic_check:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const unit = getUnitById(parseInt(ctx.match[1], 10));
    if (!unit) return;
    const s = getState(ctx.from.id);
    s.waitingForGrammarAnswer = true;
    s.waitingForExerciseAnswer = false;
    s.selectedUnit = unit;
    await ctx.reply(
      `✍️ Write a sentence or answer for *Unit ${unit.id} — ${escapeMarkdown(unit.title)}*\n\nI will check it for you!`,
      { parse_mode: 'Markdown' },
    );
  });
}

module.exports = {
  init,
  handleTopicsCommand,
  handleGrammarAnswer,
  handleExerciseAnswer,
  isWaitingForGrammarAnswer,
  isWaitingForExerciseAnswer,
};
