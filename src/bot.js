require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const verbs = require('./verbs');
const { getUserStats, recordAnswer, recordRound } = require('./stats');
const { BTN_QUIZ, init: initQuiz, handleQuizText, isInQuiz, clearQuizSession } = require('./quiz/quizHandler');

if (!process.env.BOT_TOKEN) {
  console.error('Error: BOT_TOKEN is not set. Create a .env file with BOT_TOKEN=your_token');
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

const ROUND_SIZE = 50;

// Button labels — single source of truth for all text comparisons
const BTN = {
  SHOW_VERBS:   '📚 Show all verbs',
  PRACTICE:     '🎯 Practice mode',
  ROUND:        '🏁 Round mode',
  STATS:        '📊 Stats',
  STOP:         '🛑 Stop',
  TYPE_MIXED:   '🔀 Mixed',
  TYPE_IRR:     '🔴 Irregular only',
  TYPE_REG:     '🟢 Regular only',
  DIR_FORWARD:  '➡️ Base → Past',
  DIR_REVERSE:  '🔁 Past → Base',
};

// Sessions: userId → session object
// Modes: null | 'selecting_type' | 'selecting_direction' | 'practice' | 'round'
const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) sessions.set(userId, { mode: null });
  return sessions.get(userId);
}

function clearSession(userId) {
  sessions.set(userId, { mode: null });
}

// ── Keyboards ─────────────────────────────────────────────────────────────────

function mainMenu() {
  return Markup.keyboard([
    [BTN.SHOW_VERBS, BTN.PRACTICE],
    [BTN.ROUND,      BTN.STATS],
    [BTN_QUIZ],
    [BTN.STOP],
  ]).resize();
}

initQuiz(mainMenu);

function typeMenu() {
  return Markup.keyboard([
    [BTN.TYPE_MIXED],
    [BTN.TYPE_IRR, BTN.TYPE_REG],
    [BTN.STOP],
  ]).resize();
}

