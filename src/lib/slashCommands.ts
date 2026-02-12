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
  | "divider";

export interface SlashCommand {
  id: SlashCommandId;
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
    title: "Title",
    subtitle: "# Heading 1",
    keywords: ["h1", "heading", "title", "header"]
  },
  {
    id: "subtitle",
    title: "Subtitle",
    subtitle: "## Heading 2",
    keywords: ["h2", "heading", "subtitle", "subheading"]
  },
  {
    id: "heading-3",
    title: "Heading 3",
    subtitle: "### Heading 3",
    keywords: ["h3", "heading", "subsection"]
  },
  {
    id: "paragraph",
    title: "Paragraph",
    subtitle: "Plain text block",
    keywords: ["paragraph", "text", "plain"]
  },
  {
    id: "bullet-list",
    title: "Bullet list",
    subtitle: "- Item",
    keywords: ["bullet", "unordered", "list", "ul"]
  },
  {
    id: "numbered-list",
    title: "Numbered list",
    subtitle: "1. Item",
    keywords: ["numbered", "ordered", "list", "ol"]
  },
  {
    id: "checklist",
    title: "Checklist",
    subtitle: "- [ ] Task",
    keywords: ["task", "todo", "checkbox", "checklist"]
  },
  {
    id: "quote",
    title: "Quote",
    subtitle: "> Quote",
    keywords: ["quote", "blockquote", "citation"]
  },
  {
    id: "code-block",
    title: "Code block",
    subtitle: "``` fenced code ```",
    keywords: ["code", "snippet", "fence", "pre"]
  },
  {
    id: "divider",
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
    case "divider":
      return applyDivider(context);
    default:
      return result(context, "", 0);
  }
};
