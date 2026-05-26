'use strict';
const { Markup } = require('telegraf');
const { getQuiz504Session, setQuiz504Session, clearQuiz504Session, isIn504Quiz } = require('./quiz504State');
const {
  validateAnswer,
  getCorrectDisplay,
  formatDuration,
  groupByType,
  shuffle,
} = require('./quizLogic');
const words504 = require('../words504');

const BTN = {
  QUIZ_504: '📖 Quiz 504',
  SHOW:     '📚 Show all words',
  PRACTICE: '📝 Practice mode',
  ROUND:    '🏁 Round mode',
  BACK:     '⬅️ Back',
  EN_HY:    '🇬🇧 English → Armenian',
  HY_EN:    '🇦🇲 Armenian → English',
  STOP:     '❌ Stop round',
  SIZE_10:  '🔹 10 words',
  SIZE_25:  '🔹 25 words',
  SIZE_50:  '🔹 50 words',
  SIZE_100: '🔹 100 words',
  SIZE_ALL: '🔹 All words',
};

const TYPE_LABELS = {
  word: '📖 504 Essential Words',
};

// ── Data helpers ───────────────────────────────────────────────────────────────

function getRoundPool(size) {
  return shuffle(words504).slice(0, Math.min(size, words504.length));
}

function getRandomWord() {
  return words504[Math.floor(Math.random() * words504.length)];
}

// ── Keyboards ──────────────────────────────────────────────────────────────────

function quiz504MainMenu() {
  return Markup.keyboard([
    [BTN.SHOW,  BTN.PRACTICE],
    [BTN.ROUND],
    [BTN.BACK],
  ]).resize();
}

function directionMenu() {
  return Markup.keyboard([
    [BTN.EN_HY],
    [BTN.HY_EN],
    [BTN.BACK],
  ]).resize();
}

function roundSizeMenu() {
  return Markup.keyboard([
    [BTN.SIZE_10, BTN.SIZE_25],
    [BTN.SIZE_50, BTN.SIZE_100],
    [BTN.SIZE_ALL],
    [BTN.BACK],
  ]).resize();
}

function roundMenu() {
  return Markup.keyboard([
    [BTN.STOP, BTN.BACK],
  ]).resize();
}

