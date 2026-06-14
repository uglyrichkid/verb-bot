'use strict';
const { Markup } = require('telegraf');
const { createQuizHandler } = require('./createQuizHandler');
const { getWords, findWord, addWord, addWordsBulk, getUnits, getWordsInUnit } = require('../words504Store');
const { getQuiz504Session, setQuiz504Session, clearQuiz504Session, isIn504Quiz } = require('./quiz504State');
const { validateAnswer, getCorrectDisplay, formatDuration, shuffle, getWeightedRandomWordFrom } = require('./quizLogic');
const { recordWordAnswer, getRawWordStats, getMistakeWordIds, getHardWords, getMasteryLevel } = require('../wordStats');

// ── Button labels ─────────────────────────────────────────────────────────────
const BTN_ADD_WORD      = '➕ Add Word';
const BTN_ADD_SINGLE    = '➕ Add Single Word';
const BTN_BULK_ADD      = '📥 Bulk Add Words';
const BTN_UNITS         = '📖 Units';
const BTN_SHOW_WORDS    = '📖 Show Words';
const BTN_UNIT_PRACTICE = '🎯 Practice Unit';
const BTN_UNIT_ROUND    = '🔁 Round Mode';
const BTN_UNIT_MIXED    = '🔄 Mixed Mode';
const BTN_UNIT_HARD     = '⭐ Hard Words';
const BTN_UNIT_MISTAKES = '❌ Practice Mistakes';
const BTN_UNIT_PROGRESS = '📊 Progress';
const BTN_BACK          = '⬅️ Back';
const BTN_BACK_UNITS    = '🔙 Back to Units';

// ── Session modes ─────────────────────────────────────────────────────────────
const MODE_ADD_WORD      = 'quiz504_add_word';
const MODE_ADD_SINGLE    = 'quiz504_add_single';
const MODE_BULK_ADD      = 'quiz504_bulk_add';
const MODE_UNITS_LIST    = 'quiz504_units_list';
const MODE_UNIT_VIEW     = 'quiz504_unit_view';
const MODE_UNIT_PRACTICE = 'quiz504_unit_practice';
const MODE_UNIT_ROUND    = 'quiz504_unit_round';
const MODE_UNIT_MIXED    = 'quiz504_unit_mixed';
const MODE_UNIT_HARD     = 'quiz504_unit_hard';
const MODE_UNIT_MISTAKES = 'quiz504_unit_mistakes';

const UNIT_BTN_RE = /^Unit (\d+) \(\d+ words?\)$/;

// ── Global Quiz 504 handler (all existing modes unchanged) ────────────────────
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
    [BTN_UNIT_PRACTICE],
    [BTN_UNIT_ROUND,    BTN_UNIT_MIXED],
    [BTN_UNIT_HARD,     BTN_UNIT_MISTAKES],
    [BTN_UNIT_PROGRESS],
    [BTN_SHOW_WORDS],
    [BTN_BACK_UNITS],
  ]).resize();
}

function _unitPracticeMenu() {
  return Markup.keyboard([[BTN_BACK_UNITS]]).resize();
}

function _unitRoundMenu() {
  return Markup.keyboard([[BTN_BACK_UNITS]]).resize();
}

// ── Shared unit utilities ─────────────────────────────────────────────────────

function _pickDir() {
  return Math.random() < 0.5 ? 'en-hy' : 'hy-en';
}

function _askUnitWord(ctx, word, dir, keyboard) {
  const q = dir === 'en-hy'
    ? `Translate to Armenian:\n*${word.en}*`
    : `Translate to English:\n*${word.hy[0]}*`;
  return ctx.reply(q, { parse_mode: 'Markdown', ...keyboard });
}

function _getUnitMistakePool(userId, unitId) {
  const mistakeIds = getMistakeWordIds(userId, 'quiz504');
  return getWordsInUnit(unitId).filter(w => mistakeIds.includes(w.id));
}

