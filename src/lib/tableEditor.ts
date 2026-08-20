export type TableEditAction =
  | "add-row"
  | "add-column"
  | "delete-row"
  | "delete-column"
  | "cycle-alignment"
  | "format";

export type TableMoveDirection = "previous" | "next";

export type TableAlignment = "default" | "left" | "center" | "right";

export interface MarkdownTableContext {
  from: number;
  to: number;
  rowIndex: number;
  columnIndex: number;
  columnCount: number;
  alignment: TableAlignment;
  canDeleteRow: boolean;
  canDeleteColumn: boolean;
}

export interface MarkdownTableEditResult {
  from: number;
  to: number;
  insert: string;
  cursor: number;
}

const TABLE_SEPARATOR_PATTERN = /^\s*\|?\s*:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)*\s*\|?\s*$/u;

interface LineRecord {
  text: string;
  from: number;
  to: number;
}

const lineRecords = (markdown: string): LineRecord[] => {
  const records: LineRecord[] = [];
  let from = 0;
  for (const text of markdown.split("\n")) {
    records.push({ text, from, to: from + text.length });
    from += text.length + 1;
  }
  return records;
};

const parseCells = (line: string): string[] => {
  const trimmed = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const character of trimmed) {
    if (character === "|" && !escaped) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += character;
    if (character === "\\" && !escaped) {
      escaped = true;
    } else {
      escaped = false;
    }
  }
  cells.push(cell.trim());
  return cells;
};

const alignmentFromCell = (cell: string): TableAlignment => {
  const trimmed = cell.trim();
  if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
  if (trimmed.startsWith(":")) return "left";
  if (trimmed.endsWith(":")) return "right";
  return "default";
};

const separatorForAlignment = (alignment: TableAlignment, width: number): string => {
  const safeWidth = Math.max(3, width);
  if (alignment === "center") return `:${"-".repeat(Math.max(1, safeWidth - 2))}:`;
  if (alignment === "left") return `:${"-".repeat(Math.max(2, safeWidth - 1))}`;
  if (alignment === "right") return `${"-".repeat(Math.max(2, safeWidth - 1))}:`;
  return "-".repeat(safeWidth);
};

const countPipes = (value: string): number => {
  let count = 0;
  let escaped = false;
  for (const character of value) {
    if (character === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if (character === "|" && !escaped) count += 1;
    escaped = false;
  }
  return count;
};

const unescapedPipePositions = (value: string): number[] => {
  const positions: number[] = [];
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if (character === "|" && !escaped) positions.push(index);
    escaped = false;
  }
  return positions;
};

const cellContentOffset = (line: string, columnIndex: number): number => {
  const pipes = unescapedPipePositions(line);
  const leadingPipe = line.trimStart().startsWith("|");
  const leadingWhitespace = line.length - line.trimStart().length;
  const rawStart = leadingPipe
    ? (pipes[columnIndex] ?? pipes[pipes.length - 1] ?? leadingWhitespace) + 1
    : columnIndex === 0
      ? leadingWhitespace
      : (pipes[columnIndex - 1] ?? pipes[pipes.length - 1] ?? leadingWhitespace) + 1;
  const rawEnd = leadingPipe
    ? pipes[columnIndex + 1] ?? line.length
    : pipes[columnIndex] ?? line.length;
  let contentStart = Math.max(0, Math.min(line.length, rawStart));
  const lastEditableOffset = Math.max(contentStart, rawEnd - 1);
  while (contentStart < lastEditableOffset && /\s/u.test(line[contentStart] ?? "")) {
    contentStart += 1;
  }
  return contentStart;
};

const findContext = (markdown: string, cursor: number): {
  context: MarkdownTableContext;
  records: LineRecord[];
  startLine: number;
  endLine: number;
} | null => {
  const records = lineRecords(markdown);
  const safeCursor = Math.max(0, Math.min(markdown.length, cursor));
  const currentLine = Math.max(0, records.findIndex((line) => safeCursor >= line.from && safeCursor <= line.to));
  const current = records[currentLine];
  if (!current?.text.includes("|")) return null;

  let startLine = currentLine;
  while (startLine > 0 && records[startLine - 1]?.text.includes("|") && records[startLine - 1]?.text.trim()) {
    startLine -= 1;
  }
  let endLine = currentLine;
  while (
    endLine + 1 < records.length &&
    records[endLine + 1]?.text.includes("|") &&
    records[endLine + 1]?.text.trim()
  ) {
    endLine += 1;
  }

  const separator = records[startLine + 1];
  if (!separator || !TABLE_SEPARATOR_PATTERN.test(separator.text)) return null;

  const rows = records.slice(startLine, endLine + 1).map((record) => parseCells(record.text));
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const prefix = current.text.slice(0, Math.max(0, safeCursor - current.from));
  const hasLeadingPipe = current.text.trimStart().startsWith("|");
  const columnIndex = Math.min(
    columnCount - 1,
    Math.max(0, countPipes(prefix) - (hasLeadingPipe ? 1 : 0))
  );
  const rowIndex = currentLine - startLine;
  const separatorCells = parseCells(separator.text);

  return {
    context: {
      from: records[startLine]?.from ?? 0,
      to: records[endLine]?.to ?? markdown.length,
      rowIndex,
      columnIndex,
      columnCount,
      alignment: alignmentFromCell(separatorCells[columnIndex] ?? "---"),
      canDeleteRow: rowIndex >= 2,
      canDeleteColumn: columnCount > 1
    },
    records,
    startLine,
    endLine
  };
};

