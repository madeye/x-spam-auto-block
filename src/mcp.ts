import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const RESULT_START = "__XSAB_RESULT__";
const RESULT_END = "__XSAB_END__";

export class ChromeMcp {
  private client: Client;

  private constructor(client: Client) {
    this.client = client;
  }

  static async connect(chromeDebugUrl: string): Promise<ChromeMcp> {
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["-y", "chrome-devtools-mcp@latest", `--browser-url=${chromeDebugUrl}`],
      stderr: "ignore",
    });
    const client = new Client({ name: "x-spam-auto-block", version: "0.1.0" });
    await client.connect(transport);

    const mcp = new ChromeMcp(client);
    try {
      await mcp.call("list_pages", {});
    } catch (err) {
      await client.close().catch(() => {});
      throw new Error(
        `Could not attach to Chrome at ${chromeDebugUrl}. ` +
          `Start it with scripts/launch-chrome.sh and log into x.com there once.\n` +
          `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return mcp;
  }

  async close(): Promise<void> {
    await this.client.close().catch(() => {});
  }

  /** Call a chrome-devtools-mcp tool and return the concatenated text content. */
  async call(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.client.callTool({ name, arguments: args });
    if (result.isError) {
      throw new Error(`Tool ${name} failed: ${textOf(result.content)}`);
    }
    return textOf(result.content);
  }

  async navigate(url: string): Promise<void> {
    await this.call("navigate_page", { type: "url", url });
  }

  /**
   * Run a JS function in the selected page and return its JSON-serializable
   * result. `fnBody` must be the body of a zero-arg function ending in a
   * `return` statement, e.g. "return document.title;".
   */
  async evaluate<T>(fnBody: string): Promise<T> {
    const fn = `() => {
      const __run = () => { ${fnBody} };
      return ${JSON.stringify(RESULT_START)} + JSON.stringify(__run() ?? null) + ${JSON.stringify(RESULT_END)};
    }`;
    const text = await this.call("evaluate_script", { function: fn });
    const start = text.indexOf(RESULT_START);
    const end = text.indexOf(RESULT_END);
    if (start === -1 || end === -1) {
      throw new Error(`evaluate_script returned unexpected output: ${text.slice(0, 500)}`);
    }
    const raw = text.slice(start + RESULT_START.length, end);
    return parsePayload(raw) as T;
  }

  async waitFor(text: string, timeoutMs = 15000): Promise<boolean> {
    try {
      await this.call("wait_for", { text: [text], timeout: timeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  async snapshot(): Promise<string> {
    return this.call("take_snapshot", {});
  }

  async clickUid(uid: string): Promise<void> {
    await this.call("click", { uid });
  }

  async listPages(): Promise<string> {
    return this.call("list_pages", {});
  }

  /**
   * Select the currently open x.com tab as the active page.
   * Returns the URL of the selected page, or null if no x.com tab is open.
   */
  async selectCurrentXPage(): Promise<string | null> {
    const listing = await this.listPages();
    // list_pages output has one line per page:
    // "1: Page Title (https://x.com/...) [selected]"
    for (const line of listing.split("\n")) {
      const match = line.match(/^(\d+):\s.*\((https:\/\/(?:x|twitter)\.com\/[^)]*)\)/);
      if (match) {
        const [, id, url] = match;
        await this.call("select_page", { pageId: Number(id) });
        return url;
      }
    }
    return null;
  }
}

function parsePayload(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // The tool embedded our payload inside a JSON string literal, so quotes
    // arrive escaped (\"). Unescape one layer, then parse the payload itself.
    const unescaped: string = JSON.parse(`"${trimmed}"`);
    return JSON.parse(unescaped);
  }
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .filter(
      (c): c is { type: "text"; text: string } =>
        typeof c === "object" && c !== null && (c as { type?: string }).type === "text",
    )
    .map((c) => c.text)
    .join("\n");
}