// ── Unit navigation ───────────────────────────────────────────────────────────

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
    `📘 *Unit ${unitId}*\n${words.length} words\n\nChoose an action:`,
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

function _showUnitProgress(ctx, unitId) {
  const userId = ctx.from.id;
  const words = getWordsInUnit(unitId);
  const rawStats = getRawWordStats(userId, 'quiz504');

  let totalCorrect = 0, totalWrong = 0, practiced = 0, mastered = 0;
  const wordDetails = [];

  for (const w of words) {
    const ws = rawStats[w.id];
    if (!ws || ws.shown === 0) {
      wordDetails.push({ word: w, shown: 0, correct: 0, wrong: 0, accuracy: 1 });
    } else {
      practiced++;
      totalCorrect += ws.correct;
      totalWrong += ws.wrong;
      const accuracy = ws.correct / ws.shown;
      wordDetails.push({ word: w, shown: ws.shown, correct: ws.correct, wrong: ws.wrong, accuracy });
      if (getMasteryLevel(ws) === 'mastered') mastered++;
    }
  }

  const totalAnswers = totalCorrect + totalWrong;
  const overallAcc = totalAnswers > 0 ? ((totalCorrect / totalAnswers) * 100).toFixed(0) : 0;
  const notPracticed = words.length - practiced;

  const weakWords = wordDetails
    .filter(d => d.shown > 0 && d.wrong > 0)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 5);

  let text = `📊 *Unit ${unitId} Progress*\n\n`;
  text += `Words: ${words.length}\n`;
  text += `Practiced: ${practiced}/${words.length}\n`;
  text += `Correct answers: ${totalCorrect}\n`;
  text += `Wrong answers: ${totalWrong}\n`;
  text += `Accuracy: ${overallAcc}%`;

  if (weakWords.length > 0) {
    text += '\n\n*Weak words:*\n';
    text += weakWords.map((d, i) => `${i + 1}. ${d.word.en} — wrong: ${d.wrong}, correct: ${d.correct}`).join('\n');
  }

  text += `\n\n*Mastered words:*\n${mastered}/${words.length}`;

  if (notPracticed > 0) {
    text += `\n\n*Not practiced yet:*\n${notPracticed} words`;
  }

  return ctx.reply(text, { parse_mode: 'Markdown', ..._unitViewMenu() });
}

// ── Unit training starters ────────────────────────────────────────────────────

function _startUnitPractice(ctx, unitId) {
  const userId = ctx.from.id;
  const pool = getWordsInUnit(unitId);
  if (pool.length === 0) return _showUnitView(ctx, unitId);

  const rawStats = getRawWordStats(userId, 'quiz504');
  const word = getWeightedRandomWordFrom(pool, rawStats);
  setQuiz504Session(userId, {
    mode: MODE_UNIT_PRACTICE,
    currentUnitId: unitId,
    currentWord: word,
    currentQuestionDir: 'en-hy',
    wordPool: pool,
  });
  return ctx.reply(
    `🎯 *Practice Unit ${unitId}*\nEnglish → Armenian\n\nType your answer. Press 🔙 Back to Units to stop.`,
    { parse_mode: 'Markdown' }
  ).then(() => _askUnitWord(ctx, word, 'en-hy', _unitPracticeMenu()));
}

function _startUnitMixed(ctx, unitId) {
  const userId = ctx.from.id;
  const pool = getWordsInUnit(unitId);
  if (pool.length === 0) return _showUnitView(ctx, unitId);

  const rawStats = getRawWordStats(userId, 'quiz504');
  const word = getWeightedRandomWordFrom(pool, rawStats);
  const dir = _pickDir();
  setQuiz504Session(userId, {
    mode: MODE_UNIT_MIXED,
    currentUnitId: unitId,
    currentWord: word,
    currentQuestionDir: dir,
    wordPool: pool,
  });
  return ctx.reply(
    `🔄 *Mixed Mode — Unit ${unitId}*\nRandom direction\n\nType your answer. Press 🔙 Back to Units to stop.`,
    { parse_mode: 'Markdown' }
  ).then(() => _askUnitWord(ctx, word, dir, _unitPracticeMenu()));
}

