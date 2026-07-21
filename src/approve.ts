import type { ChromeMcp } from "./mcp.js";
import type { Verdict } from "./classify.js";

export type Decision = { approved: string[] } | { cancelled: true };

const POLL_INTERVAL_MS = 1500;
const TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Inject an approval overlay into the currently selected x.com tab, listing
 * the flagged users with checkboxes, then poll until the user clicks
 * "Block selected" or "Cancel" (or the timeout elapses → treated as cancel).
 *
 * The page must not navigate between injection and the decision — the
 * decision lives in `window.__xSpamDecision`.
 */
export async function requestApproval(
  mcp: ChromeMcp,
  flagged: Verdict[],
): Promise<Decision> {
  await injectOverlay(mcp, flagged);
  console.log("  waiting for your decision in the browser overlay...");

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const decision = await mcp.evaluate<Decision | null>(
      "return window.__xSpamDecision || null;",
    );
    if (decision) {
      await removeOverlay(mcp);
      return decision;
    }
  }
  await removeOverlay(mcp);
  console.log("  approval timed out after 5 minutes — treating as cancel");
  return { cancelled: true };
}

async function injectOverlay(mcp: ChromeMcp, flagged: Verdict[]): Promise<void> {
  const data = JSON.stringify(
    flagged.map((v) => ({
      handle: v.handle,
      displayName: v.displayName,
      confidence: v.confidence,
      reason: v.reason,
      sampleText: v.sampleText.slice(0, 200),
    })),
  );

  // All user-derived strings go in via textContent (never innerHTML) so spam
  // text can't inject markup into our overlay.
  await mcp.evaluate<null>(`
    delete window.__xSpamDecision;
    document.getElementById('xsab-overlay')?.remove();
    const users = ${data};

    const overlay = document.createElement('div');
    overlay.id = 'xsab-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;font-family:-apple-system,sans-serif;';

    const panel = document.createElement('div');
    panel.style.cssText = 'background:#fff;color:#0f1419;border-radius:16px;max-width:640px;width:92%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,0.4);';
    overlay.appendChild(panel);

    const header = document.createElement('div');
    header.style.cssText = 'padding:16px 20px;border-bottom:1px solid #eff3f4;font-size:18px;font-weight:700;';
    header.textContent = 'Spam blocker — review ' + users.length + ' flagged user' + (users.length === 1 ? '' : 's');
    panel.appendChild(header);

    const list = document.createElement('div');
    list.style.cssText = 'overflow-y:auto;padding:8px 20px;flex:1;';
    panel.appendChild(list);

    const checkboxes = [];
    for (const u of users) {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #eff3f4;cursor:pointer;align-items:flex-start;';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.dataset.handle = u.handle;
      cb.style.cssText = 'margin-top:4px;width:16px;height:16px;';
      checkboxes.push(cb);
      row.appendChild(cb);

      const info = document.createElement('div');
      info.style.cssText = 'min-width:0;';
      const title = document.createElement('div');
      title.style.cssText = 'font-weight:700;font-size:14px;';
      title.textContent = u.displayName + ' (@' + u.handle + ') · ' + Math.round(u.confidence * 100) + '%';
      const reason = document.createElement('div');
      reason.style.cssText = 'font-size:13px;color:#536471;';
      reason.textContent = u.reason;
      const sample = document.createElement('div');
      sample.style.cssText = 'font-size:12px;color:#536471;font-style:italic;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      sample.textContent = '"' + u.sampleText + '"';
      info.append(title, reason, sample);
      row.appendChild(info);
      list.appendChild(row);
    }

    const footer = document.createElement('div');
    footer.style.cssText = 'padding:14px 20px;border-top:1px solid #eff3f4;display:flex;gap:12px;justify-content:flex-end;';
    panel.appendChild(footer);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:10px 20px;border-radius:9999px;border:1px solid #cfd9de;background:#fff;font-weight:700;font-size:14px;cursor:pointer;';
    cancelBtn.onclick = () => { window.__xSpamDecision = { cancelled: true }; overlay.remove(); };

    const blockBtn = document.createElement('button');
    blockBtn.style.cssText = 'padding:10px 20px;border-radius:9999px;border:none;background:#f4212e;color:#fff;font-weight:700;font-size:14px;cursor:pointer;';
    const updateLabel = () => {
      const n = checkboxes.filter((c) => c.checked).length;
      blockBtn.textContent = 'Block selected (' + n + ')';
      blockBtn.disabled = n === 0;
      blockBtn.style.opacity = n === 0 ? '0.5' : '1';
    };
    checkboxes.forEach((c) => c.addEventListener('change', updateLabel));
    updateLabel();
    blockBtn.onclick = () => {
      window.__xSpamDecision = {
        approved: checkboxes.filter((c) => c.checked).map((c) => c.dataset.handle),
      };
      overlay.remove();
    };

    footer.append(cancelBtn, blockBtn);
    document.body.appendChild(overlay);
    return null;
  `);
}

async function removeOverlay(mcp: ChromeMcp): Promise<void> {
  await mcp
    .evaluate<null>(
      "document.getElementById('xsab-overlay')?.remove(); return null;",
    )
    .catch(() => {});
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
