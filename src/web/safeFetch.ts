import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type FetchResult =
  | { ok: true; url: string; status: number; html: string; ms: number }
  | {
      ok: false;
      reason:
        | "blocked-host"
        | "robots"
        | "timeout"
        | "network"
        | "http"
        | "not-html"
        | "too-many-redirects";
      status?: number;
    };

export function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);

  if (version === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb")
    ) {
      return true;
    }
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIp(mapped[1] as string) : false;
  }

  return false;
}

// True when "User-agent: *" is told to stay out of the whole site.
export function robotsDisallowsAll(text: string): boolean {
  let appliesToUs = false;
  let inAgentLines = false;
  let disallowsRoot = false;
  let hasAllow = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;

    const separator = line.indexOf(":");
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      if (!inAgentLines) {
        // A new group starts here.
        appliesToUs = false;
      }
      inAgentLines = true;
      if (value === "*") appliesToUs = true;
      continue;
    }

    inAgentLines = false;
    if (!appliesToUs) continue;

    if (field === "disallow" && value === "/") disallowsRoot = true;
    if (field === "allow" && value) hasAllow = true;
  }

  return disallowsRoot && !hasAllow;
}

export interface FetcherOptions {
  userAgent: string;
  allowPrivateHosts: boolean;
  timeoutMs?: number;
  maxBytes?: number;
}

const MAX_REDIRECTS = 5;

// Fetches public web pages politely: identifies itself, obeys a full-site
// robots.txt block, refuses addresses inside private networks (checked on every
// redirect), and caps both time and size.
export class SafeFetcher {
  private readonly robotsCache = new Map<string, boolean>();
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(private readonly options: FetcherOptions) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxBytes = options.maxBytes ?? 1_500_000;
  }

  async getHtml(url: string): Promise<FetchResult> {
    let result = await this.getHtmlOnce(url);

    // One retry for the kind of failure that is often just a blip.
    if (
      !result.ok &&
      (result.reason === "timeout" || result.reason === "network")
    ) {
      result = await this.getHtmlOnce(url);
    }

    return result;
  }

  private async getHtmlOnce(startUrl: string): Promise<FetchResult> {
    const started = Date.now();
    let current = startUrl;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const checked = await this.checkAllowed(current);
      if (checked) return checked;

      let response: Response;
      try {
        response = await fetch(current, {
          redirect: "manual",
          headers: {
            "User-Agent": this.options.userAgent,
            Accept: "text/html,application/xhtml+xml",
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        const timedOut =
          error instanceof Error &&
          (error.name === "TimeoutError" || error.name === "AbortError");
        return { ok: false, reason: timedOut ? "timeout" : "network" };
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location)
          return { ok: false, reason: "http", status: response.status };
        try {
          current = new URL(location, current).toString();
        } catch {
          return { ok: false, reason: "network" };
        }
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel();
        return { ok: false, reason: "http", status: response.status };
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType && !/html|xml/i.test(contentType)) {
        await response.body?.cancel();
        return { ok: false, reason: "not-html" };
      }

      let html: string;
      try {
        html = await this.readBody(response);
      } catch (error) {
        const timedOut =
          error instanceof Error &&
          (error.name === "TimeoutError" || error.name === "AbortError");
        return { ok: false, reason: timedOut ? "timeout" : "network" };
      }

      return {
        ok: true,
        url: current,
        status: response.status,
        html,
        ms: Date.now() - started,
      };
    }

    return { ok: false, reason: "too-many-redirects" };
  }

  private async checkAllowed(url: string): Promise<FetchResult | null> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, reason: "network" };
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, reason: "blocked-host" };
    }

    if (
      !this.options.allowPrivateHosts &&
      !(await this.isPublicHost(parsed.hostname))
    ) {
      return { ok: false, reason: "blocked-host" };
    }

    if (await this.robotsBlocks(parsed.origin)) {
      return { ok: false, reason: "robots" };
    }

    return null;
  }

  private async isPublicHost(hostname: string): Promise<boolean> {
    const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();

    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".internal")
    ) {
      return false;
    }

    if (isIP(host)) return !isPrivateIp(host);

    try {
      const addresses = await lookup(host, { all: true });
      return (
        addresses.length > 0 &&
        addresses.every((entry) => !isPrivateIp(entry.address))
      );
    } catch {
      // Doesn't resolve: let the real request report it as a network failure.
      return true;
    }
  }

  private async robotsBlocks(origin: string): Promise<boolean> {
    const cached = this.robotsCache.get(origin);
    if (cached !== undefined) return cached;

    let blocked = false;
    try {
      const response = await fetch(`${origin}/robots.txt`, {
        redirect: "follow",
        headers: { "User-Agent": this.options.userAgent },
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        blocked = robotsDisallowsAll((await response.text()).slice(0, 100_000));
      } else {
        await response.body?.cancel();
      }
    } catch {
      // No readable robots.txt means nothing is blocked.
    }

    this.robotsCache.set(origin, blocked);
    return blocked;
  }

  private async readBody(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return "";

    const chunks: Uint8Array[] = [];
    let total = 0;

    while (total < this.maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }

    await reader.cancel().catch(() => undefined);
    return new TextDecoder("utf-8", { fatal: false }).decode(
      Buffer.concat(chunks),
    );
  }
}
