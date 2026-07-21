import { loadConfig } from "./config.js";
import { ChromeMcp } from "./mcp.js";
import {
  collectFromOwnPosts,
  collectFromOpenPage,
  collectFromUrls,
  mergeCandidates,
  type Candidate,
} from "./scrape.js";
import { classifyCandidates, flaggedForReview } from "./classify.js";
import { requestApproval } from "./approve.js";
import { blockUsers } from "./block.js";

interface CliArgs {
  current: boolean;
  dryRun: boolean;
  posts?: number;
  urls: string[];
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { current: false, dryRun: false, urls: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--current") args.current = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--posts") args.posts = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg.startsWith("https://")) args.urls.push(arg);
    else {
      console.error(`Unknown argument: ${arg}`);
      printUsage();
      process.exit(1);
    }
  }
  return args;
}

function printUsage(): void {
  console.log(`Usage: npm start -- [options] [postURL...]

Options:
  --current     Scan the x.com page currently open in Chrome (instead of your posts)
  --posts N     Scan replies under your N most recent posts (default: MAX_POSTS from .env)
  --dry-run     Do everything except the actual blocking
  postURL...    Scan replies of specific x.com post URLs

With no options, scans replies under your recent posts (Mode A).`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();

  console.log("Connecting to Chrome via chrome-devtools-mcp...");
  const mcp = await ChromeMcp.connect(config.CHROME_DEBUG_URL);

  try {
    console.log("Collecting candidates...");
    const lists: Candidate[][] = [];
    if (args.urls.length > 0) {
      lists.push(await collectFromUrls(mcp, config, args.urls));
    }
    if (args.current) {
      lists.push(await collectFromOpenPage(mcp, config));
    }
    if (args.urls.length === 0 && !args.current) {
      lists.push(await collectFromOwnPosts(mcp, config, args.posts ?? config.MAX_POSTS));
    }
    const candidates = mergeCandidates(lists);
    console.log(`Collected ${candidates.length} unique users.`);
    if (candidates.length === 0) {
      console.log("Nothing to classify. Done.");
      return;
    }

    console.log(`Classifying with ${config.LLM_MODEL} @ ${config.LLM_API_BASE}...`);
    const verdicts = await classifyCandidates(candidates, config);
    const flagged = flaggedForReview(verdicts);
    if (flagged.length === 0) {
      console.log("No spam users flagged. Done.");
      return;
    }

    console.log(`\nFlagged ${flagged.length} suspected spam user(s):`);
    for (const v of flagged) {
      console.log(
        `  @${v.handle} (${Math.round(v.confidence * 100)}%) — ${v.reason}`,
      );
    }

    const decision = await requestApproval(mcp, flagged);
    if ("cancelled" in decision) {
      console.log("Cancelled in browser. No one was blocked.");
      return;
    }
    if (decision.approved.length === 0) {
      console.log("Nothing selected. No one was blocked.");
      return;
    }

    if (args.dryRun) {
      console.log(`\n[dry-run] Would block ${decision.approved.length} user(s):`);
      for (const handle of decision.approved) console.log(`  @${handle}`);
      return;
    }

    console.log(`\nBlocking ${decision.approved.length} approved user(s)...`);
    const results = await blockUsers(mcp, decision.approved, flagged);
    const ok = results.filter((r) => r.blocked);
    const failed = results.filter((r) => !r.blocked);
    console.log(`\nDone: ${ok.length} blocked, ${failed.length} failed.`);
    if (failed.length > 0) {
      for (const f of failed) console.log(`  failed @${f.handle}: ${f.error}`);
      process.exitCode = 1;
    }
  } finally {
    await mcp.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
