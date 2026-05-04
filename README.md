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

## Deploying to Railway

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 2. Create a Railway project

1. Go to [railway.app](https://railway.app) and log in
2. Click **New Project → Deploy from GitHub repo**
3. Select your repository

### 3. Add the bot token

1. In your Railway project, go to the **Variables** tab
2. Add a new variable:
   - Name: `BOT_TOKEN`
   - Value: your real Telegram bot token

### 4. Deploy

Railway will detect Node.js automatically and run `npm start`.  
No port configuration is needed — the bot uses polling, not a webhook.

> **Note on stats persistence:** `data/stats.json` is stored on Railway's ephemeral filesystem.
> User stats will reset after each redeploy. This is expected behavior for the free tier.
