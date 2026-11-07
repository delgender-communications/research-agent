import { describe, expect, it } from "vitest";
import { triage } from "../src/triage.js";
import type { ScoredLead } from "../src/types.js";

const options = {
  minScore: 30,
  researchMinScore: 0,
  maxLeads: 2,
  maxResearch: 3,
  city: "Pretoria",
};

function lead(
  name: string,
  score: number,
  extra: Partial<ScoredLead["audited"]> = {},
): ScoredLead {
  return {
    audited: {
      candidate: {
        host: `${name}.example`,
        nameHint: name,
        snippet: "",
        via: "test",
      },
      companyName: name,
      fit: { industry: true, location: true, viaSnippet: false },
      ...extra,
    },
    case: score > 0 ? "LowVisibility" : "Other",
    score,
    needPoints: score,
    fitPoints: 0,
    evidence: [{ finding: "A finding." }],
  };
}

const names = (items: { lead: ScoredLead }[]) =>
  items.map((item) => item.lead.audited.companyName);

describe("triage", () => {
  it("recommends strong leads and sends low scorers to research instead of dropping them", () => {
    const { recommended, research } = triage(
      [lead("a", 50), lead("b", 10), lead("c", 0)],
      options,
    );

    expect(names(recommended)).toEqual(["a"]);
    expect(names(research)).toEqual(["b", "c"]);
    expect(research.every((item) => item.needsResearch)).toBe(true);
    expect(research[0]?.researchReasons.join(" ")).toMatch(/small gaps/);
    expect(research[1]?.researchReasons.join(" ")).toMatch(/No clear gaps/);
  });

  it("sends a strong lead to research when the area is not confirmed", () => {
    const unconfirmed = lead("a", 80, {
      fit: { industry: true, location: false, viaSnippet: false },
    });
    const { recommended, research } = triage([unconfirmed], options);

    expect(recommended).toHaveLength(0);
    expect(research[0]?.researchReasons.join(" ")).toMatch(
      /Confirm they're in Pretoria/,
    );
  });

  it("keeps strong leads over the run's limit in research rather than losing them", () => {
    const { recommended, research } = triage(
      [lead("a", 90), lead("b", 80), lead("c", 70)],
      options,
    );

    expect(names(recommended)).toEqual(["a", "b"]);
    expect(names(research)).toEqual(["c"]);
    expect(research[0]?.researchReasons[0]).toMatch(/limited to 2/);
  });

  it("explains a JavaScript-drawn page and caps the research list", () => {
    const shell = lead("shell", 5);
    shell.audited.site = {
      stack: {
        frameworks: ["Next.js"],
        builder: null,
        hosting: null,
        scriptRendered: true,
        starterDomain: false,
      },
    } as ScoredLead["audited"]["site"];

    const { research } = triage(
      [shell, lead("b", 4), lead("c", 3), lead("d", 2), lead("e", 1)],
      options,
    );

    expect(research).toHaveLength(3);
    expect(research[0]?.researchReasons.join(" ")).toMatch(
      /drawn by JavaScript \(Next\.js · JS-rendered\)/,
    );
  });

  it("can leave out research leads below a score", () => {
    const { research } = triage([lead("a", 10), lead("b", 2)], {
      ...options,
      researchMinScore: 5,
    });
    expect(names(research)).toEqual(["a"]);
  });

  it("turns the research list off when the limit is 0", () => {
    const { research } = triage([lead("a", 10)], {
      ...options,
      maxResearch: 0,
    });
    expect(research).toHaveLength(0);
  });
});
