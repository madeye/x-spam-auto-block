# x-spam-auto-block

Auto-block spam users on X (x.com) — with a human in the loop.

The agent drives your own Chrome through
[chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp),
scrapes the reply threads under your posts, classifies repliers with an
OpenAI-compatible LLM (DeepSeek v4 flash by default), then shows the flagged
accounts in an approval overlay **inside the x.com tab**. Only the users you
tick and confirm get blocked — via the normal profile UI
(⋯ → Block → confirm), exactly as if you clicked it yourself.

Promoted content (ads injected into threads) is excluded, and nothing is ever
blocked without your explicit click in the browser.

## Prerequisites

- Node.js ≥ 20.19
- Google Chrome (144+ for the default attach mode)
- An API key for any OpenAI-compatible provider (DeepSeek by default)

## Setup

```sh
npm install
cp .env.example .env    # then fill in LLM_API_KEY and X_USERNAME
```

`.env` is gitignored — your key never leaves your machine.

### Connect to Chrome

**Mode `auto` (default, recommended)** — attaches to your already-running
Chrome with your normal profile and existing x.com login:

1. In Chrome, open `chrome://inspect/#remote-debugging` and enable remote
   debugging (one-time toggle, no restart).
2. That's it. On the first run Chrome shows a permission dialog — click
   **Allow**.

**Mode `url`** — if you prefer an isolated browser, set `CHROME_CONNECT=url`
in `.env` and start a dedicated debug-profile Chrome:

```sh
./scripts/launch-chrome.sh
```

Log into x.com in that window once; the profile (`~/.chrome-debug-profile`)
persists. (This exists because Chrome 136+ refuses the
`--remote-debugging-port` flag on your default profile.)

## Usage

```sh
# Scan replies under your recent posts (MAX_POSTS from .env)
npm start

# Scan your 2 most recent posts
npm start -- --posts 2

# Scan whatever x.com page is currently open in Chrome
npm start -- --current

# Scan specific post threads
npm start -- https://x.com/you/status/123456789

# Everything except the actual blocking
npm start -- --current --dry-run
```

A typical run:

```
Connecting to Chrome via chrome-devtools-mcp (attaching to running instance)...
Collecting candidates...
  scanning replies of https://x.com/you/status/…
Collected 10 unique users.
Classifying with deepseek-v4-flash @ https://api.deepseek.com...
Flagged 1 suspected spam user(s):
  @SomeSpamBot (95%) — Promotional display name advertising credit card
  waiting for your decision in the browser overlay...
✓ blocked @SomeSpamBot
Done: 1 blocked, 0 failed.
```

## Configuration

All settings live in `.env` (see `.env.example` for the documented template):

| Variable | Default | Purpose |
| --- | --- | --- |
| `LLM_API_BASE` | `https://api.deepseek.com` | Any OpenAI-compatible endpoint |
| `LLM_API_KEY` | — (required) | API key for that endpoint |
| `LLM_MODEL` | `deepseek-v4-flash` | Model id |
| `X_USERNAME` | — (required) | Your handle; whose posts to scan, never flagged |
| `CHROME_CONNECT` | `auto` | `auto` = attach to running Chrome, `url` = debug-profile Chrome |
| `CHROME_DEBUG_URL` | `http://127.0.0.1:9222` | DevTools endpoint (mode `url` only) |
| `MAX_POSTS` | `5` | Recent posts to scan |
| `MAX_REPLIES_PER_POST` | `100` | Scroll cap per thread |

## Safety model

- **Nothing is blocked automatically.** The LLM only *proposes*; every block
  requires you to tick the account and click **Block selected** in the
  in-page overlay. Cancel — or 5 minutes of inactivity — aborts the run.
- Blocking goes through x.com's normal web UI in your own session, so it is
  identical to blocking manually, and reversible the same way (unblock on the
  profile).
- Every block is appended to `blocked-log.json` (gitignored) with the handle,
  the classifier's reason, and a timestamp.
- Only handles and public reply texts are sent to the LLM provider.

> [!WARNING]
> **Pace yourself.** X's anti-bot systems flag bursts of blocks, and accounts
> that have been restricted before get far less tolerance — users have
> reported bans even for small batches after a first restriction
> ([#1](https://github.com/madeye/x-spam-auto-block/issues/1)). Keep batches
> small, leave time between runs, and stop entirely if your account has ever
> been restricted.

See [docs/how-it-works.md](docs/how-it-works.md) for the architecture and the
details of each stage.

## License

[MIT](LICENSE) © 2026 Max Lv
