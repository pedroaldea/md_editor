import type { ThemeMode } from "../types/app";

let diagramSequence = 0;
let mermaidRenderQueue: Promise<void> = Promise.resolve();

export interface PreparedMermaidSource {
  source: string;
  dottedLinkIndexes: number[];
}

// Flowcharts accept more links than the common arrow form: open (`---`),
// thick (`===`), dotted (`-.-`), circle/cross, bidirectional and invisible.
// Count the operator, not only its arrowhead, so a valid edge declared before
// a WebKit-safe feedback rewrite cannot shift the restored dotted style.
const mermaidLinkPattern =
  /~~~|(?:[ox<])?(?:-{2,}[ox>]|={2,}>|-[.]+-[ox>]?|\.{1,}-[ox>])|-{3,}|={3,}/gu;

const maskMermaidLabelsAndComments = (line: string): string => {
  const masked = [...line];
  const closingStack: string[] = [];
  let quote: string | null = null;
  let pipeLabel = false;
  let escaped = false;

  const hide = (index: number): void => {
    masked[index] = " ";
  };

  for (let index = 0; index < masked.length; index += 1) {
    const character = line[index] ?? "";
    const next = line[index + 1] ?? "";

    if (!quote && !pipeLabel && closingStack.length === 0 && character === "%" && next === "%") {
      for (let rest = index; rest < masked.length; rest += 1) hide(rest);
      break;
    }

    if (quote) {
      hide(index);
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (pipeLabel) {
      hide(index);
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "|") {
        pipeLabel = false;
      }
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      hide(index);
      continue;
    }

    if (character === "|") {
      pipeLabel = true;
      hide(index);
      continue;
    }

    const closing = closingStack.at(-1);
    if (closing) {
      hide(index);
      if (character === "[" || character === "(" || character === "{") {
        closingStack.push(character === "[" ? "]" : character === "(" ? ")" : "}");
      } else if (character === closing) {
        closingStack.pop();
      }
      continue;
    }

    if (character === "[" || character === "(" || character === "{") {
      closingStack.push(character === "[" ? "]" : character === "(" ? ")" : "}");
      hide(index);
      continue;
    }

    // Legacy asymmetric nodes use `A>label]`. Do not confuse their opening
    // bracket with an arrowhead from a link operator.
    if (character === ">" && !/[\-=.]|\s/u.test(line[index - 1] ?? "")) {
      closingStack.push("]");
      hide(index);
    }
  }

  return masked.join("");
};

const findMermaidLinks = (line: string): RegExpMatchArray[] => [
  ...maskMermaidLabelsAndComments(line).matchAll(mermaidLinkPattern)
];

export const prepareMermaidSource = (source: string): PreparedMermaidSource => {
  const dottedLinkIndexes: number[] = [];
  let linkIndex = 0;
  const normalizedLines = source.replace(/\\n/gu, " ").split("\n").map((line) => {
    const labelledDottedPattern = /\s+-\.\s+(.+?)\s+\.->\s+/gu;
    const dottedMatches = [...line.matchAll(labelledDottedPattern)];
    const links = findMermaidLinks(line);

    dottedMatches.forEach((match) => {
      const precedingLinksOnLine = links.filter(
        (link) => (link.index ?? 0) < (match.index ?? 0)
      ).length;
      dottedLinkIndexes.push(linkIndex + precedingLinksOnLine);
    });
    linkIndex += links.length;

    // WKWebView can freeze while laying out a labelled dotted feedback edge.
    // Lay it out as a solid edge, then restore its dotted visual with linkStyle.
    return line.replace(labelledDottedPattern, " -- $1 --> ");
  });

  return {
    source: normalizedLines.join("\n").trim(),
    dottedLinkIndexes
  };
};

export const normalizeMermaidSource = (source: string): string =>
  prepareMermaidSource(source).source;

const showDiagramError = (diagram: HTMLElement, canvas: HTMLElement, messageText: string): void => {
  diagram.classList.add("is-error");
  canvas.setAttribute("aria-busy", "false");
  const message = window.document.createElement("p");
  message.className = "mermaid-error";
  message.setAttribute("role", "alert");
  message.textContent = messageText;
  canvas.replaceChildren(message);
};

const renderDiagrams = async (
  root: HTMLElement,
  themeMode: ThemeMode,
  signal?: AbortSignal
): Promise<void> => {
  const diagrams = [
    ...(root.matches(".mermaid-diagram") ? [root] : []),
    ...root.querySelectorAll<HTMLElement>(".mermaid-diagram")
  ];
  if (diagrams.length === 0 || signal?.aborted) return;

  let mermaid: (typeof import("mermaid"))["default"];
  try {
    ({ default: mermaid } = await import("mermaid"));
    if (signal?.aborted) return;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: themeMode === "dark" ? "dark" : "neutral",
      fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      flowchart: { htmlLabels: false, curve: "linear" }
    });
  } catch {
    diagrams.forEach((diagram) => {
      const canvas = diagram.querySelector<HTMLElement>(".mermaid-canvas");
      if (canvas) showDiagramError(diagram, canvas, "Diagram engine could not be loaded.");
    });
    return;
  }

  for (const diagram of diagrams) {
    if (signal?.aborted) return;
    const rawSource = diagram.querySelector<HTMLElement>(".mermaid-source")?.textContent;
    const canvas = diagram.querySelector<HTMLElement>(".mermaid-canvas");
    if (!rawSource || !canvas) continue;
    const preparedSource = prepareMermaidSource(rawSource);

    canvas.replaceChildren();
    canvas.setAttribute("aria-busy", "true");
    diagram.classList.remove("is-error");

    try {
      diagramSequence += 1;
      let timeoutId = 0;
      const renderTimeout = new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error("Mermaid render timed out")), 10_000);
      });
      const { svg, bindFunctions } = await Promise.race([
        mermaid.render(`md-editor-mermaid-${diagramSequence}`, preparedSource.source, canvas),
        renderTimeout
      ]).finally(() => window.clearTimeout(timeoutId));
      if (signal?.aborted) return;
      canvas.innerHTML = svg;
      const edgePaths = canvas.querySelectorAll<SVGPathElement>(".edgePaths .flowchart-link");
      preparedSource.dottedLinkIndexes.forEach((index) => {
        const edgePath = edgePaths.item(index);
        if (!edgePath) return;
        edgePath.style.strokeDasharray = "4 3";
        edgePath.dataset.mdDottedFeedback = "true";
      });
      canvas.setAttribute("aria-busy", "false");
      diagram.dataset.mermaidRenderState = "ready";
      bindFunctions?.(canvas);
    } catch {
      if (signal?.aborted) return;
      showDiagramError(
        diagram,
        canvas,
        "Diagram could not be rendered. Check its Mermaid syntax in Edit mode."
      );
      diagram.dataset.mermaidRenderState = "error";
    }
  }
};

export const renderMermaidDiagrams = (
  root: HTMLElement,
  themeMode: ThemeMode,
  signal?: AbortSignal
): Promise<void> => {
  // Mermaid keeps shared renderer configuration. Preview lazy-rendering and a
  // user-triggered PDF export can otherwise initialize/render concurrently,
  // leaving one of the SVGs empty in the print snapshot. Serialize requests;
  // each caller still receives its own completion promise.
  const request = mermaidRenderQueue.then(() => renderDiagrams(root, themeMode, signal));
  mermaidRenderQueue = request.catch(() => undefined);
  return request;
};
