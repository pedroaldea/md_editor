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
  it("returns all commands when query is empty", () => {
    const commands = filterSlashCommands("");
    expect(commands.length).toBe(10);
    expect(commands[0]?.id).toBe("title");
  });

  it("matches subtitle and code commands by live query", () => {
    expect(filterSlashCommands("su")[0]?.id).toBe("subtitle");
    expect(filterSlashCommands("co")[0]?.id).toBe("code-block");
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
});
