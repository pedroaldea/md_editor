import { describe, expect, it } from "vitest";
import { normalizeMermaidSource, prepareMermaidSource } from "../../src/lib/mermaidRenderer";

describe("normalizeMermaidSource", () => {
  it("turns escaped label line breaks into WebKit-safe spaces", () => {
    expect(normalizeMermaidSource("flowchart LR\nA[First\\nSecond] --> B[Done]")).toBe(
      "flowchart LR\nA[First Second] --> B[Done]"
    );
  });

  it("keeps labelled feedback links compatible with native WebKit", () => {
    expect(normalizeMermaidSource("flowchart LR\nL -. controlled improvement .-> S")).toBe(
      "flowchart LR\nL -- controlled improvement --> S"
    );
  });

  it("targets the original dotted edge index when other links come first", () => {
    expect(prepareMermaidSource("flowchart LR\nA --> B\nB --> C\nC -. feedback .-> A")).toEqual({
      source: "flowchart LR\nA --> B\nB --> C\nC -- feedback --> A",
      dottedLinkIndexes: [2]
    });
  });

  it("counts valid non-arrow Mermaid links before dotted feedback", () => {
    expect(
      prepareMermaidSource(
        "flowchart LR\nA --- B\nB === C\nC o--x D\nD <--> E\nE ==> F\nF -.-> G\nG ~~~ H\nH -. feedback .-> A"
      )
    ).toEqual({
      source: "flowchart LR\nA --- B\nB === C\nC o--x D\nD <--> E\nE ==> F\nF -.-> G\nG ~~~ H\nH -- feedback --> A",
      dottedLinkIndexes: [7]
    });
  });

  it("counts an open link before dotted feedback on the same line", () => {
    expect(prepareMermaidSource("flowchart LR\nA --- B; B -. feedback .-> A")).toEqual({
      source: "flowchart LR\nA --- B; B -- feedback --> A",
      dottedLinkIndexes: [1]
    });
  });

  it("ignores link-like text inside node labels, quotes, pipe labels and comments", () => {
    expect(prepareMermaidSource([
      "flowchart LR",
      'A["---"] -->|label === not a link| B',
      "%% Ghost --- Edge",
      "B o--x C",
      "C -. feedback .-> A"
    ].join("\n"))).toEqual({
      source: [
        "flowchart LR",
        'A["---"] -->|label === not a link| B',
        "%% Ghost --- Edge",
        "B o--x C",
        "C -- feedback --> A"
      ].join("\n"),
      dottedLinkIndexes: [2]
    });
  });
});
