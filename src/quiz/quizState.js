const quizSessions = new Map();

function getQuizSession(userId) {
  if (!quizSessions.has(userId)) quizSessions.set(userId, { mode: null });
  return quizSessions.get(userId);
}

function setQuizSession(userId, data) {
  quizSessions.set(userId, data);
}

function clearQuizSession(userId) {
  quizSessions.set(userId, { mode: null });
}

function isInQuiz(userId) {
  const s = quizSessions.get(userId);
  return !!(s && s.mode !== null);
}

module.exports = { getQuizSession, setQuizSession, clearQuizSession, isInQuiz };
