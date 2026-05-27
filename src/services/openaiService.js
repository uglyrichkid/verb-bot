'use strict';
const OpenAI = require('openai');

let _client = null;

function getClient() {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

function requireKey() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured');
  }
}

async function ask(prompt, maxTokens = 1000) {
  requireKey();
  const resp = await getClient().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
  });
  return resp.choices[0].message.content.trim();
}

async function generateUnitExplanation(unit) {
  return ask(
    `You are an English grammar teacher for Armenian learners (A1-A2 level).
Explain Unit ${unit.id} — "${unit.title}" in simple English.
- Use very easy words (A1-A2 level).
- Add short Armenian notes or translations where helpful (Հայերեն).
- Maximum 5 sentences. No headers.`,
    500,
  );
}

async function generateUnitRules(unit) {
  return ask(
    `You are an English grammar teacher for Armenian learners (A1-A2 level).
Write the grammar rules for Unit ${unit.id} — "${unit.title}".
- If this unit has positive, negative, and question forms, show all three with a formula.
- Use bullet points or numbered list.
- Keep each rule short and clear.
- Add Armenian labels where helpful (Հայերեն).`,
    700,
  );
}

async function generateUnitExamples(unit) {
  return ask(
    `You are an English grammar teacher for Armenian learners (A1-A2 level).
Write 10 simple example sentences for Unit ${unit.id} — "${unit.title}".
- Mix positive, negative, and question forms if applicable.
- Format each line as: English sentence — Armenian translation (Հայերեն).
- Keep sentences very simple (A1-A2 level).
- No extra explanations, only the examples.`,
    1200,
  );
}

async function generateUnitExercises(unit) {
  return ask(
    `You are an English grammar teacher for Armenian learners (A1-A2 level).
Create 6 practice exercises for Unit ${unit.id} — "${unit.title}".
- Mix types: fill in the blank, correct the mistake, make a question, transform positive to negative.
- Number each exercise.
- Do NOT include answers.
- Keep all sentences simple (A1-A2 level).`,
    900,
  );
}

async function checkUserAnswer(unit, userAnswer) {
  return ask(
    `You are an English grammar teacher for Armenian learners (A1-A2 level).
The student is practicing Unit ${unit.id} — "${unit.title}".
The student wrote: "${userAnswer}"

Check this and respond with:
1. ✅ Corrected version (or say it is correct)
2. 💡 Short explanation in simple English (1-2 sentences, add Armenian if helpful)
3. 📝 One similar correct example sentence

Be encouraging and brief.`,
    500,
  );
}

module.exports = {
  generateUnitExplanation,
  generateUnitRules,
  generateUnitExamples,
  generateUnitExercises,
  checkUserAnswer,
};
