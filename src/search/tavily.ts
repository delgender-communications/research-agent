import type { SearchHit } from "../types.js";
import { info, warn } from "../util.js";

export class SearchLimitReached extends Error {}

// Thin wrapper over Tavily's search API that refuses to go past a fixed number
// of searches per run, so a bug can never burn the monthly free allowance.
export class TavilyClient {
  private used = 0;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly budget: number,
    private readonly country: string,
    private readonly resultsPerSearch: number,
  ) {}

  get searchesUsed(): number {
    return this.used;
  }

  get searchesLeft(): number {
    return Math.max(0, this.budget - this.used);
  }

  async search(query: string): Promise<SearchHit[]> {
    if (this.searchesLeft === 0) {
      throw new SearchLimitReached();
    }

    // Counted before the request, so a failed call still uses up budget.
    this.used++;
    info(`  search ${this.used}/${this.budget}: ${query}`);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          query,
          search_depth: "basic",
          max_results: this.resultsPerSearch,
          country: this.country,
          include_answer: false,
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      warn(`Search failed for "${query}":`, error instanceof Error ? error.message : error);
      return [];
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error("Tavily rejected the API key. Check TAVILY_API_KEY.");
    }

    if (response.status === 429 || response.status === 432 || response.status === 433) {
      warn("Tavily says the rate or monthly limit has been reached. Stopping searches.");
      this.used = this.budget;
      return [];
    }

    if (!response.ok) {
      warn(`Search for "${query}" answered ${response.status}.`);
      return [];
    }

    const data = (await response.json()) as {
      results?: { title?: string; url?: string; content?: string }[];
    };

    return (data.results ?? [])
      .filter((item) => typeof item.url === "string" && item.url.length > 0)
      .map((item) => ({
        title: item.title ?? "",
        url: item.url as string,
        content: item.content ?? "",
      }));
  }
}
