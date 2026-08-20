export type SlashCommandId =
  | "title"
  | "subtitle"
  | "heading-3"
  | "paragraph"
  | "bullet-list"
  | "numbered-list"
  | "checklist"
  | "quote"
  | "code-block"
  | "inline-code"
  | "diagram"
  | "table"
  | "image"
  | "image-url"
  | "link"
  | "bold"
  | "italic"
  | "strikethrough"
  | "callout"
  | "tip"
  | "warning"
  | "footnote"
  | "details"
  | "highlight"
  | "underline"
  | "divider";

export interface SlashCommand {
  id: SlashCommandId;
  mark: string;
  title: string;
  subtitle: string;
  keywords: string[];
}

export interface SlashApplyContext {
  document: string;
  slashFrom: number;
  slashTo: number;
  preservedSelection: string;
}

export interface SlashApplyResult {
  from: number;
  to: number;
  insert: string;
  cursor: number;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "title",
    mark: "H1",
    title: "Heading",
    subtitle: "# Heading 1",
    keywords: ["h1", "heading", "title", "header"]
  },
  {
    id: "subtitle",
    mark: "H2",
    title: "Heading 2",
    subtitle: "## Heading 2",
    keywords: ["h2", "heading", "subtitle", "subheading"]
  },
  {
    id: "heading-3",
    mark: "H3",
    title: "Heading 3",
    subtitle: "### Heading 3",
    keywords: ["h3", "heading", "subsection"]
  },
  {
    id: "paragraph",
    mark: "P",
    title: "Paragraph",
    subtitle: "Plain text block",
    keywords: ["paragraph", "text", "plain"]
  },
  {
    id: "bullet-list",
    mark: "-",
    title: "Bullet list",
    subtitle: "- Item",
    keywords: ["bullet", "unordered", "list", "ul"]
  },
  {
    id: "numbered-list",
    mark: "1.",
    title: "Numbered list",
    subtitle: "1. Item",
    keywords: ["numbered", "ordered", "list", "ol"]
  },
  {
    id: "checklist",
    mark: "x",
    title: "Checklist",
    subtitle: "- [ ] Task",
    keywords: ["task", "todo", "checkbox", "checklist"]
  },
  {
    id: "quote",
    mark: ">",
    title: "Quote",
    subtitle: "> Quote",
    keywords: ["quote", "blockquote", "citation"]
  },
  {
    id: "code-block",
    mark: "<>",
    title: "Code block",
    subtitle: "``` fenced code ```",
    keywords: ["code", "snippet", "fence", "pre"]
  },
  {
    id: "inline-code",
    mark: "`",
    title: "Inline code",
    subtitle: "`code`",
    keywords: ["inline", "code", "monospace"]
  },
  {
    id: "diagram",
    mark: "FLOW",
    title: "Diagram",
    subtitle: "Mermaid flowchart",
    keywords: ["diagram", "mermaid", "flowchart", "graph", "sequence"]
  },
  {
    id: "table",
    mark: "||",
    title: "Table",
    subtitle: "Columns and rows",
    keywords: ["table", "grid", "columns", "rows", "gfm"]
  },
  {
    id: "image",
    mark: "IMG",
    title: "Image",
    subtitle: "Choose file · ![alt](path)",
    keywords: ["image", "img", "photo", "picture", "media", "asset", "attach", "upload"]
  },
  {
    id: "image-url",
    mark: "URL",
    title: "Remote image",
    subtitle: "![alt](https://)",
    keywords: ["image", "img", "remote", "url", "web", "photo", "picture", "media"]
  },
  {
    id: "link",
    mark: "LINK",
    title: "Link",
    subtitle: "[text](https://)",
    keywords: ["link", "url", "website", "reference"]
  },
  {
    id: "bold",
    mark: "B",
    title: "Bold",
    subtitle: "**Strong text**",
    keywords: ["bold", "strong", "emphasis"]
  },
  {
    id: "italic",
    mark: "I",
    title: "Italic",
    subtitle: "*Emphasized text*",
    keywords: ["italic", "emphasis", "slanted"]
  },
  {
    id: "strikethrough",
    mark: "S",
    title: "Strikethrough",
    subtitle: "~~Removed text~~",
    keywords: ["strike", "strikethrough", "removed", "deleted"]
  },
  {
    id: "callout",
    mark: "NOTE",
    title: "Callout",
    subtitle: "> [!NOTE]",
    keywords: ["callout", "note", "warning", "tip", "alert"]
  },
  {
    id: "tip",
    mark: "TIP",
    title: "Tip",
    subtitle: "> [!TIP]",
    keywords: ["tip", "hint", "advice", "callout", "alert"]
  },
  {
    id: "warning",
    mark: "WARN",
    title: "Warning",
    subtitle: "> [!WARNING]",
    keywords: ["warning", "caution", "danger", "callout", "alert"]
  },
  {
    id: "footnote",
    mark: "FN",
    title: "Footnote",
    subtitle: "[^1] reference",
    keywords: ["footnote", "reference", "citation", "note"]
  },
  {
    id: "details",
    mark: "<>…",
    title: "Collapsible details",
    subtitle: "details / summary",
    keywords: ["details", "collapse", "accordion", "summary", "toggle"]
  },
  {
    id: "highlight",
    mark: "==",
    title: "Highlight",
    subtitle: "==Marked text==",
    keywords: ["highlight", "mark", "emphasis", "yellow"]
  },
  {
    id: "underline",
    mark: "++",
    title: "Underline",
    subtitle: "++Underlined text++",
    keywords: ["underline", "annotation", "line"]
  },
  {
    id: "divider",
    mark: "---",
    title: "Divider",
    subtitle: "---",
    keywords: ["divider", "horizontal", "rule", "hr"]
  }
];

