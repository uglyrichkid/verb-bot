require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const verbs = require('./verbs');
const { getUserStats, recordAnswer, recordRound } = require('./stats');

if (!process.env.BOT_TOKEN) {
  console.error('Error: BOT_TOKEN is not set. Create a .env file with BOT_TOKEN=your_token');
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

// Button labels
const BTN = {
  SHOW_VERBS: '📚 Show all verbs',
  PRACTICE:   '🎯 Practice mode',
  ROUND:      '🏁 Round mode',
  STATS:      '📊 Stats',
  STOP:       '🛑 Stop',
};

// In-memory sessions: userId -> session object
// practice session: { mode: 'practice', currentVerb }
// round session:    { mode: 'round', queue, currentVerb, startTime, correct, wrong, mistakes, totalVerbs }
const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) sessions.set(userId, { mode: null });
  return sessions.get(userId);
}

function clearSession(userId) {
  sessions.set(userId, { mode: null });
}

function mainMenu() {
  return Markup.keyboard([
    [BTN.SHOW_VERBS, BTN.PRACTICE],
    [BTN.ROUND,      BTN.STATS],
    [BTN.STOP],
  ]).resize();
}

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

function askVerb(ctx, verb) {
  return ctx.reply(
    `What is the *Past Simple* of: *${verb.base}*?`,
    { parse_mode: 'Markdown', ...mainMenu() }
  );
}

// ── Handlers ──────────────────────────────────────────────────────────────────

function handleShowVerbs(ctx) {
  const list = verbs.map(v => `${v.base} → ${v.past}`).join('\n');
  ctx.reply(`*Base form → Past Simple*\n\n${list}`, { parse_mode: 'Markdown', ...mainMenu() });
}

function handlePractice(ctx) {
  const userId = ctx.from.id;
  const verb = verbs[Math.floor(Math.random() * verbs.length)];
  sessions.set(userId, { mode: 'practice', currentVerb: verb });
  ctx.reply(
    '🎯 *Practice mode started!*\nAnswer each verb. Press 🛑 Stop to quit.',
    { parse_mode: 'Markdown', ...mainMenu() }
  ).then(() => askVerb(ctx, verb));
}

function handleRound(ctx) {
  const userId = ctx.from.id;
  const queue = shuffle(verbs);
  sessions.set(userId, {
    mode: 'round',
    queue,
    currentVerb: queue[0],
    startTime: Date.now(),
    correct: 0,
    wrong: 0,
    mistakes: {},       // { verbBase: [wrongAnswer, ...] }
    totalVerbs: verbs.length,
  });
  ctx.reply(
    `🏁 *Round mode started!*\n📚 ${verbs.length} verbs to go. Answer each correctly to complete the round!`,
    { parse_mode: 'Markdown', ...mainMenu() }
  ).then(() => askVerb(ctx, queue[0]));
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

  let msg =
    `🏁 *Round finished!*\n\n` +
    `⏱ Time: ${formatDuration(durationMs)}\n` +
    `✅ Correct answers: ${session.correct}\n` +
    `❌ Wrong answers: ${session.wrong}\n` +
    `📚 Total verbs: ${session.totalVerbs}\n` +
    `🎯 Accuracy: ${accuracy}%\n` +
    `🔥 Mistakes:`;

  const mistakeEntries = Object.entries(session.mistakes);
  if (mistakeEntries.length === 0) {
    msg += ' No mistakes. Perfect round! 🌟';
  } else {
    msg += '\n' + mistakeEntries
      .map(([base, wrongAnswers]) => {
        const verb = verbs.find(v => v.base === base);
        return `- ${base} → ${verb.past}, your answers: ${wrongAnswers.join(', ')}`;
      })
      .join('\n');
  }

  clearSession(userId);
  ctx.reply(msg, { parse_mode: 'Markdown', ...mainMenu() });
}

// ── Commands (kept for backwards compatibility) ────────────────────────────────

bot.start((ctx) => {
  ctx.reply(
    `👋 Welcome to the *Irregular Verbs Quiz Bot!*\n\n` +
    `I'll help you practice Past Simple forms of ${verbs.length} irregular verbs.\n\n` +
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

  // Button presses — never treat as quiz answers
  if (text === BTN.SHOW_VERBS) return handleShowVerbs(ctx);
  if (text === BTN.PRACTICE)   return handlePractice(ctx);
  if (text === BTN.ROUND)      return handleRound(ctx);
  if (text === BTN.STATS)      return handleStats(ctx);
  if (text === BTN.STOP)       return handleStop(ctx);

  const userId = ctx.from.id;
  const session = getSession(userId);

  if (!session.mode) {
    ctx.reply('Choose a mode from the menu below.', mainMenu());
    return;
  }

  const answer = text.trim().toLowerCase();
  const { currentVerb } = session;
  const isCorrect = answer === currentVerb.past.toLowerCase();

  recordAnswer(userId, isCorrect);

  let feedback = isCorrect
    ? `✅ *Correct!* ${currentVerb.base} → ${currentVerb.past}`
    : `❌ *Wrong.* ${currentVerb.base} → ${currentVerb.past}`;

  if (currentVerb.note) {
    feedback += `\n💡 _${currentVerb.note}_`;
  }

  if (session.mode === 'practice') {
    const nextVerb = verbs[Math.floor(Math.random() * verbs.length)];
    session.currentVerb = nextVerb;
    ctx.reply(feedback, { parse_mode: 'Markdown' }).then(() => askVerb(ctx, nextVerb));

  } else if (session.mode === 'round') {
    if (isCorrect) {
      session.correct++;
      session.queue.shift();
      if (session.queue.length === 0) {
        // Last verb answered correctly — round complete
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
    ctx.reply(feedback, { parse_mode: 'Markdown' }).then(() => askVerb(ctx, session.currentVerb));
  }
});

bot.launch();
console.log('✅ Bot is running. Press Ctrl+C to stop.');

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
