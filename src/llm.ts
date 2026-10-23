import { sleep, warn } from "./util.js";

export interface LlmSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  // How long to wait for one reply. Free models can queue for a while.
  timeoutMs?: number;
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

const MAX_CONSECUTIVE_FAILURES = 2;

// Works with any service that speaks the OpenAI chat-completions format.
// Never throws: the agent carries on without the model if a call fails. After
// two failures in a row it stops asking for the rest of the run, so a slow or
// broken model can't hold the whole run up.
export class LlmClient {
  private failures = 0;

  constructor(private readonly settings: LlmSettings) {}

  async complete(system: string, user: string): Promise<string | null> {
    if (this.failures >= MAX_CONSECUTIVE_FAILURES) return null;

    const reply = await this.attempt(system, user);
    this.failures = reply === null ? this.failures + 1 : 0;

    if (this.failures === MAX_CONSECUTIVE_FAILURES) {
      warn("The AI model failed twice in a row. Skipping it for the rest of this run.");
    }

    return reply;
  }

  private async attempt(system: string, user: string): Promise<string | null> {
    const timeoutMs = this.settings.timeoutMs ?? 45_000;

    for (let tries = 0; tries < 2; tries++) {
      try {
        const response = await fetch(`${this.settings.baseUrl.replace(/\/$/, "")}/chat/completions`, {
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
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (response.status === 429 && tries === 0) {
          const wait = Math.min(Number(response.headers.get("retry-after")) || 10, 20);
          await response.body?.cancel();
          await sleep(wait * 1000);
          continue;
        }

        if (!response.ok) {
          // The provider's own error message says exactly what's wrong (bad key,
          // unknown model, blocked by account settings), so show it.
          const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 300);
          warn(`AI model answered ${response.status}${detail ? `: ${detail}` : "."}`);
          return null;
        }

        // Reading the body can also time out, so it stays inside the try.
        const data = (await response.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        return data.choices?.[0]?.message?.content ?? null;
      } catch (error) {
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        warn(
          timedOut
            ? `AI model took longer than ${Math.round(timeoutMs / 1000)} seconds to reply.`
            : `AI model call failed: ${error instanceof Error ? error.message : error}`,
        );
        return null;
      }
    }

    return null;
  }
}
