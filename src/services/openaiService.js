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

// Returns a JSON string for one exercise. Caller must parse and handle failures.
async function generateSingleExercise(unit, exerciseNumber) {
  const exerciseTypes = 'make positive / make negative / make question / fill in the blank / correct the mistake';
  const raw = await ask(
    `You are an English grammar teacher for Armenian learners (A1-A2 level).
Generate exercise number ${exerciseNumber} for Unit ${unit.id} — "${unit.title}".

Choose one exercise type: ${exerciseTypes}.
Vary the type from previous exercises based on the exercise number.
If this unit covers positive/negative/question forms, include those types.

Return ONLY valid JSON — no extra text, no markdown fences:
{
  "type": "negative",
  "instruction": "Make this sentence negative.",
  "question": "I work every day.",
  "expectedAnswer": "I don't work every day.",
  "hint": "Use don't with I/you/we/they."
}

Rules:
- Keep sentences simple (A1-A2 level).
- The hint field is optional but helpful for harder exercises.
- Do NOT reveal the answer in instruction or question.`,
    350,
  );
  return raw;
}

async function checkExerciseAnswer(unit, exercise, userAnswer) {
  const exerciseContext = exercise.raw
    ? exercise.raw
    : `Type: ${exercise.type}\nInstruction: ${exercise.instruction}\nQuestion: ${exercise.question}`;

  return ask(
    `You are an English grammar teacher for Armenian learners (A1-A2 level).
Unit: ${unit.id} — "${unit.title}"

Exercise:
${exerciseContext}

Student's answer: "${userAnswer}"

Respond with:
1. ✅ Correct! or ❌ Incorrect — [corrected version]
2. 💡 Short explanation in simple English (add Armenian if helpful, 1-2 sentences)
3. 📝 One similar correct example

Be encouraging and brief.`,
    400,
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
  generateSingleExercise,
  checkExerciseAnswer,
  checkUserAnswer,
};
