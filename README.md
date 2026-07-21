# x-spam-auto-block

Auto-block spam users on x.com. The agent drives your Chrome through
[chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp),
scrapes reply threads, classifies repliers with an OpenAI-compatible LLM
(DeepSeek v4 flash by default), shows the flagged users in an approval overlay
**inside the x.com tab**, and blocks only the ones you approve — via the normal
web UI (profile → ⋯ → Block → confirm).

## Prerequisites

- Node.js ≥ 20.19 (chrome-devtools-mcp requirement)
- Google Chrome
- An API key for any OpenAI-compatible provider (DeepSeek by default)

## Setup

1. **Install dependencies**

   ```sh
   npm install
   ```

2. **Start Chrome with remote debugging**

   ```sh
   ./scripts/launch-chrome.sh
   ```

   Chrome 136+ blocks remote debugging on your default profile, so this opens a
   dedicated persistent profile (`~/.chrome-debug-profile`). Log into x.com in
   that window once — the session sticks for future runs.

3. **Configure the environment**

   ```sh
   cp .env.example .env
   ```

   Fill in `LLM_API_KEY` and `X_USERNAME`. The defaults use DeepSeek
   (`https://api.deepseek.com`, model `deepseek-v4-flash`); point
   `LLM_API_BASE` / `LLM_MODEL` at any other OpenAI-compatible provider if you
   prefer. `.env` is gitignored — never commit it.

## Usage

```sh
# Scan replies under your recent posts (MAX_POSTS from .env)
npm start

# Scan your 2 most recent posts
npm start -- --posts 2

# Scan whatever x.com page is currently open in the debug Chrome
npm start -- --current

# Scan specific post threads
npm start -- https://x.com/you/status/123456789

# Everything except the actual blocking
npm start -- --current --dry-run
```

## How it works

1. **Scrape** — reads reply threads through the DevTools a11y/DOM interface
   using x.com's stable `data-testid` attributes, scrolling until the per-post
   cap (`MAX_REPLIES_PER_POST`) or the end of the thread.
2. **Classify** — batches repliers to the LLM with strict JSON output; users
   flagged as spam with confidence ≥ 0.7 go to review.
3. **Approve** — an overlay is injected into the x.com tab listing each flagged
   user (handle, confidence, reason, sample reply) with checkboxes. Nothing is
   blocked until you click **Block selected**; **Cancel** (or a 5-minute
   timeout) aborts.
4. **Block** — for each approved user, opens their profile and clicks
   ⋯ → Block → confirm, verifying the profile reflects the block. Results are
   appended to `blocked-log.json` (gitignored).

## Notes

- The agent only ever blocks users you approved in the overlay; there is no
  fully unattended mode.
- If x.com changes its `data-testid` attributes, the selectors in
  `src/scrape.ts` / `src/block.ts` are the place to fix.