const normalize = (value: string): string => value.toLowerCase().trim();

const scoreCommand = (command: SlashCommand, query: string): number => {
  if (!query) {
    return 1;
  }

  const haystack = `${command.title} ${command.subtitle} ${command.keywords.join(" ")}`.toLowerCase();
  if (command.title.toLowerCase().startsWith(query)) {
    return 120;
  }
  if (haystack.includes(query)) {
    return 80;
  }

  let score = 0;
  let cursor = 0;
  for (const character of query) {
    const index = haystack.indexOf(character, cursor);
    if (index < 0) {
      return 0;
    }
    score += 1;
    cursor = index + 1;
  }
  return score;
};

const normalizeLines = (value: string): string[] => value.replace(/\r\n?/gu, "\n").split("\n");

const stripBlockPrefix = (value: string): string =>
  value.replace(/^\s{0,3}(?:#{1,6}\s+|>\s+|[-*+]\s+|\d+\.\s+|-\s\[[ xX]\]\s+)/u, "");

const firstNonEmptyLine = (value: string): string => {
  const lines = normalizeLines(value).map((line) => stripBlockPrefix(line).trim());
  return lines.find((line) => line.length > 0) ?? "";
};

const toListLines = (
  value: string,
  formatter: (line: string, index: number) => string
): string => {
  const lines = normalizeLines(value);
  const output: string[] = [];
  let itemIndex = 0;

  for (const line of lines) {
    const cleaned = stripBlockPrefix(line).trim();
    if (cleaned.length === 0) {
      output.push("");
      continue;
    }
    output.push(formatter(cleaned, itemIndex));
    itemIndex += 1;
  }

  return output.join("\n");
};

const result = (context: SlashApplyContext, insert: string, cursorOffset: number): SlashApplyResult => ({
  from: context.slashFrom,
  to: context.slashTo,
  insert,
  cursor: context.slashFrom + cursorOffset
});

const applyHeading = (prefix: string, context: SlashApplyContext): SlashApplyResult => {
  const selectedLine = firstNonEmptyLine(context.preservedSelection);
  if (selectedLine.length > 0) {
    const insert = `${prefix}${selectedLine}`;
    return result(context, insert, insert.length);
  }

  return result(context, prefix, prefix.length);
};

const applyParagraph = (context: SlashApplyContext): SlashApplyResult => {
  const source = context.preservedSelection;
  if (source.trim().length === 0) {
    return result(context, "", 0);
  }

  const insert = normalizeLines(source).map((line) => stripBlockPrefix(line)).join("\n");
  return result(context, insert, insert.length);
};

const applyBulletList = (context: SlashApplyContext): SlashApplyResult => {
  if (context.preservedSelection.trim().length === 0) {
    return result(context, "- ", 2);
  }
  const insert = toListLines(context.preservedSelection, (line) => `- ${line}`);
  return result(context, insert, insert.length);
};

const applyNumberedList = (context: SlashApplyContext): SlashApplyResult => {
  if (context.preservedSelection.trim().length === 0) {
    return result(context, "1. ", 3);
  }
  const insert = toListLines(context.preservedSelection, (line, index) => `${index + 1}. ${line}`);
  return result(context, insert, insert.length);
};

const applyChecklist = (context: SlashApplyContext): SlashApplyResult => {
  if (context.preservedSelection.trim().length === 0) {
    return result(context, "- [ ] ", 6);
  }
  const insert = toListLines(context.preservedSelection, (line) => `- [ ] ${line}`);
  return result(context, insert, insert.length);
};

const applyQuote = (context: SlashApplyContext): SlashApplyResult => {
  if (context.preservedSelection.trim().length === 0) {
    return result(context, "> ", 2);
  }
  const insert = normalizeLines(context.preservedSelection)
    .map((line) => {
      const cleaned = stripBlockPrefix(line).trim();
      return cleaned.length > 0 ? `> ${cleaned}` : "";
    })
    .join("\n");
  return result(context, insert, insert.length);
};

const applyCodeBlock = (context: SlashApplyContext): SlashApplyResult => {
  if (context.preservedSelection.trim().length === 0) {
    const insert = "```\n\n```";
    return result(context, insert, 4);
  }

  const body = context.preservedSelection.replace(/\r\n?/gu, "\n").replace(/\n+$/u, "");
  const insert = `\`\`\`\n${body}\n\`\`\``;
  return result(context, insert, insert.length);
};

const applyDiagram = (context: SlashApplyContext): SlashApplyResult => {
  const source = context.preservedSelection.trim();
  if (source) {
    const insert = `\`\`\`mermaid\n${source}\n\`\`\``;
    return result(context, insert, insert.length);
  }

  const body = "flowchart LR\n    A[Start] --> B[Next step]";
  const insert = `\`\`\`mermaid\n${body}\n\`\`\``;
  return result(context, insert, "```mermaid\n".length);
};

const applyDelimitedInline = (
  delimiter: "**" | "*" | "~~" | "`",
  context: SlashApplyContext
): SlashApplyResult => {
  const source = context.preservedSelection.replace(/\r\n?/gu, "\n");
  if (source.length === 0) {
    const insert = `${delimiter}${delimiter}`;
    return result(context, insert, delimiter.length);
  }
  const insert = `${delimiter}${source}${delimiter}`;
  return result(context, insert, insert.length);
};

const applyLink = (context: SlashApplyContext): SlashApplyResult => {
  const label = firstNonEmptyLine(context.preservedSelection) || "Link text";
  const insert = `[${label}](https://)`;
  const cursor = context.preservedSelection.trim().length > 0
    ? insert.length - 1
    : 1;
  return result(context, insert, cursor);
};

const applyImage = (context: SlashApplyContext): SlashApplyResult => {
  const alt = firstNonEmptyLine(context.preservedSelection) || "Alt text";
  const insert = `![${alt}](image.png)`;
  return result(context, insert, context.preservedSelection.trim().length > 0 ? insert.length : 2);
};

const applyRemoteImage = (context: SlashApplyContext): SlashApplyResult => {
  const alt = firstNonEmptyLine(context.preservedSelection) || "Alt text";
  const insert = `![${alt}](https://)`;
  return result(context, insert, insert.indexOf("https://") + "https://".length);
};

const applyCallout = (
  context: SlashApplyContext,
  kind: "NOTE" | "TIP" | "WARNING" = "NOTE"
): SlashApplyResult => {
  const source = context.preservedSelection.trim();
  if (!source) {
    const insert = `> [!${kind}]\n> `;
    return result(context, insert, insert.length);
  }
  const body = normalizeLines(source).map((line) => `> ${stripBlockPrefix(line)}`).join("\n");
  const insert = `> [!${kind}]\n${body}`;
  return result(context, insert, insert.length);
};

const applyFootnote = (context: SlashApplyContext): SlashApplyResult => {
  const source = context.preservedSelection.trim();
  const insert = source ? `[^1]\n\n[^1]: ${source}` : "[^1]\n\n[^1]: ";
  return result(context, insert, insert.length);
};

const applyDetails = (context: SlashApplyContext): SlashApplyResult => {
  const body = context.preservedSelection.trim() || "Details";
  const insert = `<details>\n<summary>Title</summary>\n\n${body}\n</details>`;
  const cursor = context.preservedSelection.trim().length > 0
    ? insert.length
    : insert.indexOf("Title");
  return result(context, insert, cursor);
};

const tableCell = (value: string): string => value.trim().replace(/\\/gu, "\\\\");

const splitTableRow = (line: string): string[] => {
  const trimmed = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  const cells = trimmed.includes("|") ? trimmed.split("|") : trimmed.split("\t");
  return cells.map(tableCell);
};

const formatTableRow = (cells: string[], columnCount: number): string => {
  const padded = Array.from({ length: columnCount }, (_, index) => cells[index] ?? "");
  return `| ${padded.join(" | ")} |`;
};

const applyTable = (context: SlashApplyContext): SlashApplyResult => {
  const sourceLines = normalizeLines(context.preservedSelection).filter((line) => line.trim().length > 0);

  if (sourceLines.length === 0) {
    const insert = "| Column 1 | Column 2 |\n| --- | --- |\n|  |  |";
    const firstCell = insert.lastIndexOf("|  |  |") + 2;
    return result(context, insert, firstCell);
  }

  const rows = sourceLines.map(splitTableRow);
  const hasExplicitColumns = rows.some((row) => row.length > 1);
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const header = hasExplicitColumns ? rows[0] : ["Column"];
  const body = hasExplicitColumns ? rows.slice(1) : rows;
  const separator = Array.from({ length: columnCount }, () => "---");
  const lines = [formatTableRow(header, columnCount), formatTableRow(separator, columnCount)];
  lines.push(...body.map((row) => formatTableRow(row, columnCount)));

  const insert = lines.join("\n");
  return result(context, insert, insert.length);
};

const applyInlineMark = (delimiter: "==" | "++", context: SlashApplyContext): SlashApplyResult => {
  const source = context.preservedSelection.replace(/\r\n?/gu, "\n");
  if (source.length === 0) {
    const insert = `${delimiter}${delimiter}`;
    return result(context, insert, delimiter.length);
  }

  const insert = source
    .split("\n")
    .map((line) => (line.length > 0 ? `${delimiter}${line}${delimiter}` : ""))
    .join("\n");
  return result(context, insert, insert.length);
};

const applyDivider = (context: SlashApplyContext): SlashApplyResult => {
  const before = context.slashFrom > 0 ? context.document.slice(context.slashFrom - 1, context.slashFrom) : "";
  const after = context.slashTo < context.document.length ? context.document.slice(context.slashTo, context.slashTo + 1) : "";

  const leadingNewline = before && before !== "\n" ? "\n" : "";
  const trailingNewline = after && after !== "\n" ? "\n" : "";
  const insert = `${leadingNewline}---${trailingNewline}`;
  return result(context, insert, insert.length);
};

export const filterSlashCommands = (query: string): SlashCommand[] => {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    const defaultIds: SlashCommandId[] = [
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
    ];
    return defaultIds.flatMap((id) => {
      const command = SLASH_COMMANDS.find((item) => item.id === id);
      return command ? [command] : [];
    });
  }
  return SLASH_COMMANDS.map((command, index) => ({
    command,
    index,
    score: scoreCommand(command, normalizedQuery)
  }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (left.score === right.score) {
        return left.index - right.index;
      }
      return right.score - left.score;
    })
    .map((entry) => entry.command);
};

export const applySlashCommand = (
  commandId: SlashCommandId,
  context: SlashApplyContext
): SlashApplyResult => {
  switch (commandId) {
    case "title":
      return applyHeading("# ", context);
    case "subtitle":
      return applyHeading("## ", context);
    case "heading-3":
      return applyHeading("### ", context);
    case "paragraph":
      return applyParagraph(context);
    case "bullet-list":
      return applyBulletList(context);
    case "numbered-list":
      return applyNumberedList(context);
    case "checklist":
      return applyChecklist(context);
    case "quote":
      return applyQuote(context);
    case "code-block":
      return applyCodeBlock(context);
    case "inline-code":
      return applyDelimitedInline("`", context);
    case "diagram":
      return applyDiagram(context);
    case "table":
      return applyTable(context);
    case "image":
      return applyImage(context);
    case "image-url":
      return applyRemoteImage(context);
    case "link":
      return applyLink(context);
    case "bold":
      return applyDelimitedInline("**", context);
    case "italic":
      return applyDelimitedInline("*", context);
    case "strikethrough":
      return applyDelimitedInline("~~", context);
    case "callout":
      return applyCallout(context);
    case "tip":
      return applyCallout(context, "TIP");
    case "warning":
      return applyCallout(context, "WARNING");
    case "footnote":
      return applyFootnote(context);
    case "details":
      return applyDetails(context);
    case "highlight":
      return applyInlineMark("==", context);
    case "underline":
      return applyInlineMark("++", context);
    case "divider":
      return applyDivider(context);
    default:
      return result(context, "", 0);
  }
};
