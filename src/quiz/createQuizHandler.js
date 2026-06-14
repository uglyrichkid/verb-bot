'use strict';
const { Markup } = require('telegraf');
const {
  validateAnswer, getCorrectDisplay, formatDuration,
  groupByType, shuffle,
  getWeightedRandomWordFrom, getWeightedRoundPool, generateMCOptions,
} = require('./quizLogic');
const {
  recordWordAnswer, getRawWordStats,
  getMistakeWordIds, getDailyProgress, getHardWords,
} = require('../wordStats');

// ── Shared button labels ───────────────────────────────────────────────────────
const BTN = {
  SHOW:      '📚 Show all words',
  PRACTICE:  '📝 Practice mode',
  ROUND:     '🏁 Round mode',
  LEARN:     '🃏 Learn Words',
  MC:        '🎯 Multiple Choice',
  MISTAKES:  '📋 Practice Mistakes',
  HARD:      '💪 Hard Words',
  DAILY:     '📅 Daily Progress',
  BACK:      '⬅️ Back',
  EN_HY:     '🇬🇧 English → Armenian',
  HY_EN:     '🇦🇲 Armenian → English',
  MIXED_DIR: '🔀 Mixed direction',
  STOP:      '❌ Stop round',
  SIZE_10:   '🔹 10 words',
  SIZE_25:   '🔹 25 words',
  SIZE_50:   '🔹 50 words',
  SIZE_100:  '🔹 100 words',
  SIZE_ALL:  '🔹 All words',
  NEXT:      '▶️ Next',
  START_QUIZ:'🚀 Start Quiz',
};

const TYPE_LABELS = {
  verb: '🔤 Verbs',
  communication: '💬 Communication',
  word: '📖 Words',
};

// ── Factory ────────────────────────────────────────────────────────────────────

