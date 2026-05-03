# Irregular Verbs Quiz Bot

A Telegram bot that quizzes you on Past Simple forms of 40 common irregular verbs.

## Setup

### 1. Install dependencies

```bash
cd telegram-verb-bot
npm install
```

### 2. Create a Telegram bot

1. Open Telegram and start a chat with [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the token BotFather gives you

### 3. Create the `.env` file

```bash
cp .env.example .env
```

Open `.env` and replace the placeholder with your real token:

```
BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxYZ
```

### 4. Start the bot

```bash
npm start
```

For development with auto-restart on file changes:

```bash
npm run dev
```

## Commands

| Command  | Description                         |
|----------|-------------------------------------|
| /start   | Welcome message and instructions    |
| /quiz    | Start a quiz session                |
| /stop    | Stop the current quiz               |
| /stats   | Show your correct/wrong/accuracy    |

## Project structure

```
telegram-verb-bot/
├── src/
│   ├── bot.js      # Bot logic and command handlers
│   ├── verbs.js    # List of 40 irregular verbs
│   └── stats.js    # Read/write stats to JSON file
├── data/
│   └── stats.json  # Auto-created on first answer (gitignored)
├── .env            # Your BOT_TOKEN (gitignored)
├── .env.example    # Token template
├── .gitignore
├── package.json
└── README.md
```

## Verb list

40 irregular verbs: Begin, Break, Bring, Build, Buy, Catch, Come, Do, Drink, Eat, Fall, Find, Fly, Forget, Get, Give, Go, Have, Hear, Know, Leave, Lose, Make, Meet, Pay, Put, Read, Ring, Say, See, Sell, Sit, Sleep, Speak, Stand, Take, Tell, Think, Win, Write.

> **Note on "Read":** the Past Simple spelling is also *read*, but the pronunciation changes from /riːd/ to /rɛd/. The bot will point this out after you answer.