function practiceMenu() {
  return Markup.keyboard([
    [BTN.BACK],
  ]).resize();
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

let _mainMenu = null;

function askWord(ctx, word, direction, keyboard) {
  const q = direction === 'en-hy'
    ? `Translate to Armenian:\n*${word.en}*`
    : `Translate to English:\n*${word.hy[0]}*`;
  return ctx.reply(q, { parse_mode: 'Markdown', ...keyboard });
}

async function sendAll504Words(ctx) {
  const groups = groupByType(words504);
  const typeKeys = Object.keys(groups);

  for (let ti = 0; ti < typeKeys.length; ti++) {
    const type = typeKeys[ti];
    const words = groups[type];
    const label = TYPE_LABELS[type] || type;
    const isLastGroup = ti === typeKeys.length - 1;

    const lines = words.map((w, i) => `${i + 1}. ${w.en} — ${w.hy.join(', ')}`);

    const chunks = [];
    let current = '';
    for (const line of lines) {
      const next = current ? current + '\n' + line : line;
      if (next.length > 3800) {
        if (current) chunks.push(current);
        current = line;
      } else {
        current = next;
      }
    }
    if (current) chunks.push(current);

    for (let ci = 0; ci < chunks.length; ci++) {
      const isLastChunk = isLastGroup && ci === chunks.length - 1;
      const text = ci === 0
        ? `*${label}* (${words.length} words)\n\n${chunks[ci]}`
        : chunks[ci];

      await ctx.reply(text, {
        parse_mode: 'Markdown',
        ...(isLastChunk ? quiz504MainMenu() : {}),
      });
    }
  }
}

function buildRoundStats(session, stopped) {
  const durationMs = Date.now() - session.startTime;
  const totalAttempts = session.correct + session.wrong;
  const accuracy = totalAttempts > 0
    ? ((session.correct / totalAttempts) * 100).toFixed(0)
    : '100';

  const roundSizeLine = session.roundSize != null
    ? `\n📚 Round size: ${session.roundSize}\n`
    : '\n';

  return (
    (stopped ? '🏁 Round stopped!\n' : '🏁 Round finished!\n') +
    roundSizeLine +
    '📊 Result:\n' +
    `- Words completed: ${session.correct}/${session.totalWords}\n` +
    `- Correct answers: ${session.correct}\n` +
    `- Wrong answers: ${session.wrong}\n` +
    `- Total attempts: ${totalAttempts}\n` +
    `- Accuracy: ${accuracy}%\n` +
    `- Time: ${formatDuration(durationMs)}`
  );
}

// ── Mode transitions ───────────────────────────────────────────────────────────

function enter504QuizMain(ctx) {
  const userId = ctx.from.id;
  setQuiz504Session(userId, { mode: 'quiz504_main' });
  return ctx.reply('📖 *Quiz 504 — Essential Words*\n\nChoose an option:', {
    parse_mode: 'Markdown',
    ...quiz504MainMenu(),
  });
}

function enterDirection(ctx, pendingMode) {
  const userId = ctx.from.id;
  setQuiz504Session(userId, { mode: 'quiz504_direction', pendingMode });
  return ctx.reply('Choose direction:', directionMenu());
}

function enterRoundSize(ctx, direction) {
  const userId = ctx.from.id;
  setQuiz504Session(userId, { mode: 'quiz504_round_size', direction });
  return ctx.reply('Choose round size:', roundSizeMenu());
}

function startPractice(ctx, direction) {
  const userId = ctx.from.id;
  const word = getRandomWord();
  setQuiz504Session(userId, { mode: 'quiz504_practice', direction, currentWord: word });
  const label = direction === 'en-hy' ? 'English → Armenian' : 'Armenian → English';
  return ctx.reply(
    `📝 *Practice started!*\n📖 ${label}\n\nType your answer. Press ⬅️ Back to stop.`,
    { parse_mode: 'Markdown' }
  ).then(() => askWord(ctx, word, direction, practiceMenu()));
}

function startRound(ctx, direction, roundSize) {
  const userId = ctx.from.id;
  const queue = getRoundPool(roundSize);
  setQuiz504Session(userId, {
    mode: 'quiz504_round',
    direction,
    queue,
    currentWord: queue[0],
    totalWords: queue.length,
    roundSize: queue.length,
    correct: 0,
    wrong: 0,
    startTime: Date.now(),
  });
  const label = direction === 'en-hy' ? 'English → Armenian' : 'Armenian → English';
  return ctx.reply(
    `🏁 *Round started!*\n📖 ${label}\n📚 ${queue.length} words to complete. Answer all correctly to finish!`,
    { parse_mode: 'Markdown' }
  ).then(() => askWord(ctx, queue[0], direction, roundMenu()));
}

function handlePracticeAnswer(ctx, text, session) {
  const { direction, currentWord } = session;
  const isCorrect = validateAnswer(currentWord, text, direction);
  const correctDisplay = getCorrectDisplay(currentWord, direction);

  const feedback = isCorrect
    ? `✅ Correct!\n${direction === 'en-hy' ? currentWord.en : currentWord.hy[0]} — ${correctDisplay}`
    : `❌ Wrong\nCorrect answer: *${correctDisplay}*`;

  const nextWord = getRandomWord();
  session.currentWord = nextWord;

  return ctx.reply(feedback, { parse_mode: 'Markdown' })
    .then(() => askWord(ctx, nextWord, direction, practiceMenu()));
}

function handleRoundAnswer(ctx, text, session) {
  const userId = ctx.from.id;
  const { direction, queue } = session;
  const currentWord = queue[0];
  const isCorrect = validateAnswer(currentWord, text, direction);
  const correctDisplay = getCorrectDisplay(currentWord, direction);

  let feedback;
  if (isCorrect) {
    session.correct++;
    queue.shift();
    feedback = `✅ Correct!\n${direction === 'en-hy' ? currentWord.en : currentWord.hy[0]} — ${correctDisplay}`;

    if (queue.length === 0) {
      const statsMsg = buildRoundStats(session, false);
      clearQuiz504Session(userId);
      return ctx.reply(feedback, { parse_mode: 'Markdown' })
        .then(() => ctx.reply(statsMsg, { parse_mode: 'Markdown', ..._mainMenu() }));
    }
  } else {
    session.wrong++;
    const wrongWord = queue.shift();
    queue.push(wrongWord);
    feedback = `❌ Wrong\nCorrect answer: *${correctDisplay}*`;
  }

  session.currentWord = queue[0];
  return ctx.reply(feedback, { parse_mode: 'Markdown' })
    .then(() => askWord(ctx, queue[0], direction, roundMenu()));
}

function stopRound(ctx) {
  const userId = ctx.from.id;
  const session = getQuiz504Session(userId);
  const statsMsg = buildRoundStats(session, true);
  clearQuiz504Session(userId);
  return ctx.reply(statsMsg, { parse_mode: 'Markdown', ..._mainMenu() });
}

// ── Main entry point ───────────────────────────────────────────────────────────

function handle504QuizText(ctx) {
  const userId = ctx.from.id;
  const text = ctx.message.text;
  const session = getQuiz504Session(userId);

  if (text === BTN.QUIZ_504) return enter504QuizMain(ctx);

  switch (session.mode) {
    case 'quiz504_main':
      if (text === BTN.SHOW)     return sendAll504Words(ctx);
      if (text === BTN.PRACTICE) return enterDirection(ctx, 'practice');
      if (text === BTN.ROUND)    return enterDirection(ctx, 'round');
      if (text === BTN.BACK) {
        clearQuiz504Session(userId);
        return ctx.reply('Returned to main menu.', _mainMenu());
      }
      return ctx.reply('Choose an option from the quiz menu:', quiz504MainMenu());

    case 'quiz504_direction':
      if (text === BTN.EN_HY)
        return session.pendingMode === 'practice' ? startPractice(ctx, 'en-hy') : enterRoundSize(ctx, 'en-hy');
      if (text === BTN.HY_EN)
        return session.pendingMode === 'practice' ? startPractice(ctx, 'hy-en') : enterRoundSize(ctx, 'hy-en');
      if (text === BTN.BACK) return enter504QuizMain(ctx);
      return ctx.reply('Choose a direction:', directionMenu());

    case 'quiz504_round_size': {
      const SIZE_MAP = {
        [BTN.SIZE_10]:  10,
        [BTN.SIZE_25]:  25,
        [BTN.SIZE_50]:  50,
        [BTN.SIZE_100]: 100,
        [BTN.SIZE_ALL]: words504.length,
      };
      if (SIZE_MAP[text] !== undefined) return startRound(ctx, session.direction, SIZE_MAP[text]);
      if (text === BTN.BACK) return enterDirection(ctx, 'round');
      return ctx.reply('Choose round size:', roundSizeMenu());
    }

    case 'quiz504_practice':
      if (text === BTN.BACK) {
        clearQuiz504Session(userId);
        return ctx.reply('Practice stopped.', _mainMenu());
      }
      return handlePracticeAnswer(ctx, text, session);

    case 'quiz504_round':
      if (text === BTN.STOP || text === BTN.BACK) return stopRound(ctx);
      return handleRoundAnswer(ctx, text, session);

    default:
      return enter504QuizMain(ctx);
  }
}

// ── Exports ────────────────────────────────────────────────────────────────────

function init504(mainMenuFn) {
  _mainMenu = mainMenuFn;
}

module.exports = {
  BTN_QUIZ_504: BTN.QUIZ_504,
  init504,
  handle504QuizText,
  isIn504Quiz,
  clearQuiz504Session,
};
