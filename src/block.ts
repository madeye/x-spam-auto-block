import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ChromeMcp } from "./mcp.js";
import type { Verdict } from "./classify.js";

export interface BlockResult {
  handle: string;
  blocked: boolean;
  error?: string;
}

const DELAY_BETWEEN_USERS_MS = 2500;
const LOG_FILE = "blocked-log.json";

export async function blockUsers(
  mcp: ChromeMcp,
  approved: string[],
  verdicts: Verdict[],
): Promise<BlockResult[]> {
  const reasonByHandle = new Map(
    verdicts.map((v) => [v.handle.toLowerCase(), v.reason]),
  );
  const results: BlockResult[] = [];

  let first = true;
  for (const handle of approved) {
    console.log(`  blocking @${handle}...`);
    try {
      await blockOne(mcp, handle, first);
      first = false;
      results.push({ handle, blocked: true });
      logBlock(handle, reasonByHandle.get(handle.toLowerCase()) ?? "");
      console.log(`  ✓ blocked @${handle}`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ handle, blocked: false, error });
      console.warn(`  ✗ failed to block @${handle}: ${error}`);
    }
    await sleep(DELAY_BETWEEN_USERS_MS);
  }
  return results;
}

async function blockOne(mcp: ChromeMcp, handle: string, openNewTab: boolean): Promise<void> {
  // First profile opens in a fresh tab so we don't navigate away from the
  // page the user approved on; subsequent profiles reuse that tab.
  if (openNewTab) await mcp.newPage(`https://x.com/${handle}`);
  else await mcp.navigate(`https://x.com/${handle}`);
  const loaded = await mcp.waitFor(`@${handle}`, 15000);
  if (!loaded) throw new Error("profile page did not load");
  await mcp.waitForSelector('button[data-testid="userActions"]', 10000);

  // Already blocked? The profile then shows a "Blocked" button instead of "Follow".
  const alreadyBlocked = await mcp.evaluate<boolean>(
    `return !!document.querySelector('[data-testid$="-unblock"]');`,
  );
  if (alreadyBlocked) return;

  const openedMenu = await mcp.evaluate<boolean>(`
    const btn = document.querySelector('button[data-testid="userActions"]');
    if (!btn) return false;
    btn.click();
    return true;
  `);
  if (!openedMenu) throw new Error("could not find the ⋯ (userActions) menu button");
  await sleep(600);

  const clickedBlock = await mcp.evaluate<boolean>(`
    const item = document.querySelector('[data-testid="block"]');
    if (!item) return false;
    item.click();
    return true;
  `);
  if (!clickedBlock) {
    // Close the dangling menu before failing.
    await mcp.evaluate<null>(
      "document.body.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'})); return null;",
    ).catch(() => {});
    throw new Error("Block item not found in the menu");
  }
  await sleep(600);

  const confirmed = await mcp.evaluate<boolean>(`
    const btn = document.querySelector('[data-testid="confirmationSheetConfirm"]');
    if (!btn) return false;
    btn.click();
    return true;
  `);
  if (!confirmed) throw new Error("confirmation dialog did not appear");
  await sleep(800);

  const nowBlocked = await mcp.evaluate<boolean>(
    `return !!document.querySelector('[data-testid$="-unblock"]');`,
  );
  if (!nowBlocked) throw new Error("block not reflected on the profile after confirming");
}

function logBlock(handle: string, reason: string): void {
  const entry = { handle, reason, blockedAt: new Date().toISOString() };
  let entries: unknown[] = [];
  if (existsSync(LOG_FILE)) {
    try {
      entries = JSON.parse(readFileSync(LOG_FILE, "utf8"));
    } catch {
      entries = [];
    }
  }
  entries.push(entry);
  writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2) + "\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
