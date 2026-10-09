import { describe, expect, it } from "vitest";
import { chainBySharedSkills } from "./Info";
import { label, progressText, stations } from "./lines";

const google = {
  matched_skills: ["python", "machine learning"],
  related_skills: [{ skill: "deep learning", via: "machine learning" }],
  gap_skills: ["natural language processing"],
};

describe("breakdown helpers", () => {
  it("orders stations reached, then transfers, then ahead", () => {
    expect(stations(google).map((s) => s.kind)).toEqual(["reached", "reached", "transfer", "ahead"]);
  });


  it("states progress without decimals", () => {
    expect(progressText(stations(google))).toBe("2 of 4 skills + 1 related");
  });

  it("labels skills the way people write them", () => {
    expect(label("natural language processing")).toBe("NLP");
    expect(label("natural language processing", false)).toBe("Natural language processing");
    expect(label("node.js")).toBe("Node.js");
    expect(label("python")).toBe("Python");
  });


  it("chains companies that share skills next to each other", () => {
    const rows = chainBySharedSkills([
      { name: "A", top_skills: ["python", "ml"] },
      { name: "B", top_skills: ["react"] },
      { name: "C", top_skills: ["ml", "nlp"] },
    ]);
    expect(rows.map((r) => r.name)).toEqual(["A", "C", "B"]);
  });
});