function createQuizHandler({ source, entryBtn, title, wordList, getSession, setSession, clearSession, isActive, extraMainMenuRows = [] }) {
  // Sorted copy of wordList for card/learn mode (shown by id order)
  const learnWords = [...wordList].sort((a, b) => a.id - b.id);

  let _mainMenu = null;

  // State name: quiz_main, quiz504_practice, etc.
  const S = (mode) => `${source}_${mode}`;

  // Pick actual direction, resolving 'mixed' to a random concrete direction.
  function pickDir(dir) {
    return dir === 'mixed' ? (Math.random() < 0.5 ? 'en-hy' : 'hy-en') : dir;
  }

  // ── Keyboards ──────────────────────────────────────────────────────────────

  function quizMainMenu() {
    return Markup.keyboard([
      [BTN.LEARN,    BTN.SHOW],
      [BTN.PRACTICE, BTN.MC],
      [BTN.ROUND,    BTN.MISTAKES],
      [BTN.HARD,     BTN.DAILY],
      ...extraMainMenuRows,
      [BTN.BACK],
    ]).resize();
  }

  function directionMenu() {
    return Markup.keyboard([
      [BTN.EN_HY],
      [BTN.HY_EN],
      [BTN.MIXED_DIR],
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
    return Markup.keyboard([[BTN.STOP, BTN.BACK]]).resize();
  }

  function practiceMenu() {
    return Markup.keyboard([[BTN.BACK]]).resize();
  }

  function learnMenu(hasNext) {
    const rows = hasNext ? [[BTN.NEXT], [BTN.START_QUIZ], [BTN.BACK]] : [[BTN.START_QUIZ], [BTN.BACK]];
    return Markup.keyboard(rows).resize();
  }

  function mcMenu(options) {
    return Markup.keyboard([...options.map(o => [o]), [BTN.BACK]]).resize();
  }

  // ── Display helpers ────────────────────────────────────────────────────────

  function askWord(ctx, word, dir, keyboard) {
    const q = dir === 'en-hy'
      ? `Translate to Armenian:\n*${word.en}*`
      : `Translate to English:\n*${word.hy[0]}*`;
    return ctx.reply(q, { parse_mode: 'Markdown', ...keyboard });
  }

  function showCard(ctx, word, index, total) {
    const ipaLine = word.ipa ? `\n${word.ipa}` : '';
    const hyLine = word.hy.join(' / ');
    const text = `🃏 *${index + 1}/${total}*\n\n*${word.en}*${ipaLine}\n${hyLine}`;
    return ctx.reply(text, { parse_mode: 'Markdown', ...learnMenu(index + 1 < total) });
  }

  function showMCQuestion(ctx, word, dir, keyboard) {
    const q = dir === 'en-hy'
      ? `Choose the Armenian translation:\n*${word.en}*`
      : `Choose the English translation:\n*${word.hy[0]}*`;
    return ctx.reply(q, { parse_mode: 'Markdown', ...keyboard });
  }

  async function sendAllWords(ctx) {
    const groups = groupByType(wordList);
    const typeKeys = Object.keys(groups);
    for (let ti = 0; ti < typeKeys.length; ti++) {
      const type = typeKeys[ti];
      const words = groups[type];
      const label = TYPE_LABELS[type] || type;
      const isLastGroup = ti === typeKeys.length - 1;
      const lines = words.map((w, i) => `${i + 1}. ${w.en} — ${w.hy.join(', ')}`);
      const chunks = [];
      let cur = '';
      for (const line of lines) {
        const next = cur ? `${cur}\n${line}` : line;
        if (next.length > 3800) { if (cur) chunks.push(cur); cur = line; }
        else cur = next;
      }
      if (cur) chunks.push(cur);
      for (let ci = 0; ci < chunks.length; ci++) {
        const isLast = isLastGroup && ci === chunks.length - 1;
        const text = ci === 0 ? `*${label}* (${words.length} words)\n\n${chunks[ci]}` : chunks[ci];
        await ctx.reply(text, { parse_mode: 'Markdown', ...(isLast ? quizMainMenu() : {}) });
      }
    }
  }

  function buildRoundStats(session, stopped) {
    const ms = Date.now() - (session.startTime || Date.now());
    const total = session.correct + session.wrong;
    const acc = total > 0 ? ((session.correct / total) * 100).toFixed(0) : '100';
    return (
      (stopped ? '🏁 Round stopped!\n' : '🏁 Round finished!\n') +
      `\n📚 Round size: ${session.roundSize}\n` +
      `📊 Result:\n- Words completed: ${session.correct}/${session.totalWords}\n` +
      `- Correct: ${session.correct}  Wrong: ${session.wrong}\n` +
      `- Accuracy: ${acc}%\n- Time: ${formatDuration(ms)}`
    );
  }

  function buildDailyProgressText(userId) {
    const { answered, correct, goal } = getDailyProgress(userId);
    const wrong = answered - correct;
    const pct = goal > 0 ? Math.min(Math.round(answered / goal * 100), 100) : 0;
    const filled = Math.round(pct / 10);
    const bar = '▓'.repeat(filled) + '░'.repeat(10 - filled);
    return (
      `📅 *Today's Progress*\n\n${bar} ${pct}%\n` +
      `📖 ${answered}/${goal} words\n` +
      `✅ Correct: ${correct}  ❌ Wrong: ${wrong}`
    );
  }

  // ── Mode transitions ───────────────────────────────────────────────────────

  function enterMain(ctx) {
    const userId = ctx.from.id;
    setSession(userId, { mode: S('main') });
    return ctx.reply(`*${title}*\n\nChoose an option:`, {
      parse_mode: 'Markdown',
      ...quizMainMenu(),
    });
  }

  function enterDirection(ctx, pendingMode) {
    const userId = ctx.from.id;
    setSession(userId, { mode: S('direction'), pendingMode });
    return ctx.reply('Choose translation direction:', directionMenu());
  }

  function enterRoundSize(ctx, direction) {
    const userId = ctx.from.id;
    setSession(userId, { mode: S('round_size'), direction });
    return ctx.reply('Choose round size:', roundSizeMenu());
  }

  function dispatchPendingMode(ctx, session, direction) {
    switch (session.pendingMode) {
      case 'practice': return startPractice(ctx, direction);
      case 'round':    return enterRoundSize(ctx, direction);
      case 'mc':       return startMC(ctx, direction);
      case 'mistakes': return startMistakes(ctx, direction);
      default:         return startPractice(ctx, direction);
    }
  }

  function startPractice(ctx, direction, wordPool) {
    const userId = ctx.from.id;
    const pool = wordPool || wordList;
    const rawStats = getRawWordStats(userId, source);
    const word = getWeightedRandomWordFrom(pool, rawStats);
    const qDir = pickDir(direction);
    setSession(userId, { mode: S('practice'), direction, currentWord: word, currentQuestionDir: qDir, wordPool: pool });
    const label = direction === 'mixed' ? 'Mixed' : direction === 'en-hy' ? 'English → Armenian' : 'Armenian → English';
    return ctx.reply(
      `📝 *Practice started!*\n📖 ${label}\n\nType your answer. Press ⬅️ Back to stop.`,
      { parse_mode: 'Markdown' }
    ).then(() => askWord(ctx, word, qDir, practiceMenu()));
  }

  function startRound(ctx, direction, roundSize) {
    const userId = ctx.from.id;
    const rawStats = getRawWordStats(userId, source);
    const queue = getWeightedRoundPool(roundSize, wordList, rawStats);
    const qDir = pickDir(direction);
    setSession(userId, {
      mode: S('round'), direction,
      queue, currentWord: queue[0], currentQuestionDir: qDir,
      totalWords: queue.length, roundSize: queue.length,
      correct: 0, wrong: 0, startTime: Date.now(),
    });
    const label = direction === 'mixed' ? 'Mixed' : direction === 'en-hy' ? 'English → Armenian' : 'Armenian → English';
    return ctx.reply(
      `🏁 *Round started!*\n📖 ${label}\n📚 ${queue.length} words to complete. Answer all correctly to finish!`,
      { parse_mode: 'Markdown' }
    ).then(() => askWord(ctx, queue[0], qDir, roundMenu()));
  }

  function startLearn(ctx) {
    const userId = ctx.from.id;
    setSession(userId, { mode: S('learn'), cardIndex: 0 });
    return showCard(ctx, learnWords[0], 0, learnWords.length);
  }

  function startMC(ctx, direction) {
    const userId = ctx.from.id;
    const rawStats = getRawWordStats(userId, source);
    const word = getWeightedRandomWordFrom(wordList, rawStats);
    const qDir = pickDir(direction);
    const { options, correct } = generateMCOptions(word, qDir, wordList);
    setSession(userId, {
      mode: S('mc'), direction,
      currentWord: word, currentQuestionDir: qDir,
      currentOptions: options, correctOption: correct,
    });
    const label = direction === 'mixed' ? 'Mixed' : direction === 'en-hy' ? 'English → Armenian' : 'Armenian → English';
    return ctx.reply(
      `🎯 *Multiple Choice!*\n📖 ${label}\n\nChoose the correct answer. Press ⬅️ Back to stop.`,
      { parse_mode: 'Markdown' }
    ).then(() => showMCQuestion(ctx, word, qDir, mcMenu(options)));
  }

  function startMistakes(ctx, direction) {
    const userId = ctx.from.id;
    const ids = getMistakeWordIds(userId, source);
    const pool = wordList.filter(w => ids.includes(w.id));
    if (pool.length === 0) {
      setSession(userId, { mode: S('main') });
      return ctx.reply('🎉 No mistakes recorded yet!\n\nKeep practicing to build your mistakes list.', quizMainMenu());
    }
    return startPractice(ctx, direction, pool);
  }

  function stopRound(ctx) {
    const userId = ctx.from.id;
    const session = getSession(userId);
    const msg = buildRoundStats(session, true);
    clearSession(userId);
    return ctx.reply(msg, { parse_mode: 'Markdown', ..._mainMenu() });
  }

  // ── Answer handlers ────────────────────────────────────────────────────────

  function handlePracticeAnswer(ctx, text, session) {
    const userId = ctx.from.id;
    const { direction, currentWord } = session;
    const effectiveDir = session.currentQuestionDir || direction;
    const isCorrect = validateAnswer(currentWord, text, effectiveDir);

    recordWordAnswer(userId, source, currentWord.id, isCorrect);

    const correctDisplay = getCorrectDisplay(currentWord, effectiveDir);
    const feedback = isCorrect
      ? `✅ Correct!\n${effectiveDir === 'en-hy' ? currentWord.en : currentWord.hy[0]} — ${correctDisplay}`
      : `❌ Wrong\nCorrect answer: *${correctDisplay}*`;

    // Determine next word pool (mistakes mode refreshes pool dynamically)
    let nextPool = session.wordPool || wordList;
    if (session.mode === S('mistakes')) {
      const updatedIds = getMistakeWordIds(userId, source);
      nextPool = wordList.filter(w => updatedIds.includes(w.id));
      if (nextPool.length === 0) {
        clearSession(userId);
        return ctx.reply(`${feedback}\n\n🎉 All mistakes cleared! Great job!`, {
          parse_mode: 'Markdown', ..._mainMenu(),
        });
      }
    }

    const rawStats = getRawWordStats(userId, source);
    const nextWord = getWeightedRandomWordFrom(nextPool, rawStats);
    const nextDir = pickDir(direction);
    session.currentWord = nextWord;
    session.currentQuestionDir = nextDir;
    session.wordPool = nextPool;

    return ctx.reply(feedback, { parse_mode: 'Markdown' })
      .then(() => askWord(ctx, nextWord, nextDir, practiceMenu()));
  }

  function handleRoundAnswer(ctx, text, session) {
    const userId = ctx.from.id;
    const { direction, queue } = session;
    const currentWord = queue[0];
    const effectiveDir = session.currentQuestionDir || direction;
    const isCorrect = validateAnswer(currentWord, text, effectiveDir);

    recordWordAnswer(userId, source, currentWord.id, isCorrect);

    const correctDisplay = getCorrectDisplay(currentWord, effectiveDir);
    let feedback;

    if (isCorrect) {
      session.correct++;
      queue.shift();
      feedback = `✅ Correct!\n${effectiveDir === 'en-hy' ? currentWord.en : currentWord.hy[0]} — ${correctDisplay}`;
      if (queue.length === 0) {
        const statsMsg = buildRoundStats(session, false);
        clearSession(userId);
        return ctx.reply(feedback, { parse_mode: 'Markdown' })
          .then(() => ctx.reply(statsMsg, { parse_mode: 'Markdown', ..._mainMenu() }));
      }
    } else {
      session.wrong++;
      queue.push(queue.shift());
      feedback = `❌ Wrong\nCorrect answer: *${correctDisplay}*`;
    }

    const nextDir = pickDir(direction);
    session.currentWord = queue[0];
    session.currentQuestionDir = nextDir;

    return ctx.reply(feedback, { parse_mode: 'Markdown' })
      .then(() => askWord(ctx, queue[0], nextDir, roundMenu()));
  }

  function handleMCAnswer(ctx, text, session) {
    const userId = ctx.from.id;
    const { direction, currentWord, currentQuestionDir, correctOption } = session;
    const isCorrect = text === correctOption;

    recordWordAnswer(userId, source, currentWord.id, isCorrect);

    const feedback = isCorrect
      ? `✅ Correct!\n${currentQuestionDir === 'en-hy' ? currentWord.en : currentWord.hy[0]} — ${correctOption}`
      : `❌ Wrong\nCorrect answer: *${correctOption}*`;

    const rawStats = getRawWordStats(userId, source);
    const nextWord = getWeightedRandomWordFrom(wordList, rawStats);
    const nextDir = pickDir(direction);
    const { options, correct } = generateMCOptions(nextWord, nextDir, wordList);

    session.currentWord = nextWord;
    session.currentQuestionDir = nextDir;
    session.currentOptions = options;
    session.correctOption = correct;

    return ctx.reply(feedback, { parse_mode: 'Markdown' })
      .then(() => showMCQuestion(ctx, nextWord, nextDir, mcMenu(options)));
  }

  // ── Info displays ──────────────────────────────────────────────────────────

  function showHardWords(ctx) {
    const userId = ctx.from.id;
    const hard = getHardWords(userId, source, wordList, 10);
    if (hard.length === 0) {
      return ctx.reply('💪 No word stats yet.\n\nPractice more to see your hardest words!', quizMainMenu());
    }
    const lines = hard.map((h, i) => {
      const acc = (h.accuracy * 100).toFixed(0);
      return `${i + 1}. *${h.word.en}* — ${h.word.hy[0]}\n   ${h.shown} attempts · ${acc}% accuracy · ${h.wrong} wrong`;
    });
    return ctx.reply(`💪 *Your Hardest Words:*\n\n${lines.join('\n\n')}`, {
      parse_mode: 'Markdown', ...quizMainMenu(),
    });
  }

  function showDailyProgress(ctx) {
    const userId = ctx.from.id;
    return ctx.reply(buildDailyProgressText(userId), { parse_mode: 'Markdown', ...quizMainMenu() });
  }

  // ── Main text handler ──────────────────────────────────────────────────────

  function handleText(ctx) {
    const userId = ctx.from.id;
    const text = ctx.message.text;
    const session = getSession(userId);

    if (text === entryBtn) return enterMain(ctx);

    switch (session.mode) {
      case S('main'):
        if (text === BTN.SHOW)     return sendAllWords(ctx);
        if (text === BTN.PRACTICE) return enterDirection(ctx, 'practice');
        if (text === BTN.ROUND)    return enterDirection(ctx, 'round');
        if (text === BTN.LEARN)    return startLearn(ctx);
        if (text === BTN.MC)       return enterDirection(ctx, 'mc');
        if (text === BTN.MISTAKES) return enterDirection(ctx, 'mistakes');
        if (text === BTN.HARD)     return showHardWords(ctx);
        if (text === BTN.DAILY)    return showDailyProgress(ctx);
        if (text === BTN.BACK) {
          clearSession(userId);
          return ctx.reply('Returned to main menu.', _mainMenu());
        }
        return ctx.reply('Choose an option:', quizMainMenu());

      case S('direction'):
        if (text === BTN.EN_HY)     return dispatchPendingMode(ctx, session, 'en-hy');
        if (text === BTN.HY_EN)     return dispatchPendingMode(ctx, session, 'hy-en');
        if (text === BTN.MIXED_DIR) return dispatchPendingMode(ctx, session, 'mixed');
        if (text === BTN.BACK)      return enterMain(ctx);
        return ctx.reply('Choose a direction:', directionMenu());

      case S('round_size'): {
        const SIZE_MAP = {
          [BTN.SIZE_10]: 10, [BTN.SIZE_25]: 25, [BTN.SIZE_50]: 50,
          [BTN.SIZE_100]: 100, [BTN.SIZE_ALL]: wordList.length,
        };
        if (SIZE_MAP[text] !== undefined) return startRound(ctx, session.direction, SIZE_MAP[text]);
        if (text === BTN.BACK) return enterDirection(ctx, 'round');
        return ctx.reply('Choose round size:', roundSizeMenu());
      }

      case S('practice'):
      case S('mistakes'):
        if (text === BTN.BACK) {
          clearSession(userId);
          return ctx.reply('Practice stopped.', _mainMenu());
        }
        return handlePracticeAnswer(ctx, text, session);

      case S('round'):
        if (text === BTN.STOP || text === BTN.BACK) return stopRound(ctx);
        return handleRoundAnswer(ctx, text, session);

      case S('learn'):
        if (text === BTN.START_QUIZ) return enterDirection(ctx, 'practice');
        if (text === BTN.BACK) {
          clearSession(userId);
          return ctx.reply('Returned to main menu.', _mainMenu());
        }
        if (text === BTN.NEXT) {
          const next = session.cardIndex + 1;
          if (next >= learnWords.length) {
            session.cardIndex = learnWords.length;
            return ctx.reply(
              "🎉 You've seen all words!\n\nReady to test yourself?",
              Markup.keyboard([[BTN.START_QUIZ], [BTN.BACK]]).resize()
            );
          }
          session.cardIndex = next;
          return showCard(ctx, learnWords[next], next, learnWords.length);
        }
        // Any other text: re-show current card
        return showCard(ctx, learnWords[Math.min(session.cardIndex, learnWords.length - 1)], session.cardIndex, learnWords.length);

      case S('mc'):
        if (text === BTN.BACK) {
          clearSession(userId);
          return ctx.reply('Practice stopped.', _mainMenu());
        }
        // Only accept taps on one of the current options
        if (session.currentOptions && session.currentOptions.includes(text)) {
          return handleMCAnswer(ctx, text, session);
        }
        // Re-ask current question if user typed something else
        return showMCQuestion(ctx, session.currentWord, session.currentQuestionDir, mcMenu(session.currentOptions));

      default:
        return enterMain(ctx);
    }
  }

  return {
    ENTRY_BTN: entryBtn,
    getMainMenu: quizMainMenu,
    init(mainMenuFn) { _mainMenu = mainMenuFn; },
    handleText,
    isActive,
    clearSession,
    startUnitPractice: startPractice,
  };
}

module.exports = { createQuizHandler };
