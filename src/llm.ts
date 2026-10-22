import { sleep, warn } from "./util.js";

export interface LlmSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

// Pulls the first JSON object out of a model reply, even if it wrapped it in
// a code fence or added a sentence around it.
export function extractJson(text: string): unknown | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Works with any service that speaks the OpenAI chat-completions format.
// Never throws: the agent carries on without the model if a call fails.
export class LlmClient {
  constructor(private readonly settings: LlmSettings) {}

  async complete(system: string, user: string): Promise<string | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response;
      try {
        response = await fetch(`${this.settings.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.settings.apiKey}`,
          },
          body: JSON.stringify({
            model: this.settings.model,
            temperature: 0.2,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (error) {
        warn("AI model call failed:", error instanceof Error ? error.message : error);
        return null;
      }

      if (response.status === 429 && attempt === 0) {
        const wait = Math.min(Number(response.headers.get("retry-after")) || 10, 20);
        await response.body?.cancel();
        await sleep(wait * 1000);
        continue;
      }

      if (!response.ok) {
        warn(`AI model answered ${response.status}.`);
        await response.body?.cancel();
        return null;
      }

      const data = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      return data.choices?.[0]?.message?.content ?? null;
    }

    return null;
  }
}
