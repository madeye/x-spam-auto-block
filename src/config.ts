import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  LLM_API_BASE: z.string().url().default("https://api.deepseek.com"),
  LLM_API_KEY: z.string().min(1, "LLM_API_KEY is required"),
  LLM_MODEL: z.string().default("deepseek-v4-flash"),
  X_USERNAME: z
    .string()
    .min(1, "X_USERNAME is required")
    .transform((s) => s.replace(/^@/, "")),
  CHROME_DEBUG_URL: z.string().url().default("http://127.0.0.1:9222"),
  MAX_POSTS: z.coerce.number().int().positive().default(5),
  MAX_REPLIES_PER_POST: z.coerce.number().int().positive().default(100),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(): Config {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error(
      `Invalid configuration (copy .env.example to .env and fill it in):\n${issues}`,
    );
    process.exit(1);
  }
  return parsed.data;
}