export const getMarkdownTableContext = (
  markdown: string,
  cursor: number
): MarkdownTableContext | null => findContext(markdown, cursor)?.context ?? null;

export const moveMarkdownTableCursor = (
  markdown: string,
  cursor: number,
  direction: TableMoveDirection
): number | null => {
  const located = findContext(markdown, cursor);
  if (!located) return null;

  const { context, records, startLine, endLine } = located;
  const navigableRows = [
    startLine,
    ...Array.from(
      { length: Math.max(0, endLine - startLine - 1) },
      (_, index) => startLine + index + 2
    )
  ];
  if (navigableRows.length === 0) return null;

  const currentAbsoluteLine = startLine + context.rowIndex;
  const currentRow = Math.max(0, navigableRows.indexOf(currentAbsoluteLine));
  const currentCell = currentRow * context.columnCount + context.columnIndex;
  const cellCount = navigableRows.length * context.columnCount;
  const delta = direction === "next" ? 1 : -1;
  const targetCell = (currentCell + delta + cellCount) % cellCount;
  const targetRow = Math.floor(targetCell / context.columnCount);
  const targetColumn = targetCell % context.columnCount;
  const targetRecord = records[navigableRows[targetRow] ?? startLine];
  if (!targetRecord) return null;
  return targetRecord.from + cellContentOffset(targetRecord.text, targetColumn);
};

const formatTable = (
  rows: string[][],
  alignments: TableAlignment[],
  columnCount: number
): string => {
  const normalizedRows = rows.map((row) =>
    Array.from({ length: columnCount }, (_, column) => row[column] ?? "")
  );
  const widths = Array.from({ length: columnCount }, (_, column) =>
    Math.max(
      3,
      ...normalizedRows.map((row, rowIndex) => rowIndex === 1 ? 0 : (row[column] ?? "").length)
    )
  );
  const formatRow = (cells: string[]): string =>
    `| ${cells.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join(" | ")} |`;

  return normalizedRows.map((row, rowIndex) => {
    if (rowIndex !== 1) return formatRow(row);
    return `| ${row.map((_, column) =>
      separatorForAlignment(alignments[column] ?? "default", widths[column] ?? 3)
    ).join(" | ")} |`;
  }).join("\n");
};

const cellOffset = (table: string, rowIndex: number, columnIndex: number): number => {
  const lines = table.split("\n");
  const safeRow = Math.max(0, Math.min(lines.length - 1, rowIndex));
  const lineOffset = lines.slice(0, safeRow).reduce((total, line) => total + line.length + 1, 0);
  const line = lines[safeRow] ?? "";
  return lineOffset + cellContentOffset(line, columnIndex);
};

export const editMarkdownTable = (
  markdown: string,
  cursor: number,
  action: TableEditAction
): MarkdownTableEditResult | null => {
  const located = findContext(markdown, cursor);
  if (!located) return null;
  const { context, records, startLine, endLine } = located;
  const rows = records.slice(startLine, endLine + 1).map((record) => parseCells(record.text));
  const alignments = Array.from({ length: context.columnCount }, (_, column) =>
    alignmentFromCell(rows[1]?.[column] ?? "---")
  );
  let targetRow = context.rowIndex;
  let targetColumn = context.columnIndex;

  if (action === "add-row") {
    const insertAt = context.rowIndex >= 2 ? context.rowIndex + 1 : 2;
    rows.splice(insertAt, 0, Array.from({ length: context.columnCount }, () => ""));
    targetRow = insertAt;
  }

  if (action === "add-column") {
    const insertAt = context.columnIndex + 1;
    rows.forEach((row, rowIndex) => {
      row.splice(insertAt, 0, rowIndex === 0 ? `Column ${context.columnCount + 1}` : rowIndex === 1 ? "---" : "");
    });
    alignments.splice(insertAt, 0, "default");
    targetColumn = insertAt;
  }

  if (action === "delete-row") {
    if (!context.canDeleteRow) return null;
    rows.splice(context.rowIndex, 1);
    targetRow = Math.max(2, Math.min(context.rowIndex - 1, rows.length - 1));
  }

  if (action === "delete-column") {
    if (!context.canDeleteColumn) return null;
    rows.forEach((row) => row.splice(context.columnIndex, 1));
    alignments.splice(context.columnIndex, 1);
    targetColumn = Math.max(0, Math.min(context.columnIndex, context.columnCount - 2));
  }

  if (action === "cycle-alignment") {
    const order: TableAlignment[] = ["default", "left", "center", "right"];
    const currentIndex = order.indexOf(alignments[context.columnIndex] ?? "default");
    alignments[context.columnIndex] = order[(currentIndex + 1) % order.length] ?? "default";
  }

  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const insert = formatTable(rows, alignments, columnCount);
  return {
    from: context.from,
    to: context.to,
    insert,
    cursor: context.from + cellOffset(insert, targetRow, targetColumn)
  };
};
