import OpenAI from "openai";
import { z } from "zod";
import type { Candidate } from "./scrape.js";
import type { Config } from "./config.js";

export interface Verdict {
  handle: string;
  displayName: string;
  spam: boolean;
  confidence: number;
  reason: string;
  sampleText: string;
}

const BATCH_SIZE = 20;
const CONFIDENCE_THRESHOLD = 0.7;

const ResponseSchema = z.object({
  verdicts: z.array(
    z.object({
      handle: z.string(),
      spam: z.boolean(),
      confidence: z.number().min(0).max(1),
      reason: z.string(),
    }),
  ),
});

const SYSTEM_PROMPT = `You are a spam detector for X (Twitter) reply threads. \
You receive a list of users, each with their display name and the reply texts they posted. \
Classify each user as spam or not.

Spam signals include: crypto/token shilling, giveaway or "DM me" scams, \
impersonation of the thread author or of famous accounts, adult-content bait, \
follow-for-follow / engagement farming, repetitive copy-paste replies, \
link-bait to suspicious sites, and bot-like generic flattery designed to sell something.

NOT spam: genuine disagreement, criticism, jokes, low-effort but human replies, \
non-English replies that are on-topic.

Respond with a json object of this exact shape:
{"verdicts": [{"handle": "...", "spam": true|false, "confidence": 0.0-1.0, "reason": "short explanation"}]}
Include every input user exactly once. Keep each reason under 15 words.`;

export async function classifyCandidates(
  candidates: Candidate[],
  config: Config,
): Promise<Verdict[]> {
  const client = new OpenAI({
    baseURL: config.LLM_API_BASE,
    apiKey: config.LLM_API_KEY,
  });

  const verdicts: Verdict[] = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    console.log(
      `  classifying users ${i + 1}-${i + batch.length} of ${candidates.length}...`,
    );
    verdicts.push(...(await classifyBatch(client, batch, config)));
  }
  return verdicts;
}

export function flaggedForReview(verdicts: Verdict[]): Verdict[] {
  return verdicts
    .filter((v) => v.spam && v.confidence >= CONFIDENCE_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence);
}

async function classifyBatch(
  client: OpenAI,
  batch: Candidate[],
  config: Config,
): Promise<Verdict[]> {
  const userMessage = JSON.stringify({
    users: batch.map((c) => ({
      handle: c.handle,
      displayName: c.displayName,
      replies: c.texts.slice(0, 5),
    })),
  });

  const byHandle = new Map(batch.map((c) => [c.handle.toLowerCase(), c]));

  for (let attempt = 0; attempt < 2; attempt++) {
    const completion = await client.chat.completions.create({
      model: config.LLM_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    });

    const content = completion.choices[0]?.message?.content ?? "";
    try {
      const parsed = ResponseSchema.parse(JSON.parse(content));
      return parsed.verdicts
        .filter((v) => byHandle.has(v.handle.toLowerCase()))
        .map((v) => {
          const c = byHandle.get(v.handle.toLowerCase())!;
          return {
            handle: c.handle,
            displayName: c.displayName,
            spam: v.spam,
            confidence: v.confidence,
            reason: v.reason,
            sampleText: c.texts[0] ?? "",
          };
        });
    } catch (err) {
      if (attempt === 1) {
        throw new Error(
          `LLM returned unparseable verdicts after retry: ${err instanceof Error ? err.message : err}\n` +
            `Raw response: ${content.slice(0, 500)}`,
        );
      }
      console.warn("  malformed LLM response, retrying batch once...");
    }
  }
  return [];
}
