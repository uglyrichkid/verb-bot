'use strict';
const quiz504Sessions = new Map();

function getQuiz504Session(userId) {
  if (!quiz504Sessions.has(userId)) quiz504Sessions.set(userId, { mode: null });
  return quiz504Sessions.get(userId);
}

function setQuiz504Session(userId, data) {
  quiz504Sessions.set(userId, data);
}

function clearQuiz504Session(userId) {
  quiz504Sessions.set(userId, { mode: null });
}

function isIn504Quiz(userId) {
  const s = quiz504Sessions.get(userId);
  return !!(s && s.mode !== null);
}

module.exports = { getQuiz504Session, setQuiz504Session, clearQuiz504Session, isIn504Quiz };