function _startUnitRound(ctx, unitId) {
  const userId = ctx.from.id;
  const words = getWordsInUnit(unitId);
  if (words.length === 0) return _showUnitView(ctx, unitId);

  const queue = shuffle([...words]);
  setQuiz504Session(userId, {
    mode: MODE_UNIT_ROUND,
    currentUnitId: unitId,
    queue,
    currentWord: queue[0],
    currentQuestionDir: 'en-hy',
    totalWords: queue.length,
    roundSize: queue.length,
    correct: 0,
    wrong: 0,
    startTime: Date.now(),
  });
  return ctx.reply(
    `🔁 *Round Mode — Unit ${unitId}*\n📚 ${queue.length} words to complete.\nWrong answers repeat. Finish all correctly to win!\n\nPress 🔙 Back to Units to stop.`,
    { parse_mode: 'Markdown' }
  ).then(() => _askUnitWord(ctx, queue[0], 'en-hy', _unitRoundMenu()));
}

function _startUnitHard(ctx, unitId) {
  const userId = ctx.from.id;
  const hard = getHardWords(userId, 'quiz504', getWordsInUnit(unitId), 10);

  if (hard.length === 0) {
    return ctx.reply(
      `⭐ No hard words yet in Unit ${unitId}.\n\nPractice more to see your hardest words!`,
      _unitViewMenu()
    );
  }

  const listLines = hard.map((h, i) => {
    const acc = (h.accuracy * 100).toFixed(0);
    return `${i + 1}. *${h.word.en}* — ${h.word.hy[0]}\n   ${h.shown} attempts · ${acc}% accuracy · ${h.wrong} wrong`;
  });

  const pool = hard.map(h => h.word);
  const rawStats = getRawWordStats(userId, 'quiz504');
  const word = getWeightedRandomWordFrom(pool, rawStats);

  setQuiz504Session(userId, {
    mode: MODE_UNIT_HARD,
    currentUnitId: unitId,
    currentWord: word,
    currentQuestionDir: 'en-hy',
    wordPool: pool,
  });

  return ctx.reply(
    `⭐ *Hard Words — Unit ${unitId}*\n\n${listLines.join('\n\n')}\n\nStarting practice...`,
    { parse_mode: 'Markdown' }
  ).then(() => _askUnitWord(ctx, word, 'en-hy', _unitPracticeMenu()));
}

function _startUnitMistakes(ctx, unitId) {
  const userId = ctx.from.id;
  const pool = _getUnitMistakePool(userId, unitId);

  if (pool.length === 0) {
    return ctx.reply(
      `❌ No mistakes recorded for Unit ${unitId} yet!\n\nKeep practicing to build your mistakes list.`,
      _unitViewMenu()
    );
  }

  const rawStats = getRawWordStats(userId, 'quiz504');
  const word = getWeightedRandomWordFrom(pool, rawStats);

  setQuiz504Session(userId, {
    mode: MODE_UNIT_MISTAKES,
    currentUnitId: unitId,
    currentWord: word,
    currentQuestionDir: 'en-hy',
    wordPool: pool,
  });

  return ctx.reply(
    `❌ *Practice Mistakes — Unit ${unitId}*\n${pool.length} mistake(s)\n\nType your answer. Press 🔙 Back to Units to stop.`,
    { parse_mode: 'Markdown' }
  ).then(() => _askUnitWord(ctx, word, 'en-hy', _unitPracticeMenu()));
}

// ── Unit answer handlers ──────────────────────────────────────────────────────

