# How it works

The agent is a Node.js CLI that acts as an MCP *client* to
[chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp),
Google's official MCP server for Chrome. All browser work — navigation, DOM
reads, clicks — happens inside your real Chrome via the DevTools protocol.

```
┌──────────┐   MCP (stdio)   ┌────────────────────┐   CDP   ┌────────┐
│ src/*.ts │ ──────────────► │ chrome-devtools-mcp │ ──────► │ Chrome │
└──────────┘                 └────────────────────┘         └────────┘
      │
      │ HTTPS (OpenAI-compatible chat completions)
      ▼
┌──────────────────┐
│ LLM (DeepSeek …) │
└──────────────────┘
```

## Pipeline

Every run goes through four stages, orchestrated by `src/index.ts`:

### 1. Scrape (`src/scrape.ts`)

- Opens a **new tab** (never navigates a tab you're using) at your profile,
  waits for tweet articles to actually render (the header appears before the
  timeline, so waiting for text alone is a race), and collects permalinks of
  your `MAX_POSTS` most recent posts.
- Visits each post and repeatedly extracts visible replies while scrolling,
  until `MAX_REPLIES_PER_POST` is reached or two consecutive scrolls yield
  nothing new.
- Extraction uses x.com's stable `data-testid` attributes
  (`article[data-testid="tweet"]`, `User-Name`, `tweetText`) rather than
  brittle class names.
- **Promoted content is skipped**: anything inside the
  `placementTracking` ad wrapper or carrying an Ad/Promoted badge
  (including 广告/推广/プロモーション) — otherwise in-thread ads get
  classified like replies.
- Repliers are deduplicated by handle across posts; your own account is
  always excluded.

`--current` runs the same extractor on whichever x.com tab is open;
explicit post URLs on the command line are scanned the same way.

### 2. Classify (`src/classify.ts`)

- Candidates are sent to the configured OpenAI-compatible endpoint in batches
  of 20, each with display name and up to 5 reply texts.
- The system prompt targets crypto shilling, giveaway/DM scams, impersonation,
  adult-content bait, engagement farming, and copy-paste bot replies — and
  explicitly protects genuine disagreement, criticism, jokes, and on-topic
  non-English replies.
- Responses use strict JSON mode (`response_format: json_object`); malformed
  output is retried once. Users flagged with confidence ≥ 0.7 go to review.

### 3. Approve (`src/approve.ts`)

- An overlay is injected into the x.com tab listing each flagged user:
  handle, confidence, classifier reason, and a sample reply. All rows are
  checkboxed (pre-ticked).
- The agent polls `window.__xSpamDecision` every 1.5 s. Clicking
  **Block selected** stores the ticked handles; **Cancel** or a 5-minute
  timeout aborts. The page must not navigate while the overlay is up — the
  decision lives in the page's `window`.
- All user-derived strings are inserted via `textContent`, so spam text can't
  inject markup into the overlay.

### 4. Block (`src/block.ts`)

For each approved handle, sequentially with a 2.5 s delay:

1. Open the profile (first one in a fresh tab).
2. Click ⋯ (`userActions`) → **Block** (`block`) → confirm
   (`confirmationSheetConfirm`).
3. Verify the profile now shows the blocked state; log the result to
   `blocked-log.json`.

Already-blocked accounts are detected and skipped. Failures are reported per
handle and set a non-zero exit code.

## Connecting to Chrome (`src/mcp.ts`)

Two modes, chosen by `CHROME_CONNECT`:

- **`auto`** — spawns `chrome-devtools-mcp --autoConnect`, which attaches to
  your already-running Chrome (144+) once remote debugging is enabled at
  `chrome://inspect/#remote-debugging`. Uses your normal profile and existing
  x.com session.
- **`url`** — connects to `CHROME_DEBUG_URL` (default `127.0.0.1:9222`);
  pair with `scripts/launch-chrome.sh`, which starts Chrome with a dedicated
  persistent profile, since Chrome 136+ ignores `--remote-debugging-port` on
  the default profile.

`evaluate_script` results are wrapped in sentinel markers and JSON-parsed, so
arbitrary structured data can be pulled out of the page regardless of how the
tool formats its text output.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Could not attach to your running Chrome` | Re-enable the toggle at `chrome://inspect/#remote-debugging`, or switch to `CHROME_CONNECT=url` + `scripts/launch-chrome.sh` |
| Collected 0 users on a thread with replies | x.com markup changed — check the `data-testid` selectors in `src/scrape.ts` |
| Block fails with "menu button not found" | Check the `userActions` / `block` / `confirmationSheetConfirm` testids in `src/block.ts` |
| LLM errors | Verify `LLM_API_KEY`, and that `LLM_API_BASE` speaks the OpenAI chat-completions API |
