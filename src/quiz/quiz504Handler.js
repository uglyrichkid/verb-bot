'use strict';
const { createQuizHandler } = require('./createQuizHandler');
const words504 = require('../words504');
const { getQuiz504Session, setQuiz504Session, clearQuiz504Session, isIn504Quiz } = require('./quiz504State');

const handler = createQuizHandler({
  source:       'quiz504',
  entryBtn:     '📖 Quiz 504',
  title:        '📖 Quiz 504 — Essential Words',
  wordList:     words504,
  getSession:   getQuiz504Session,
  setSession:   setQuiz504Session,
  clearSession: clearQuiz504Session,
  isActive:     isIn504Quiz,
});

module.exports = {
  BTN_QUIZ_504:       handler.ENTRY_BTN,
  init504:            (fn) => handler.init(fn),
  handle504QuizText:  (ctx) => handler.handleText(ctx),
  isIn504Quiz:        (userId) => handler.isActive(userId),
  clearQuiz504Session:(userId) => handler.clearSession(userId),
};
