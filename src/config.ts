import { readFileSync } from "node:fs";
import { z } from "zod";

const ConfigSchema = z.object({
  city: z.string().min(1),
  country: z.string().min(1),
  industry: z.string().min(1),
  industryLabel: z.string().min(1),
  industryKeywords: z.array(z.string().min(1)).min(1),
  locationKeywords: z.array(z.string().min(1)).min(1),
  suburbs: z.array(z.string().min(1)).default([]),
  queryTemplates: z.array(z.string().min(1)).min(1),
  maxSearchesPerRun: z.number().int().min(1).max(40).default(10),
  resultsPerSearch: z.number().int().min(1).max(20).default(10),
  reputationChecks: z.number().int().min(0).max(10).default(3),
  maxSitesToAudit: z.number().int().min(1).max(100).default(40),
  maxLeadsPerRun: z.number().int().min(1).max(100).default(15),
  minScore: z.number().int().min(0).max(100).default(30),
});

export type AgentConfig = z.infer<typeof ConfigSchema>;

const EnvSchema = z.object({
  TAVILY_API_KEY: z.string().min(1, "TAVILY_API_KEY is required"),
  TAVILY_BASE_URL: z.string().url().default("https://api.tavily.com"),
  PORTAL_URL: z.string().url().optional(),
  PORTAL_API_KEY: z.string().min(1).optional(),
  LLM_BASE_URL: z.string().url().optional(),
  LLM_API_KEY: z.string().min(1).optional(),
  LLM_MODEL: z.string().min(1).optional(),
  CONTACT: z.string().min(1).optional(),
  STATE_FILE: z.string().min(1).default(".state/seen.json"),
  OUT_DIR: z.string().min(1).default("out"),
  // Only for testing against a local mock server. Never switch on in production.
  ALLOW_PRIVATE_HOSTS: z.enum(["true", "false"]).default("false"),
});

export type AgentEnv = z.infer<typeof EnvSchema>;

export function loadConfig(path: string): AgentConfig {
  return ConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function loadEnv(): AgentEnv {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env file: fine, real environment variables are used.
  }

  // GitHub passes unset secrets as empty strings, so treat "" as "not set".
  const cleaned = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined && value !== ""),
  );

  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `- ${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Problems with the environment settings:\n${problems}`);
  }

  return parsed.data;
}

export function llmSettings(env: AgentEnv) {
  return env.LLM_BASE_URL && env.LLM_API_KEY && env.LLM_MODEL
    ? { baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL }
    : null;
}