function directionMenu() {
  return Markup.keyboard([
    [BTN.DIR_FORWARD, BTN.DIR_REVERSE],
    [BTN.STOP],
  ]).resize();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function formatDuration(ms) {
  const totalSecs = Math.floor(ms / 1000);
  const mins = String(Math.floor(totalSecs / 60)).padStart(2, '0');
  const secs = String(totalSecs % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

function filterVerbs(verbType) {
  if (verbType === 'irregular') return verbs.filter(v => v.type === 'irregular');
  if (verbType === 'regular')   return verbs.filter(v => v.type === 'regular');
  return verbs; // mixed
}

const TYPE_LABEL = { mixed: 'Mixed', irregular: 'Irregular', regular: 'Regular' };

function askVerb(ctx, verb, direction) {
  if (direction === 'reverse') {
    return ctx.reply(
      `What is the *Base form* of: *${verb.past}*?`,
      { parse_mode: 'Markdown', ...mainMenu() }
    );
  }
  return ctx.reply(
    `What is the *Past Simple* of: *${verb.base}*?`,
    { parse_mode: 'Markdown', ...mainMenu() }
  );
}

// ── Menu handlers ─────────────────────────────────────────────────────────────

function handleShowVerbs(ctx) {
  const irregular = verbs.filter(v => v.type === 'irregular');
  const regular   = verbs.filter(v => v.type === 'regular');

  const irrList = irregular.map(v => `${v.base} → ${v.past}`).join('\n');
  const regList = regular.map(v => `${v.base} → ${v.past}`).join('\n');

  ctx.reply(
    `🔴 *Irregular verbs (${irregular.length}):*\n\n${irrList}`,
    { parse_mode: 'Markdown' }
  );
  ctx.reply(
    `🟢 *Regular verbs (${regular.length}):*\n\n${regList}`,
    { parse_mode: 'Markdown', ...mainMenu() }
  );
}

function handlePractice(ctx) {
  const userId = ctx.from.id;
  sessions.set(userId, { mode: 'selecting_type', pendingMode: 'practice' });
  ctx.reply('🎯 *Practice mode*\n\nChoose verb type:', { parse_mode: 'Markdown', ...typeMenu() });
}

function handleRound(ctx) {
  const userId = ctx.from.id;
  sessions.set(userId, { mode: 'selecting_type', pendingMode: 'round' });
  ctx.reply('🏁 *Round mode*\n\nChoose verb type:', { parse_mode: 'Markdown', ...typeMenu() });
}

function handleTypeSelection(ctx, text) {
  const userId = ctx.from.id;
  const session = getSession(userId);

  if (session.mode !== 'selecting_type') {
    ctx.reply('Please choose Practice or Round mode first.', mainMenu());
    return;
  }

  const verbType = text === BTN.TYPE_MIXED ? 'mixed'
                 : text === BTN.TYPE_IRR   ? 'irregular'
                 :                           'regular';

  session.verbType = verbType;
  session.mode = 'selecting_direction';

  ctx.reply('Choose direction:', directionMenu());
}

function handleDirectionSelection(ctx, text) {
  const userId = ctx.from.id;
  const session = getSession(userId);

  if (session.mode !== 'selecting_direction') {
    ctx.reply('Please choose Practice or Round mode first.', mainMenu());
    return;
  }

  const direction = text === BTN.DIR_FORWARD ? 'forward' : 'reverse';
  const { pendingMode, verbType } = session;

  if (pendingMode === 'practice') {
    startPractice(ctx, verbType, direction);
  } else {
    startRound(ctx, verbType, direction);
  }
}

function startPractice(ctx, verbType, direction) {
  const userId = ctx.from.id;
  const pool = filterVerbs(verbType);
  const verb = pool[Math.floor(Math.random() * pool.length)];

  sessions.set(userId, { mode: 'practice', verbType, direction, currentVerb: verb, verbPool: pool });

  const dirLabel = direction === 'forward' ? 'Base → Past' : 'Past → Base';
  ctx.reply(
    `🎯 *Practice started!*\n📘 ${TYPE_LABEL[verbType]} | ${dirLabel}\nAnswer each verb. Press 🛑 Stop to quit.`,
    { parse_mode: 'Markdown', ...mainMenu() }
  ).then(() => askVerb(ctx, verb, direction));
}

function startRound(ctx, verbType, direction) {
  const userId = ctx.from.id;
  const pool = filterVerbs(verbType);
  const queue = shuffle(pool).slice(0, ROUND_SIZE);

  sessions.set(userId, {
    mode: 'round',
    verbType,
    direction,
    queue,
    currentVerb: queue[0],
    startTime: Date.now(),
    correct: 0,
    wrong: 0,
    mistakes: {},   // { verbBase: [wrongAnswer, ...] }
    totalVerbs: queue.length,
  });

  const dirLabel = direction === 'forward' ? 'Base → Past' : 'Past → Base';
  ctx.reply(
    `🏁 *Round started!*\n📘 ${TYPE_LABEL[verbType]} | ${dirLabel}\n📚 ${queue.length} verbs to go. Answer each correctly to complete the round!`,
    { parse_mode: 'Markdown', ...mainMenu() }
  ).then(() => askVerb(ctx, queue[0], direction));
}

function handleStats(ctx) {
  const stats = getUserStats(ctx.from.id);
  const accuracy = stats.total > 0
    ? ((stats.correct / stats.total) * 100).toFixed(1)
    : '0.0';

  let msg =
    `📊 *Your Statistics*\n\n` +
    `✅ Correct:  ${stats.correct}\n` +
    `❌ Wrong:    ${stats.wrong}\n` +
    `📝 Total:    ${stats.total}\n` +
    `🎯 Accuracy: ${accuracy}%\n` +
    `🏁 Rounds completed: ${stats.completedRounds || 0}`;

  if (stats.bestRoundMs) {
    msg += `\n⏱ Best round time: ${formatDuration(stats.bestRoundMs)}`;
  }

  ctx.reply(msg, { parse_mode: 'Markdown', ...mainMenu() });
}

function handleStop(ctx) {
  clearSession(ctx.from.id);
  clearQuizSession(ctx.from.id);
  ctx.reply('🛑 Training stopped. Choose a mode from the menu.', mainMenu());
}

function finishRound(ctx) {
  const userId = ctx.from.id;
  const session = getSession(userId);
  const durationMs = Date.now() - session.startTime;
  const totalAnswers = session.correct + session.wrong;
  const accuracy = totalAnswers > 0
    ? ((session.correct / totalAnswers) * 100).toFixed(0)
    : '100';

  recordRound(userId, { durationMs });

  const dirLabel = session.direction === 'forward' ? 'Base→Past' : 'Past→Base';

  let msg =
    `🏁 *Round finished!*\n\n` +
    `📘 Mode: ${TYPE_LABEL[session.verbType]}\n` +
    `🔁 Direction: ${dirLabel}\n` +
    `📚 Round size: ${session.totalVerbs}\n` +
    `⏱ Time: ${formatDuration(durationMs)}\n` +
    `✅ Correct answers: ${session.correct}\n` +
    `❌ Wrong answers: ${session.wrong}\n` +
    `🎯 Accuracy: ${accuracy}%\n\n` +
    `🔥 Mistakes:`;

  const mistakeEntries = Object.entries(session.mistakes);
  if (mistakeEntries.length === 0) {
    msg += ' Perfect round! 🌟';
  } else {
    msg += '\n' + mistakeEntries
      .map(([base, wrongAnswers]) => {
        const verb = verbs.find(v => v.base === base);
        if (session.direction === 'reverse') {
          return `- ${verb.past} → ${verb.base} (your answers: ${wrongAnswers.join(', ')})`;
        }
        return `- ${verb.base} → ${verb.past} (your answers: ${wrongAnswers.join(', ')})`;
      })
      .join('\n');
  }

  clearSession(userId);
  ctx.reply(msg, { parse_mode: 'Markdown', ...mainMenu() });
}

// ── Commands (backwards-compatible) ───────────────────────────────────────────

bot.start((ctx) => {
  ctx.reply(
    `👋 Welcome to the *Verb Quiz Bot!*\n\n` +
    `Practice Past Simple forms of *${verbs.length} verbs* — irregular and regular.\n\n` +
    `Choose a mode from the menu below:`,
    { parse_mode: 'Markdown', ...mainMenu() }
  );
});

bot.command('quiz',  (ctx) => handlePractice(ctx));
bot.command('stop',  (ctx) => handleStop(ctx));
bot.command('stats', (ctx) => handleStats(ctx));

// ── Text handler ───────────────────────────────────────────────────────────────

bot.on('text', (ctx) => {
  const text = ctx.message.text;

  // Quiz: route when entering or mid-session (checked before verb buttons to handle shared labels)
  if (text === BTN_QUIZ || isInQuiz(ctx.from.id)) {
    return handleQuizText(ctx);
  }

  // Main menu buttons — always handled, never treated as quiz answers
  if (text === BTN.SHOW_VERBS) return handleShowVerbs(ctx);
  if (text === BTN.PRACTICE)   return handlePractice(ctx);
  if (text === BTN.ROUND)      return handleRound(ctx);
  if (text === BTN.STATS)      return handleStats(ctx);
  if (text === BTN.STOP)       return handleStop(ctx);

  // Selection-step buttons
  if (text === BTN.TYPE_MIXED || text === BTN.TYPE_IRR || text === BTN.TYPE_REG) {
    return handleTypeSelection(ctx, text);
  }
  if (text === BTN.DIR_FORWARD || text === BTN.DIR_REVERSE) {
    return handleDirectionSelection(ctx, text);
  }

  // Guard: no active quiz session
  const userId = ctx.from.id;
  const session = getSession(userId);

  if (!session.mode) {
    ctx.reply('Choose a mode from the menu below.', mainMenu());
    return;
  }
  if (session.mode === 'selecting_type') {
    ctx.reply('Please select a verb type from the buttons.', typeMenu());
    return;
  }
  if (session.mode === 'selecting_direction') {
    ctx.reply('Please select a direction from the buttons.', directionMenu());
    return;
  }

  // ── Quiz answer ──────────────────────────────────────────────────────────────
  const answer = text.trim().toLowerCase();
  const { currentVerb, direction } = session;
  const correctAnswer = direction === 'reverse'
    ? currentVerb.base.toLowerCase()
    : currentVerb.past.toLowerCase();
  const isCorrect = answer === correctAnswer;

  recordAnswer(userId, isCorrect);

  let feedback;
  if (isCorrect) {
    feedback = direction === 'reverse'
      ? `✅ *Correct!* ${currentVerb.past} → ${currentVerb.base}`
      : `✅ *Correct!* ${currentVerb.base} → ${currentVerb.past}`;
  } else {
    feedback = direction === 'reverse'
      ? `❌ *Wrong.* ${currentVerb.past} → ${currentVerb.base}`
      : `❌ *Wrong.* ${currentVerb.base} → ${currentVerb.past}`;
  }

  if (currentVerb.note) {
    feedback += `\n💡 _${currentVerb.note}_`;
  }

  if (session.mode === 'practice') {
    const nextVerb = session.verbPool[Math.floor(Math.random() * session.verbPool.length)];
    session.currentVerb = nextVerb;
    ctx.reply(feedback, { parse_mode: 'Markdown' }).then(() => askVerb(ctx, nextVerb, direction));

  } else if (session.mode === 'round') {
    if (isCorrect) {
      session.correct++;
      session.queue.shift();
      if (session.queue.length === 0) {
        ctx.reply(feedback, { parse_mode: 'Markdown' }).then(() => finishRound(ctx));
        return;
      }
      session.currentVerb = session.queue[0];
    } else {
      session.wrong++;
      const wrongVerb = session.queue.shift();
      if (!session.mistakes[currentVerb.base]) session.mistakes[currentVerb.base] = [];
      session.mistakes[currentVerb.base].push(answer);
      session.queue.push(wrongVerb);   // move to end — ask again later
      session.currentVerb = session.queue[0];
    }
    ctx.reply(feedback, { parse_mode: 'Markdown' }).then(() => askVerb(ctx, session.currentVerb, direction));
  }
});

bot.launch();
console.log('✅ Bot is running. Press Ctrl+C to stop.');

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