function _handleUnitPracticeAnswer(ctx, text, session) {
  const userId = ctx.from.id;
  const { currentWord, currentUnitId, mode } = session;
  const dir = session.currentQuestionDir || 'en-hy';
  const isCorrect = validateAnswer(currentWord, text, dir);

  recordWordAnswer(userId, 'quiz504', currentWord.id, isCorrect);

  const correctDisplay = getCorrectDisplay(currentWord, dir);
  const feedback = isCorrect
    ? `✅ Correct!\n${dir === 'en-hy' ? currentWord.en : currentWord.hy[0]} — ${correctDisplay}`
    : `❌ Wrong\nCorrect answer: *${correctDisplay}*`;

  // For mistakes mode: refresh pool; if empty, declare victory
  let nextPool = session.wordPool || getWordsInUnit(currentUnitId);
  if (mode === MODE_UNIT_MISTAKES) {
    nextPool = _getUnitMistakePool(userId, currentUnitId);
    if (nextPool.length === 0) {
      setQuiz504Session(userId, { mode: MODE_UNIT_VIEW, currentUnitId });
      return ctx.reply(`${feedback}\n\n🎉 All unit mistakes cleared! Great job!`, {
        parse_mode: 'Markdown', ..._unitViewMenu(),
      });
    }
  }

  const rawStats = getRawWordStats(userId, 'quiz504');
  const nextWord = getWeightedRandomWordFrom(nextPool, rawStats);
  const nextDir = mode === MODE_UNIT_MIXED ? _pickDir() : 'en-hy';

  session.currentWord = nextWord;
  session.currentQuestionDir = nextDir;
  session.wordPool = nextPool;

  return ctx.reply(feedback, { parse_mode: 'Markdown' })
    .then(() => _askUnitWord(ctx, nextWord, nextDir, _unitPracticeMenu()));
}

function _handleUnitRoundAnswer(ctx, text, session) {
  const userId = ctx.from.id;
  const { queue, currentUnitId } = session;
  const currentWord = queue[0];
  const dir = session.currentQuestionDir || 'en-hy';
  const isCorrect = validateAnswer(currentWord, text, dir);

  recordWordAnswer(userId, 'quiz504', currentWord.id, isCorrect);

  const correctDisplay = getCorrectDisplay(currentWord, dir);
  let feedback;

  if (isCorrect) {
    session.correct++;
    queue.shift();
    feedback = `✅ Correct!\n${currentWord.en} — ${correctDisplay}`;
    if (queue.length === 0) {
      const ms = Date.now() - (session.startTime || Date.now());
      const total = session.correct + session.wrong;
      const acc = total > 0 ? ((session.correct / total) * 100).toFixed(0) : '100';
      const statsMsg =
        `🏁 *Round finished!*\n\n` +
        `📚 Unit ${currentUnitId} — ${session.roundSize} words\n` +
        `📊 Result:\n- Words completed: ${session.correct}/${session.totalWords}\n` +
        `- Correct: ${session.correct}  Wrong: ${session.wrong}\n` +
        `- Accuracy: ${acc}%\n- Time: ${formatDuration(ms)}`;
      setQuiz504Session(userId, { mode: MODE_UNIT_VIEW, currentUnitId });
      return ctx.reply(feedback, { parse_mode: 'Markdown' })
        .then(() => ctx.reply(statsMsg, { parse_mode: 'Markdown', ..._unitViewMenu() }));
    }
  } else {
    session.wrong++;
    queue.push(queue.shift());
    feedback = `❌ Wrong\nCorrect answer: *${correctDisplay}*`;
  }

  session.currentWord = queue[0];
  session.currentQuestionDir = 'en-hy';

  return ctx.reply(feedback, { parse_mode: 'Markdown' })
    .then(() => _askUnitWord(ctx, queue[0], 'en-hy', _unitRoundMenu()));
}

