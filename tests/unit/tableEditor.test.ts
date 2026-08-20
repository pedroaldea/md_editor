import { describe, expect, it } from "vitest";
import {
  editMarkdownTable,
  getMarkdownTableContext,
  moveMarkdownTableCursor
} from "../../src/lib/tableEditor";
import { applySlashCommand } from "../../src/lib/slashCommands";

const table = "Before\n\n| Name | Status |\n| --- | :---: |\n| Ada | Done |\n\nAfter";

describe("Markdown table editor", () => {
  it("detects the active row, column and alignment", () => {
    const cursor = table.indexOf("Done") + 2;
    expect(getMarkdownTableContext(table, cursor)).toMatchObject({
      rowIndex: 2,
      columnIndex: 1,
      columnCount: 2,
      alignment: "center",
      canDeleteRow: true,
      canDeleteColumn: true
    });
    expect(getMarkdownTableContext(table, table.indexOf("Before"))).toBeNull();
  });

  it("adds and removes rows without touching surrounding content", () => {
    const cursor = table.indexOf("Done");
    const added = editMarkdownTable(table, cursor, "add-row");
    expect(added?.insert.split("\n")).toHaveLength(4);
    expect(table.slice(0, added?.from)).toBe("Before\n\n");
    expect(table.slice(added?.to)).toBe("\n\nAfter");

    const removed = editMarkdownTable(table, cursor, "delete-row");
    expect(removed?.insert).not.toContain("Ada");
    expect(removed?.insert).toContain("| Name");
  });

  it("adds, removes and aligns the active column", () => {
    const cursor = table.indexOf("Ada") + 1;
    const added = editMarkdownTable(table, cursor, "add-column");
    expect(added?.insert).toContain("Column 3");
    expect(added?.insert.split("\n")[0]?.split("|")).toHaveLength(5);

    const removed = editMarkdownTable(table, cursor, "delete-column");
    expect(removed?.insert).not.toContain("Name");
    expect(removed?.insert).toContain("Status");

    const aligned = editMarkdownTable(table, cursor, "cycle-alignment");
    expect(aligned?.insert.split("\n")[1]).toContain(":--");
  });

  it("formats uneven rows and rejects destructive header actions", () => {
    const uneven = "| A | Longer |\n| --- | --- |\n| 1 | 2 |";
    const formatted = editMarkdownTable(uneven, uneven.indexOf("Longer"), "format");
    expect(formatted?.insert).toContain("| A   | Longer |");
    expect(editMarkdownTable(uneven, uneven.indexOf("A"), "delete-row")).toBeNull();
  });

  it("moves across cells, skips the separator and wraps at table edges", () => {
    expect(moveMarkdownTableCursor(table, table.indexOf("Name"), "next"))
      .toBe(table.indexOf("Status"));
    expect(moveMarkdownTableCursor(table, table.indexOf("Status"), "next"))
      .toBe(table.indexOf("Ada"));
    expect(moveMarkdownTableCursor(table, table.indexOf("Ada"), "previous"))
      .toBe(table.indexOf("Status"));
    expect(moveMarkdownTableCursor(table, table.indexOf("Done"), "next"))
      .toBe(table.indexOf("Name"));
  });

  it("keeps escaped pipes inside their cell while editing", () => {
    const escaped = "| Key | Value |\n| --- | --- |\n| A\\|B | kept |";
    const cursor = escaped.indexOf("A\\|B") + 2;
    expect(getMarkdownTableContext(escaped, cursor)).toMatchObject({
      rowIndex: 2,
      columnIndex: 0,
      columnCount: 2
    });
    expect(editMarkdownTable(escaped, cursor, "format")?.insert).toContain("A\\|B");
    expect(moveMarkdownTableCursor(escaped, cursor, "next")).toBe(escaped.indexOf("kept"));
  });

  it("round-trips a vertical selection from /table into the contextual editor", () => {
    const applied = applySlashCommand("table", {
      document: "Alpha\nBeta",
      slashFrom: 0,
      slashTo: 5,
      preservedSelection: "Alpha\nBeta"
    });

    expect(applied.insert).toBe("| Column |\n| --- |\n| Alpha |\n| Beta |");
    expect(getMarkdownTableContext(applied.insert, applied.cursor)).toMatchObject({
      rowIndex: 3,
      columnIndex: 0,
      columnCount: 1,
      canDeleteRow: true,
      canDeleteColumn: false
    });
  });
});
