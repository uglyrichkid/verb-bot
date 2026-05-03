require('dotenv').config();
const { Telegraf } = require('telegraf');
const verbs = require('./verbs');
const { getUserStats, recordAnswer } = require('./stats');

if (!process.env.BOT_TOKEN) {
  console.error('Error: BOT_TOKEN is not set. Create a .env file with BOT_TOKEN=your_token');
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

// In-memory quiz state per user: userId -> { active: bool, currentVerb: object }
const quizSessions = new Map();

function randomVerb() {
  return verbs[Math.floor(Math.random() * verbs.length)];
}

function getSession(userId) {
  return quizSessions.get(userId) ?? { active: false, currentVerb: null };
}

function askVerb(ctx, verb) {
  return ctx.reply(
    `What is the *Past Simple* of: *${verb.base}*?`,
    { parse_mode: 'Markdown' }
  );
}

// /start
bot.start((ctx) => {
  ctx.reply(
    `👋 Welcome to the *Irregular Verbs Quiz Bot!*\n\n` +
    `I'll quiz you on Past Simple forms of 40 common irregular verbs.\n\n` +
    `📖 *How it works:*\n` +
    `• I send you a verb in base form\n` +
    `• You type the Past Simple form\n` +
    `• I tell you if you're right or wrong, then move on\n\n` +
    `📋 *Commands:*\n` +
    `/quiz — Start a quiz session\n` +
    `/stop — Stop the current quiz\n` +
    `/stats — View your statistics`,
    { parse_mode: 'Markdown' }
  );
});

// /quiz
bot.command('quiz', (ctx) => {
  const userId = ctx.from.id;
  const verb = randomVerb();
  quizSessions.set(userId, { active: true, currentVerb: verb });
  ctx.reply('🎯 Quiz started! Type /stop at any time to quit.\n');
  askVerb(ctx, verb);
});

// /stop
bot.command('stop', (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);

  if (!session.active) {
    ctx.reply('No active quiz. Use /quiz to start one.');
    return;
  }

  quizSessions.set(userId, { active: false, currentVerb: null });
  ctx.reply('⏹ Quiz stopped. Use /quiz to start again or /stats to see your progress.');
});

// /stats
bot.command('stats', (ctx) => {
  const stats = getUserStats(ctx.from.id);
  const accuracy = stats.total > 0
    ? ((stats.correct / stats.total) * 100).toFixed(1)
    : '0.0';

  ctx.reply(
    `📊 *Your Statistics*\n\n` +
    `✅ Correct:  ${stats.correct}\n` +
    `❌ Wrong:    ${stats.wrong}\n` +
    `📝 Total:    ${stats.total}\n` +
    `🎯 Accuracy: ${accuracy}%`,
    { parse_mode: 'Markdown' }
  );
});

// Handle answers
bot.on('text', (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);

  if (!session.active) {
    ctx.reply('Use /quiz to start a quiz session!');
    return;
  }

  const { currentVerb } = session;
  const answer = ctx.message.text.trim().toLowerCase();
  const isCorrect = answer === currentVerb.past.toLowerCase();

  recordAnswer(userId, isCorrect);

  let feedback;
  if (isCorrect) {
    feedback = `✅ *Correct!* ${currentVerb.base} → ${currentVerb.past}`;
  } else {
    feedback = `❌ *Wrong.* Correct answer: ${currentVerb.base} → ${currentVerb.past}`;
  }

  if (currentVerb.note) {
    feedback += `\n💡 _Note: ${currentVerb.note}_`;
  }

  const nextVerb = randomVerb();
  quizSessions.set(userId, { active: true, currentVerb: nextVerb });

  ctx.reply(feedback, { parse_mode: 'Markdown' }).then(() => askVerb(ctx, nextVerb));
});

bot.launch();
console.log('✅ Bot is running. Press Ctrl+C to stop.');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
