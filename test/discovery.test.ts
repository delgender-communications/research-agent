import { describe, expect, it } from "vitest";
import type { AgentConfig } from "../src/config.js";
import { buildQueries, classifyHit } from "../src/discovery.js";

const config = {
  city: "Johannesburg",
  industry: "solar installation",
  suburbs: ["Sandton", "Randburg", "Midrand"],
  queryTemplates: [
    "{industry} companies {city}",
    "{industry} installers {suburb}",
    "{industry} {suburb} contact us",
  ],
} as AgentConfig;

describe("classifyHit", () => {
  it("sorts results into what to do with them", () => {
    expect(
      classifyHit({
        title: "Sunbright",
        url: "https://sunbright.co.za/about",
        content: "",
      }),
    ).toBe("site");
    expect(
      classifyHit({
        title: "Sunbright",
        url: "https://www.facebook.com/sunbright",
        content: "",
      }),
    ).toBe("social");
    expect(
      classifyHit({
        title: "Gumtree",
        url: "https://www.gumtree.co.za/x",
        content: "",
      }),
    ).toBe("noise");
    expect(
      classifyHit({
        title: "Solar",
        url: "https://www.brabys.com/solar",
        content: "",
      }),
    ).toBe("directory");
    expect(
      classifyHit({
        title: "Top 10 solar installers in Joburg",
        url: "https://blog.example.com/top",
        content: "",
      }),
    ).toBe("directory");
  });
});

describe("classifyHit with excluded hosts", () => {
  it("treats configured hosts and their subdomains as noise", () => {
    const hit = {
      title: "Office",
      url: "https://www.remax.co.za/office/sandton",
      content: "",
    };

    expect(classifyHit(hit)).toBe("site");
    expect(classifyHit(hit, ["remax.co.za"])).toBe("noise");
  });
});

describe("buildQueries", () => {
  it("fills in the templates and rotates suburbs by day", () => {
    const monday = buildQueries(config, new Date("2026-10-19T00:00:00Z"), 10);
    const tuesday = buildQueries(config, new Date("2026-10-20T00:00:00Z"), 10);

    expect(monday[0]).toBe("solar installation companies Johannesburg");
    expect(monday).toHaveLength(3);
    expect(monday[1]).not.toBe(tuesday[1]);
  });

  it("never returns more than the limit", () => {
    expect(buildQueries(config, new Date(), 2)).toHaveLength(2);
  });
});
