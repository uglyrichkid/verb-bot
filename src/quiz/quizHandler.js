'use strict';
const { createQuizHandler } = require('./createQuizHandler');
const vocabulary = require('../vocabulary');
const { getQuizSession, setQuizSession, clearQuizSession, isInQuiz } = require('./quizState');

const handler = createQuizHandler({
  source:       'quiz',
  entryBtn:     '🧠 Quiz',
  title:        '🧠 Quiz — Word Translation',
  wordList:     vocabulary,
  getSession:   getQuizSession,
  setSession:   setQuizSession,
  clearSession: clearQuizSession,
  isActive:     isInQuiz,
});

module.exports = {
  BTN_QUIZ:       handler.ENTRY_BTN,
  init:           (fn) => handler.init(fn),
  handleQuizText: (ctx) => handler.handleText(ctx),
  isInQuiz:       (userId) => handler.isActive(userId),
  clearQuizSession: (userId) => handler.clearSession(userId),
};
