const TABLE_SEPARATOR_PATTERN = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/u;

const parseCells = (line: string): string[] => {
  const trimmed = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  return trimmed.split("|").map((cell) => cell.trim());
};

const formatRow = (cells: string[], widths: number[]): string =>
  `| ${cells.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join(" | ")} |`;

const buildSeparatorCell = (width: number, template: string): string => {
  const trimmed = template.trim();
  const left = trimmed.startsWith(":");
  const right = trimmed.endsWith(":");
  const bodyLength = Math.max(3, width);

  if (left && right) {
    return `:${"-".repeat(Math.max(1, bodyLength - 2))}:`;
  }
  if (left) {
    return `:${"-".repeat(Math.max(2, bodyLength - 1))}`;
  }
  if (right) {
    return `${"-".repeat(Math.max(2, bodyLength - 1))}:`;
  }
  return "-".repeat(bodyLength);
};

export const formatMarkdownTables = (markdown: string): string => {
  const lines = markdown.split(/\r?\n/u);
  const output: string[] = [];

  let index = 0;
  while (index < lines.length) {
    const header = lines[index];
    const separator = lines[index + 1];

    if (!header?.includes("|") || !separator || !TABLE_SEPARATOR_PATTERN.test(separator)) {
      output.push(header ?? "");
      index += 1;
      continue;
    }

    const tableLines = [header, separator];
    let cursor = index + 2;
    while (cursor < lines.length && lines[cursor].includes("|") && lines[cursor].trim().length > 0) {
      tableLines.push(lines[cursor]);
      cursor += 1;
    }

    const rows = tableLines.map(parseCells);
    const columnCount = Math.max(...rows.map((row) => row.length));
    const normalizedRows = rows.map((row) =>
      Array.from({ length: columnCount }, (_, column) => row[column] ?? "")
    );
    const widths = Array.from({ length: columnCount }, (_, column) =>
      Math.max(3, ...normalizedRows.map((row, rowIndex) => (rowIndex === 1 ? 0 : row[column].length)))
    );

    const separatorCells = normalizedRows[1];

    output.push(formatRow(normalizedRows[0], widths));
    output.push(
      `| ${separatorCells
        .map((cell, column) => buildSeparatorCell(widths[column] ?? 3, cell))
        .join(" | ")} |`
    );
    for (let rowIndex = 2; rowIndex < normalizedRows.length; rowIndex += 1) {
      output.push(formatRow(normalizedRows[rowIndex], widths));
    }

    index = cursor;
  }

  return output.join("\n");
};

