'use strict';
const { Markup } = require('telegraf');
const { getQuizSession, setQuizSession, clearQuizSession, isInQuiz } = require('./quizState');
const {
  getRoundPool,
  getRandomWord,
  validateAnswer,
  getCorrectDisplay,
  formatDuration,
  groupByType,
  vocabulary,
} = require('./quizLogic');

const BTN = {
  QUIZ:     '🧠 Quiz',
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
  verb:          '🔤 Verbs',
  communication: '💬 Communication',
};

// ── Keyboards ──────────────────────────────────────────────────────────────────

function quizMainMenu() {
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

// ── Helpers ────────────────────────────────────────────────────────────────────

let _mainMenu = null;

function askWord(ctx, word, direction, keyboard) {
  const q = direction === 'en-hy'
    ? `Translate to Armenian:\n*${word.en}*`
    : `Translate to English:\n*${word.hy[0]}*`;
  return ctx.reply(q, { parse_mode: 'Markdown', ...keyboard });
}

async function sendAllWords(ctx) {
  const groups = groupByType(vocabulary);
  const typeKeys = Object.keys(groups);

  for (let ti = 0; ti < typeKeys.length; ti++) {
    const type = typeKeys[ti];
    const words = groups[type];
    const label = TYPE_LABELS[type] || type;
    const isLastGroup = ti === typeKeys.length - 1;

    const lines = words.map((w, i) => `${i + 1}. ${w.en} — ${w.hy.join(', ')}`);

    // Split lines into chunks that fit within Telegram's 4096 char limit
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
        ...(isLastChunk ? quizMainMenu() : {}),
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

function enterQuizMain(ctx) {
  const userId = ctx.from.id;
  setQuizSession(userId, { mode: 'quiz_main' });
  return ctx.reply('🧠 *Quiz — Word Translation*\n\nChoose an option:', {
    parse_mode: 'Markdown',
    ...quizMainMenu(),
  });
}

function enterDirection(ctx, pendingMode) {
  const userId = ctx.from.id;
  setQuizSession(userId, { mode: 'quiz_direction', pendingMode });
  return ctx.reply('Choose direction:', directionMenu());
}

function enterRoundSize(ctx, direction) {
  const userId = ctx.from.id;
  setQuizSession(userId, { mode: 'quiz_round_size', direction });
  return ctx.reply('Choose round size:', roundSizeMenu());
}

function startPractice(ctx, direction) {
  const userId = ctx.from.id;
  const word = getRandomWord();
  setQuizSession(userId, { mode: 'quiz_practice', direction, currentWord: word });
  const label = direction === 'en-hy' ? 'English → Armenian' : 'Armenian → English';
  return ctx.reply(
    `📝 *Practice started!*\n📖 ${label}\n\nType your answer. Press ⬅️ Back to stop.`,
    { parse_mode: 'Markdown' }
  ).then(() => askWord(ctx, word, direction, practiceMenu()));
}

function startRound(ctx, direction, roundSize) {
  const userId = ctx.from.id;
  const queue = getRoundPool(roundSize);
  setQuizSession(userId, {
    mode: 'quiz_round',
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
      clearQuizSession(userId);
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
  const session = getQuizSession(userId);
  const statsMsg = buildRoundStats(session, true);
  clearQuizSession(userId);
  return ctx.reply(statsMsg, { parse_mode: 'Markdown', ..._mainMenu() });
}

// ── Main entry point ───────────────────────────────────────────────────────────

function handleQuizText(ctx) {
  const userId = ctx.from.id;
  const text = ctx.message.text;
  const session = getQuizSession(userId);

  if (text === BTN.QUIZ) return enterQuizMain(ctx);

  switch (session.mode) {
    case 'quiz_main':
      if (text === BTN.SHOW)     return sendAllWords(ctx);
      if (text === BTN.PRACTICE) return enterDirection(ctx, 'practice');
      if (text === BTN.ROUND)    return enterDirection(ctx, 'round');
      if (text === BTN.BACK) {
        clearQuizSession(userId);
        return ctx.reply('Returned to main menu.', _mainMenu());
      }
      return ctx.reply('Choose an option from the quiz menu:', quizMainMenu());

    case 'quiz_direction':
      if (text === BTN.EN_HY)
        return session.pendingMode === 'practice' ? startPractice(ctx, 'en-hy') : enterRoundSize(ctx, 'en-hy');
      if (text === BTN.HY_EN)
        return session.pendingMode === 'practice' ? startPractice(ctx, 'hy-en') : enterRoundSize(ctx, 'hy-en');
      if (text === BTN.BACK) return enterQuizMain(ctx);
      return ctx.reply('Choose a direction:', directionMenu());

    case 'quiz_round_size': {
      const SIZE_MAP = {
        [BTN.SIZE_10]:  10,
        [BTN.SIZE_25]:  25,
        [BTN.SIZE_50]:  50,
        [BTN.SIZE_100]: 100,
        [BTN.SIZE_ALL]: vocabulary.length,
      };
      if (SIZE_MAP[text] !== undefined) return startRound(ctx, session.direction, SIZE_MAP[text]);
      if (text === BTN.BACK) return enterDirection(ctx, 'round');
      return ctx.reply('Choose round size:', roundSizeMenu());
    }

    case 'quiz_practice':
      if (text === BTN.BACK) {
        clearQuizSession(userId);
        return ctx.reply('Practice stopped.', _mainMenu());
      }
      return handlePracticeAnswer(ctx, text, session);

    case 'quiz_round':
      if (text === BTN.STOP || text === BTN.BACK) return stopRound(ctx);
      return handleRoundAnswer(ctx, text, session);

    default:
      return enterQuizMain(ctx);
  }
}

// ── Exports ────────────────────────────────────────────────────────────────────

function init(mainMenuFn) {
  _mainMenu = mainMenuFn;
}

module.exports = {
  BTN_QUIZ: BTN.QUIZ,
  init,
  handleQuizText,
  isInQuiz,
  clearQuizSession,
};