// ── Add word helpers (unchanged) ──────────────────────────────────────────────

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
    'Send words in this format, one per line:\n\n`word | translation`\n\nExample:\n`make a decision | որոշում կայацнел`\n`make a mistake | схал anel`',
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

  // ── Add word modes ──────────────────────────────────────────────────────────
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

  // ── Units list ──────────────────────────────────────────────────────────────
  if (session.mode === MODE_UNITS_LIST) {
    if (text === BTN_BACK) {
      setQuiz504Session(userId, { mode: 'quiz504_main' });
      return ctx.reply('📖 Quiz 504 — Essential Words\n\nChoose an option:', { parse_mode: 'Markdown', ...handler.getMainMenu() });
    }
    const m = text.match(UNIT_BTN_RE);
    if (m) return _showUnitView(ctx, Number(m[1]));
    return _showUnitsList(ctx);
  }

  // ── Unit view (menu) ────────────────────────────────────────────────────────
  if (session.mode === MODE_UNIT_VIEW) {
    const unitId = session.currentUnitId;
    if (text === BTN_BACK_UNITS || text === BTN_BACK) return _showUnitsList(ctx);
    if (text === BTN_UNIT_PRACTICE)  return _startUnitPractice(ctx, unitId);
    if (text === BTN_UNIT_ROUND)     return _startUnitRound(ctx, unitId);
    if (text === BTN_UNIT_MIXED)     return _startUnitMixed(ctx, unitId);
    if (text === BTN_UNIT_HARD)      return _startUnitHard(ctx, unitId);
    if (text === BTN_UNIT_MISTAKES)  return _startUnitMistakes(ctx, unitId);
    if (text === BTN_UNIT_PROGRESS)  return _showUnitProgress(ctx, unitId);
    if (text === BTN_SHOW_WORDS)     return _showUnitWords(ctx, unitId);
    return _showUnitView(ctx, unitId);
  }

  // ── Unit practice / mixed / hard / mistakes ─────────────────────────────────
  if (session.mode === MODE_UNIT_PRACTICE || session.mode === MODE_UNIT_MIXED ||
      session.mode === MODE_UNIT_HARD     || session.mode === MODE_UNIT_MISTAKES) {
    if (text === BTN_BACK_UNITS || text === BTN_BACK) return _showUnitView(ctx, session.currentUnitId);
    return _handleUnitPracticeAnswer(ctx, text, session);
  }

  // ── Unit round ──────────────────────────────────────────────────────────────
  if (session.mode === MODE_UNIT_ROUND) {
    if (text === BTN_BACK_UNITS || text === BTN_BACK) {
      const { currentUnitId } = session;
      const ms = Date.now() - (session.startTime || Date.now());
      const total = session.correct + session.wrong;
      const acc = total > 0 ? ((session.correct / total) * 100).toFixed(0) : '0';
      const statsMsg =
        `🏁 *Round stopped!*\n\n` +
        `📚 Unit ${currentUnitId} — ${session.roundSize} words\n` +
        `📊 Result:\n- Words completed: ${session.correct}/${session.totalWords}\n` +
        `- Correct: ${session.correct}  Wrong: ${session.wrong}\n` +
        `- Accuracy: ${acc}%\n- Time: ${formatDuration(ms)}`;
      setQuiz504Session(userId, { mode: MODE_UNIT_VIEW, currentUnitId });
      return ctx.reply(statsMsg, { parse_mode: 'Markdown', ..._unitViewMenu() });
    }
    return _handleUnitRoundAnswer(ctx, text, session);
  }

  // ── Entry points from global main mode ──────────────────────────────────────
  if (session.mode === 'quiz504_main') {
    if (text === BTN_UNITS)    return _showUnitsList(ctx);
    if (text === BTN_ADD_WORD) { setQuiz504Session(userId, { mode: MODE_ADD_WORD }); return _addWordSubMenu(ctx); }
  }

  // ── Delegate everything else to the global quiz handler ─────────────────────
  return handler.handleText(ctx);
}

module.exports = {
  BTN_QUIZ_504:        handler.ENTRY_BTN,
  init504:             (fn) => handler.init(fn),
  handle504QuizText,
  isIn504Quiz:         (userId) => handler.isActive(userId),
  clearQuiz504Session: (userId) => handler.clearSession(userId),
};
