import { describe, expect, it } from "vitest";
import {
  applySlashCommand,
  filterSlashCommands,
  type SlashApplyContext
} from "../../src/lib/slashCommands";

const createContext = (overrides: Partial<SlashApplyContext> = {}): SlashApplyContext => ({
  document: "/",
  slashFrom: 0,
  slashTo: 1,
  preservedSelection: "",
  ...overrides
});

describe("filterSlashCommands", () => {
  it("returns the expanded useful command menu when query is empty", () => {
    const commands = filterSlashCommands("");
    expect(commands.map((command) => command.id)).toEqual([
      "title",
      "bullet-list",
      "checklist",
      "quote",
      "code-block",
      "diagram",
      "table",
      "image",
      "link",
      "callout",
      "divider",
      "highlight",
      "underline"
    ]);
    expect(commands[0]?.id).toBe("title");
  });

  it("matches subtitle and code commands by live query", () => {
    expect(filterSlashCommands("su")[0]?.id).toBe("subtitle");
    expect(filterSlashCommands("co")[0]?.id).toBe("code-block");
    expect(filterSlashCommands("merm")[0]?.id).toBe("diagram");
    expect(filterSlashCommands("tab")[0]?.id).toBe("table");
    expect(filterSlashCommands("high")[0]?.id).toBe("highlight");
    expect(filterSlashCommands("under")[0]?.id).toBe("underline");
    expect(filterSlashCommands("img")[0]?.id).toBe("image");
    expect(filterSlashCommands("remote")[0]?.id).toBe("image-url");
    expect(filterSlashCommands("warn")[0]?.id).toBe("warning");
    expect(filterSlashCommands("tip")[0]?.id).toBe("tip");
    expect(filterSlashCommands("bold")[0]?.id).toBe("bold");
    expect(filterSlashCommands("foot")[0]?.id).toBe("footnote");
  });
});

describe("applySlashCommand", () => {
  it("applies heading formats using preserved selection", () => {
    const applied = applySlashCommand(
      "subtitle",
      createContext({
        preservedSelection: "Roadmap"
      })
    );

    expect(applied.insert).toBe("## Roadmap");
    expect(applied.cursor).toBe(applied.insert.length);
  });

  it("transforms multiline selection into list and quote blocks", () => {
    const bullet = applySlashCommand(
      "bullet-list",
      createContext({
        preservedSelection: "One\nTwo\nThree"
      })
    );
    expect(bullet.insert).toBe("- One\n- Two\n- Three");

    const numbered = applySlashCommand(
      "numbered-list",
      createContext({
        preservedSelection: "Alpha\nBeta"
      })
    );
    expect(numbered.insert).toBe("1. Alpha\n2. Beta");

    const checklist = applySlashCommand(
      "checklist",
      createContext({
        preservedSelection: "Task A\nTask B"
      })
    );
    expect(checklist.insert).toBe("- [ ] Task A\n- [ ] Task B");

    const quote = applySlashCommand(
      "quote",
      createContext({
        preservedSelection: "Important note"
      })
    );
    expect(quote.insert).toBe("> Important note");
  });

  it("creates code blocks with correct cursor positions", () => {
    const emptySelection = applySlashCommand("code-block", createContext());
    expect(emptySelection.insert).toBe("```\n\n```");
    expect(emptySelection.cursor).toBe(4);

    const withSelection = applySlashCommand(
      "code-block",
      createContext({
        preservedSelection: "const value = 42;"
      })
    );
    expect(withSelection.insert).toBe("```\nconst value = 42;\n```");
    expect(withSelection.cursor).toBe(withSelection.insert.length);
  });

  it("creates an editable Mermaid diagram", () => {
    const empty = applySlashCommand("diagram", createContext());
    expect(empty.insert).toBe("```mermaid\nflowchart LR\n    A[Start] --> B[Next step]\n```");
    expect(empty.cursor).toBe("```mermaid\n".length);

    const selected = applySlashCommand(
      "diagram",
      createContext({ preservedSelection: "sequenceDiagram\nA->>B: Hello" })
    );
    expect(selected.insert).toBe("```mermaid\nsequenceDiagram\nA->>B: Hello\n```");
  });

  it("creates an editable table and transforms row selections", () => {
    const emptySelection = applySlashCommand("table", createContext());
    expect(emptySelection.insert).toBe("| Column 1 | Column 2 |\n| --- | --- |\n|  |  |");
    expect(emptySelection.cursor).toBe(emptySelection.insert.lastIndexOf("|  |  |") + 2);

    const plainRows = applySlashCommand(
      "table",
      createContext({ preservedSelection: "Alpha\nBeta" })
    );
    expect(plainRows.insert).toBe("| Column |\n| --- |\n| Alpha |\n| Beta |");

    const tabularRows = applySlashCommand(
      "table",
      createContext({ preservedSelection: "Name\tStatus\nAda\tDone" })
    );
    expect(tabularRows.insert).toBe("| Name | Status |\n| --- | --- |\n| Ada | Done |");
  });

  it("wraps empty, selected and multiline text with annotation markers", () => {
    const emptyHighlight = applySlashCommand("highlight", createContext());
    expect(emptyHighlight.insert).toBe("====");
    expect(emptyHighlight.cursor).toBe(2);

    const highlight = applySlashCommand(
      "highlight",
      createContext({ preservedSelection: "Decision" })
    );
    expect(highlight.insert).toBe("==Decision==");

    const underline = applySlashCommand(
      "underline",
      createContext({ preservedSelection: "First\nSecond" })
    );
    expect(underline.insert).toBe("++First++\n++Second++");
  });

  it("inserts a divider with line-aware spacing", () => {
    const context = createContext({
      document: "alpha/beta",
      slashFrom: 5,
      slashTo: 6
    });

    const applied = applySlashCommand("divider", context);
    expect(applied.insert).toBe("\n---\n");
    expect(applied.from).toBe(5);
    expect(applied.to).toBe(6);
  });

  it("creates media, links, inline formats and richer blocks", () => {
    expect(applySlashCommand("image", createContext()).insert).toBe("![Alt text](image.png)");
    const remoteImage = applySlashCommand("image-url", createContext());
    expect(remoteImage.insert).toBe("![Alt text](https://)");
    expect(remoteImage.cursor).toBe(remoteImage.from + remoteImage.insert.indexOf("https://") + 8);
    expect(applySlashCommand("link", createContext({ preservedSelection: "Source" })).insert)
      .toBe("[Source](https://)");
    expect(applySlashCommand("bold", createContext({ preservedSelection: "Decision" })).insert)
      .toBe("**Decision**");
    expect(applySlashCommand("italic", createContext({ preservedSelection: "Quiet" })).insert)
      .toBe("*Quiet*");
    expect(applySlashCommand("strikethrough", createContext({ preservedSelection: "Old" })).insert)
      .toBe("~~Old~~");
    expect(applySlashCommand("inline-code", createContext({ preservedSelection: "npm test" })).insert)
      .toBe("`npm test`");
    expect(applySlashCommand("callout", createContext()).insert).toBe("> [!NOTE]\n> ");
    expect(applySlashCommand("tip", createContext()).insert).toBe("> [!TIP]\n> ");
    expect(applySlashCommand("warning", createContext({ preservedSelection: "Be careful" })).insert)
      .toBe("> [!WARNING]\n> Be careful");
    expect(applySlashCommand("footnote", createContext()).insert).toBe("[^1]\n\n[^1]: ");
    expect(applySlashCommand("details", createContext()).insert).toContain("<details>");
  });
});
