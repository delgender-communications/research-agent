import { describe, expect, it } from "vitest";
import { checkSocial, parseFollowers } from "../src/social.js";
import type { TavilyClient } from "../src/search/tavily.js";
import type { AgentConfig } from "../src/config.js";
import type { SearchHit } from "../src/types.js";

describe("parseFollowers", () => {
  it("reads the number formats search results use", () => {
    expect(parseFollowers("Nimbus Labs | 1,234 followers on LinkedIn")).toBe(
      1234,
    );
    expect(parseFollowers("12K followers")).toBe(12000);
    expect(parseFollowers("1.2K Followers, 300 Following")).toBe(1200);
    expect(parseFollowers("1 234 likes")).toBe(1234);
    expect(parseFollowers("no numbers here")).toBeUndefined();
  });
});

const fakeTavily = (hits: SearchHit[], left = 1) =>
  ({ searchesLeft: left, search: async () => hits }) as unknown as TavilyClient;

const config = { city: "Pretoria" } as AgentConfig;

describe("checkSocial", () => {
  it("keeps company pages about this company and skips everything else", async () => {
    const tavily = fakeTavily([
      {
        title: "Nimbus Labs | LinkedIn",
        url: "https://www.linkedin.com/company/nimbus-labs",
        content: "Nimbus Labs | 120 followers on LinkedIn.",
      },
      {
        title: "Jane at Nimbus",
        url: "https://www.linkedin.com/in/jane",
        content: "Nimbus Labs engineer",
      },
      {
        title: "Other Co",
        url: "https://www.linkedin.com/company/other-co",
        content: "Other Co | 9,000 followers",
      },
      {
        title: "Nimbus Labs",
        url: "https://nimbus.example/about",
        content: "Nimbus Labs",
      },
    ]);

    const result = await checkSocial(
      "Nimbus Labs",
      "nimbus.example",
      config,
      tavily,
    );

    expect(result?.profiles).toEqual([
      {
        platform: "LinkedIn",
        url: "https://www.linkedin.com/company/nimbus-labs",
        followers: 120,
      },
    ]);
  });

  it("does nothing when the search budget is used up", async () => {
    expect(
      await checkSocial("Nimbus Labs", null, config, fakeTavily([], 0)),
    ).toBeNull();
  });
});
