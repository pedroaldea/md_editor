import { describe, expect, it } from "vitest";
import { formatMarkdownTables } from "../../src/lib/tableFormatter";

describe("formatMarkdownTables", () => {
  it("aligns a valid markdown table", () => {
    const input = [
      "| Name | Value |",
      "| --- | ---: |",
      "| A | 1 |",
      "| Longer Name | 22 |"
    ].join("\n");

    const output = formatMarkdownTables(input);

    expect(output).toContain("| Name        | Value |");
    expect(output).toContain("| Longer Name | 22    |");
  });

  it("keeps malformed input unchanged", () => {
    const input = "No table here\njust text";
    expect(formatMarkdownTables(input)).toBe(input);
  });
});

