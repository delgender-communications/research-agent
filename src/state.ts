import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const EXPIRY_DAYS = 60;

// Remembers which companies were already looked at so repeat runs spend their
// searches and model calls on new ones. Entries expire, so a company that was
// fine two months ago gets checked again.
export class SeenState {
  private hosts: Record<string, string> = {};

  constructor(private readonly path: string, private readonly now: Date) {
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { hosts?: Record<string, string> };
      const cutoff = now.getTime() - EXPIRY_DAYS * 86_400_000;
      for (const [host, when] of Object.entries(raw.hosts ?? {})) {
        if (new Date(when).getTime() >= cutoff) this.hosts[host] = when;
      }
    } catch {
      // First run, or an unreadable file: start fresh.
    }
  }

  has(host: string): boolean {
    return host in this.hosts;
  }

  mark(host: string): void {
    this.hosts[host] = this.now.toISOString();
  }

  save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify({ hosts: this.hosts }, null, 2));
  }
}
