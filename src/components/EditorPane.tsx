import { useCallback, useEffect, useId, useRef, useState } from "react";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  placeholder,
  lineNumbers,
  highlightActiveLineGutter,
  highlightActiveLine,
  drawSelection,
  dropCursor,
  keymap
} from "@codemirror/view";
import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
import { bracketMatching, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  applySlashCommand,
  filterSlashCommands,
  type SlashCommand,
  type SlashCommandId
} from "../lib/slashCommands";
import {
  editMarkdownTable,
  getMarkdownTableContext,
  moveMarkdownTableCursor,
  type MarkdownTableContext,
  type TableEditAction,
  type TableMoveDirection
} from "../lib/tableEditor";
import type { EditorSettings, ThemeMode } from "../types/app";
import SlashMenu from "./SlashMenu";
import TableToolbar from "./TableToolbar";

interface EditorPaneProps {
  value: string;
  targetScrollRatio: number | null;
  targetCursorLine: number | null;
  insertTextRequest: { id: number; text: string } | null;
  onChange: (value: string) => void;
  onCursorLineChange: (lineNumber: number, columnNumber?: number) => void;
  onScrollRatioChange: (ratio: number) => void;
  onClipboardImagePaste: (payload: {
    fileName: string;
    mimeType: string;
    base64Data: string;
  }) => Promise<string | null>;
  onImageRequest: (suggestedAlt?: string) => Promise<string | null>;
  settings: EditorSettings;
  themeMode: ThemeMode;
}

interface SlashSelectionSnapshot {
  from: number;
  to: number;
  text: string;
}

interface SlashToken {
  from: number;
  to: number;
  query: string;
}

interface SlashSession {
  from: number;
  to: number;
  query: string;
  items: SlashCommand[];
  activeIndex: number;
  left: number;
  top: number;
  preTriggerSelection: SlashSelectionSnapshot;
}

interface SelectionToolbarState {
  left: number;
  top: number;
}

interface TableToolbarState extends MarkdownTableContext {
  left: number;
  top: number;
}

const lineNumbersComp = new Compartment();
const wordWrapComp = new Compartment();
const activeLineComp = new Compartment();
const themeComp = new Compartment();

const SLASH_MENU_WIDTH = 370;
const SLASH_MENU_VERTICAL_PADDING = 8;

const wrapSelection = (view: EditorView, marker: "==" | "++"): boolean => {
  const selection = view.state.selection.main;
  if (selection.empty) return false;
  const selected = view.state.sliceDoc(selection.from, selection.to);
  const alreadyWrapped = selected.startsWith(marker) && selected.endsWith(marker);
  const nextText = alreadyWrapped
    ? selected.slice(marker.length, -marker.length)
    : `${marker}${selected}${marker}`;
  const from = alreadyWrapped ? selection.from : selection.from;
  const to = alreadyWrapped ? selection.to : selection.to;
  view.dispatch({
    changes: { from, to, insert: nextText },
    selection: { anchor: from, head: from + nextText.length },
    scrollIntoView: true
  });
  view.focus();
  return true;
};

const detectSlashToken = (view: EditorView): SlashToken | null => {
  const selection = view.state.selection.main;
  if (!selection.empty) {
    return null;
  }

  const line = view.state.doc.lineAt(selection.head);
  const textBeforeCursor = view.state.doc.sliceString(line.from, selection.head);
  const slashIndex = textBeforeCursor.lastIndexOf("/");
  if (slashIndex < 0) {
    return null;
  }

  if (slashIndex > 0 && !/\s/u.test(textBeforeCursor.charAt(slashIndex - 1))) {
    return null;
  }

  const query = textBeforeCursor.slice(slashIndex + 1);
  if (!/^[a-z0-9-]*$/iu.test(query)) {
    return null;
  }

  return {
    from: line.from + slashIndex,
    to: selection.head,
    query
  };
};

const createEditorTheme = (themeMode: ThemeMode) => EditorView.theme(
  {
    "&": {
      height: "100%",
      fontSize: "var(--editor-font-size, 16px)"
    },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      lineHeight: "1.7",
      padding: "24px clamp(16px, 3vw, 52px)"
    },
    ".cm-content": {
      width: "100%",
      maxWidth: "72ch",
      margin: "0 auto"
    },
    ".cm-line": {
      overflowWrap: "anywhere"
    },
    ".cm-focused": {
      outline: "none"
    }
  },
  {
    dark: themeMode === "dark"
  }
);

const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: "var(--text-primary)", fontWeight: "650" },
  { tag: [tags.link, tags.url], color: "var(--accent-strong)", textDecoration: "underline" },
  { tag: [tags.meta, tags.punctuation, tags.processingInstruction], color: "var(--text-muted)" },
  { tag: tags.strong, color: "var(--text-primary)", fontWeight: "700" },
  { tag: tags.emphasis, color: "var(--text-secondary)", fontStyle: "italic" },
  { tag: tags.monospace, color: "var(--accent-strong)" }
]);

export default function EditorPane({
  value,
  targetScrollRatio,
  targetCursorLine,
  insertTextRequest,
  onChange,
  onCursorLineChange,
  onScrollRatioChange,
  onClipboardImagePaste,
  onImageRequest,
  settings,
  themeMode
}: EditorPaneProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const slashMenuId = useId();
  const slashStatusId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const applyingExternalContentRef = useRef(false);
  const applyingExternalScrollRef = useRef(false);
  const pendingSlashTriggerRef = useRef<SlashSelectionSnapshot | null>(null);
  const slashSessionRef = useRef<SlashSession | null>(null);
  const lastInsertRequestIdRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  const onCursorLineChangeRef = useRef(onCursorLineChange);
  const onScrollRatioChangeRef = useRef(onScrollRatioChange);
  const onClipboardImagePasteRef = useRef(onClipboardImagePaste);
  const onImageRequestRef = useRef(onImageRequest);
  const tableActionRef = useRef<((action: TableEditAction) => void) | null>(null);
  const tableNavigateRef = useRef<((direction: TableMoveDirection) => void) | null>(null);
  const dismissedTableCursorRef = useRef<number | null>(null);
  const [slashMenu, setSlashMenu] = useState<SlashSession | null>(null);
  const [selectionToolbar, setSelectionToolbar] = useState<SelectionToolbarState | null>(null);
  const [tableToolbar, setTableToolbar] = useState<TableToolbarState | null>(null);

  const setSlashSession = useCallback((session: SlashSession | null): void => {
    slashSessionRef.current = session;
    setSlashMenu(session);
  }, []);

  const closeSlashMenu = useCallback((): void => {
    pendingSlashTriggerRef.current = null;
    if (!slashSessionRef.current) {
      return;
    }
    setSlashSession(null);
  }, [setSlashSession]);

  const setSlashActiveIndex = useCallback(
    (index: number): void => {
      const session = slashSessionRef.current;
      if (!session || session.items.length === 0) {
        return;
      }
      const normalized =
        ((index % session.items.length) + session.items.length) % session.items.length;
      if (normalized === session.activeIndex) {
        return;
      }
      setSlashSession({
        ...session,
        activeIndex: normalized
      });
    },
    [setSlashSession]
  );

  const applySlashSelection = useCallback(
    async (forcedCommandId?: SlashCommandId): Promise<void> => {
      const view = viewRef.current;
      const session = slashSessionRef.current;
      if (!view || !session) {
        return;
      }

      const command = forcedCommandId
        ? session.items.find((item) => item.id === forcedCommandId)
        : session.items[session.activeIndex];

      if (!command) {
        closeSlashMenu();
        return;
      }

      if (command.id === "image") {
        const insertionPoint = session.from;
        const suggestedAlt = session.preTriggerSelection.text.trim();
        view.dispatch({
          changes: { from: session.from, to: session.to, insert: "" },
          selection: { anchor: insertionPoint }
        });
        closeSlashMenu();
        const snippet = await onImageRequestRef.current(suggestedAlt || undefined);
        const currentView = viewRef.current;
        if (snippet && currentView) {
          const safePoint = Math.min(insertionPoint, currentView.state.doc.length);
          currentView.dispatch({
            changes: { from: safePoint, to: safePoint, insert: snippet },
            selection: { anchor: safePoint + snippet.length },
            scrollIntoView: true
          });
        }
        currentView?.focus();
        return;
      }

      const applied = applySlashCommand(command.id, {
        document: view.state.doc.toString(),
        slashFrom: session.from,
        slashTo: session.to,
        preservedSelection: session.preTriggerSelection.text
      });

      view.dispatch({
        changes: {
          from: applied.from,
          to: applied.to,
          insert: applied.insert
        },
        selection: {
          anchor: applied.cursor
        },
        scrollIntoView: true
      });
      closeSlashMenu();
      view.focus();
    },
    [closeSlashMenu]
  );

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onCursorLineChangeRef.current = onCursorLineChange;
  }, [onCursorLineChange]);

  useEffect(() => {
    onScrollRatioChangeRef.current = onScrollRatioChange;
  }, [onScrollRatioChange]);

  useEffect(() => {
    onClipboardImagePasteRef.current = onClipboardImagePaste;
  }, [onClipboardImagePaste]);

  useEffect(() => {
    onImageRequestRef.current = onImageRequest;
  }, [onImageRequest]);

  useEffect(() => {
    if (!containerRef.current || viewRef.current) {
      return;
    }

    const getMenuPosition = (view: EditorView, tokenFrom: number, itemCount: number): { left: number; top: number } => {
      const shell = shellRef.current;
      const coordinates = view.coordsAtPos(tokenFrom);
      if (!shell || !coordinates) {
        return { left: 12, top: 12 };
      }

      const shellRect = shell.getBoundingClientRect();
      const compactRows = shellRect.width >= 430;
      const estimatedHeight = Math.min(360, Math.max(80, itemCount * (compactRows ? 28 : 50) + 42));
      const menuWidth = Math.min(SLASH_MENU_WIDTH, Math.max(0, shellRect.width - 16));

      let left = coordinates.left - shellRect.left;
      let top = coordinates.bottom - shellRect.top + 6;

      if (left + menuWidth > shellRect.width - 8) {
        left = shellRect.width - menuWidth - 8;
      }
      left = Math.max(8, left);

      if (top + estimatedHeight > shellRect.height - 8) {
        top = Math.max(SLASH_MENU_VERTICAL_PADDING, shellRect.height - estimatedHeight - 8);
      }

      return {
        left,
        top: Math.max(SLASH_MENU_VERTICAL_PADDING, top)
      };
    };

    const syncSlashSession = (view: EditorView): void => {
      const token = detectSlashToken(view);
      if (!token) {
        closeSlashMenu();
        return;
      }

      const previous = slashSessionRef.current;
      let preTriggerSelection =
        previous && previous.from === token.from ? previous.preTriggerSelection : null;

      const pendingTrigger = pendingSlashTriggerRef.current;
      if (!preTriggerSelection && pendingTrigger && pendingTrigger.from === token.from) {
        preTriggerSelection = pendingTrigger;
      }

      if (!preTriggerSelection) {
        preTriggerSelection = {
          from: token.from,
          to: token.from,
          text: ""
        };
      }

      const items = filterSlashCommands(token.query);
      const nextActiveIndex =
        previous && previous.from === token.from && items.length > 0
          ? Math.min(previous.activeIndex, items.length - 1)
          : 0;

      const position = getMenuPosition(view, token.from, items.length);
      pendingSlashTriggerRef.current = null;
      setSlashSession({
        from: token.from,
        to: token.to,
        query: token.query,
        items,
        activeIndex: nextActiveIndex,
        left: position.left,
        top: position.top,
        preTriggerSelection
      });
    };

    const syncSelectionToolbar = (view: EditorView): void => {
      const selection = view.state.selection.main;
      const shell = shellRef.current;
      if (selection.empty || !shell) {
        setSelectionToolbar(null);
        return;
      }

      const coordinates = view.coordsAtPos(selection.from);
      if (!coordinates) {
        setSelectionToolbar(null);
        return;
      }

      const shellRect = shell.getBoundingClientRect();
      const toolbarWidth = Math.min(176, Math.max(0, shellRect.width - 16));
      const left = Math.max(
        8,
        Math.min(shellRect.width - toolbarWidth - 8, coordinates.left - shellRect.left)
      );
      const top = Math.max(8, coordinates.top - shellRect.top - 42);
      setSelectionToolbar({ left, top });
    };

    const syncTableToolbar = (view: EditorView): void => {
      const selection = view.state.selection.main;
      const shell = shellRef.current;
      if (!selection.empty || !shell) {
        setTableToolbar(null);
        return;
      }
      if (
        dismissedTableCursorRef.current !== null &&
        dismissedTableCursorRef.current !== selection.head
      ) {
        dismissedTableCursorRef.current = null;
      }
      const context = getMarkdownTableContext(view.state.doc.toString(), selection.head);
      const coordinates = view.coordsAtPos(selection.head);
      if (
        !context ||
        !coordinates ||
        dismissedTableCursorRef.current === selection.head
      ) {
        setTableToolbar(null);
        return;
      }
      const shellRect = shell.getBoundingClientRect();
      const toolbarWidth = Math.min(560, Math.max(0, shellRect.width - 16));
      const left = Math.max(
        8,
        Math.min(shellRect.width - toolbarWidth - 8, coordinates.left - shellRect.left)
      );
      const preferredTop = coordinates.top - shellRect.top - 46;
      const top = preferredTop >= 8
        ? preferredTop
        : Math.min(shellRect.height - 48, coordinates.bottom - shellRect.top + 6);
      setTableToolbar({ ...context, left, top });
    };

    const applyTableAction = (action: TableEditAction): void => {
      const currentView = viewRef.current;
      if (!currentView) return;
      const selection = currentView.state.selection.main;
      const edited = editMarkdownTable(
        currentView.state.doc.toString(),
        selection.head,
        action
      );
      if (!edited) return;
      currentView.dispatch({
        changes: { from: edited.from, to: edited.to, insert: edited.insert },
        selection: { anchor: edited.cursor },
        scrollIntoView: true
      });
      currentView.focus();
    };

    tableActionRef.current = applyTableAction;

    const navigateTable = (direction: TableMoveDirection): void => {
      const currentView = viewRef.current;
      if (!currentView) return;
      const cursor = moveMarkdownTableCursor(
        currentView.state.doc.toString(),
        currentView.state.selection.main.head,
        direction
      );
      if (cursor === null) return;
      dismissedTableCursorRef.current = null;
      currentView.dispatch({
        selection: { anchor: cursor },
        scrollIntoView: true
      });
      currentView.focus();
    };

    tableNavigateRef.current = navigateTable;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !applyingExternalContentRef.current) {
        onChangeRef.current(update.state.doc.toString());
      }

      if (update.docChanged || update.selectionSet) {
        const cursor = update.state.selection.main.head;
        const cursorLine = update.state.doc.lineAt(cursor);
        onCursorLineChangeRef.current(cursorLine.number, cursor - cursorLine.from + 1);
        syncSlashSession(update.view);
        syncSelectionToolbar(update.view);
        syncTableToolbar(update.view);
      }
    });

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          markdown(),
          placeholder("Write Markdown here..."),
          themeComp.of(createEditorTheme(themeMode)),
          updateListener,
          history(),
          drawSelection(),
          dropCursor(),
          syntaxHighlighting(markdownHighlightStyle, { fallback: true }),
          bracketMatching(),
          closeBrackets(),
          keymap.of([
            { key: "Mod-Shift-h", run: (view) => wrapSelection(view, "==") },
            { key: "Mod-Shift-u", run: (view) => wrapSelection(view, "++") },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap
          ]),
          lineNumbersComp.of(settings.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
          wordWrapComp.of(settings.wordWrap ? EditorView.lineWrapping : []),
          activeLineComp.of(settings.highlightActiveLine ? highlightActiveLine() : [])
        ]
      }),
      parent: containerRef.current
    });

    const onScroll = (): void => {
      if (applyingExternalScrollRef.current) {
        return;
      }
      const maxScrollable = view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight;
      const ratio = maxScrollable > 0 ? view.scrollDOM.scrollTop / maxScrollable : 0;
      onScrollRatioChangeRef.current(ratio);
      if (slashSessionRef.current) {
        syncSlashSession(view);
      }
      if (!view.state.selection.main.empty) {
        syncSelectionToolbar(view);
      }
      syncTableToolbar(view);
    };

    view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });

    let resizeFrame: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
      }
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        view.requestMeasure();
        if (slashSessionRef.current) {
          syncSlashSession(view);
        }
        if (!view.state.selection.main.empty) {
          syncSelectionToolbar(view);
        }
        syncTableToolbar(view);
      });
    });
    if (shellRef.current) {
      resizeObserver.observe(shellRef.current);
    }

    const toBase64 = async (file: File): Promise<string> => {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index]);
      }
      return btoa(binary);
    };

    const onPaste = (event: ClipboardEvent): void => {
      const clipboardItems = event.clipboardData?.items;
      if (!clipboardItems || clipboardItems.length === 0) {
        return;
      }

      const pastedPlainText = event.clipboardData?.getData("text/plain") ?? "";
      if (pastedPlainText.trim().length > 0) {
        return;
      }

      const imageItem = Array.from(clipboardItems).find((item) =>
        item.type.toLowerCase().startsWith("image/")
      );
      if (!imageItem) {
        return;
      }

      const file = imageItem.getAsFile();
      if (!file) {
        return;
      }

      event.preventDefault();
      void (async () => {
        const base64Data = await toBase64(file);
        const markdownSnippet = await onClipboardImagePasteRef.current({
          fileName: file.name || "clipboard-image.png",
          mimeType: file.type || "image/png",
          base64Data
        });

        if (!markdownSnippet || !viewRef.current) {
          return;
        }

        const currentSelection = viewRef.current.state.selection.main;
        viewRef.current.dispatch({
          changes: {
            from: currentSelection.from,
            to: currentSelection.to,
            insert: markdownSnippet
          },
          selection: { anchor: currentSelection.from + markdownSnippet.length }
        });
      })();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey) {
        return;
      }

      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const selection = view.state.selection.main;
        const line = view.state.doc.lineAt(selection.from);
        const characterBeforeSelection =
          selection.from > line.from ? view.state.doc.sliceString(selection.from - 1, selection.from) : "";
        const smartContext =
          selection.from === line.from || /\s/u.test(characterBeforeSelection);

        pendingSlashTriggerRef.current = smartContext
          ? {
              from: selection.from,
              to: selection.to,
              text: view.state.doc.sliceString(selection.from, selection.to)
            }
          : null;
      }

      const session = slashSessionRef.current;
      if (!session) {
        const selection = view.state.selection.main;
        const tableContext = selection.empty
          ? getMarkdownTableContext(view.state.doc.toString(), selection.head)
          : null;
        if (tableContext && event.key === "Tab") {
          event.preventDefault();
          navigateTable(event.shiftKey ? "previous" : "next");
          return;
        }
        if (tableContext && event.key === "Escape") {
          event.preventDefault();
          dismissedTableCursorRef.current = selection.head;
          setTableToolbar(null);
          view.focus();
        }
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashActiveIndex(session.activeIndex + 1);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashActiveIndex(session.activeIndex - 1);
        return;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        void applySlashSelection();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeSlashMenu();
      }
    };

    view.contentDOM.addEventListener("paste", onPaste);
    view.contentDOM.addEventListener("keydown", onKeyDown, true);
    viewRef.current = view;
    onCursorLineChangeRef.current(1, 1);
    window.requestAnimationFrame(() => syncTableToolbar(view));

    return () => {
      view.scrollDOM.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
      }
      view.contentDOM.removeEventListener("paste", onPaste);
      view.contentDOM.removeEventListener("keydown", onKeyDown, true);
      view.destroy();
      viewRef.current = null;
      tableActionRef.current = null;
      tableNavigateRef.current = null;
      closeSlashMenu();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: themeComp.reconfigure(createEditorTheme(themeMode)) });
  }, [themeMode]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({
      effects: [
        lineNumbersComp.reconfigure(settings.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
        wordWrapComp.reconfigure(settings.wordWrap ? EditorView.lineWrapping : []),
        activeLineComp.reconfigure(settings.highlightActiveLine ? highlightActiveLine() : [])
      ]
    });
  }, [settings.lineNumbers, settings.wordWrap, settings.highlightActiveLine]);

  useEffect(() => {
    const editor = viewRef.current?.contentDOM;
    if (!editor) return;

    editor.setAttribute("aria-haspopup", "listbox");
    editor.setAttribute("aria-expanded", slashMenu ? "true" : "false");
    if (slashMenu) {
      editor.setAttribute("aria-controls", slashMenuId);
      editor.setAttribute("aria-describedby", slashStatusId);
      const activeItem = slashMenu.items[slashMenu.activeIndex];
      if (activeItem) editor.setAttribute("aria-activedescendant", `slash-command-${activeItem.id}`);
      else editor.removeAttribute("aria-activedescendant");
    } else {
      editor.removeAttribute("aria-controls");
      editor.removeAttribute("aria-describedby");
      editor.removeAttribute("aria-activedescendant");
    }
  }, [slashMenu, slashMenuId, slashStatusId]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const current = view.state.doc.toString();
    if (current === value) {
      return;
    }

    applyingExternalContentRef.current = true;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value }
    });
    applyingExternalContentRef.current = false;
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || targetScrollRatio === null) {
      return;
    }

    applyingExternalScrollRef.current = true;
    const maxScrollable = view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight;
    view.scrollDOM.scrollTop = Math.max(0, maxScrollable * targetScrollRatio);
    requestAnimationFrame(() => {
      applyingExternalScrollRef.current = false;
    });
  }, [targetScrollRatio]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || targetCursorLine === null) {
      return;
    }

    const safeLine = Math.max(1, Math.min(targetCursorLine, view.state.doc.lines));
    const line = view.state.doc.line(safeLine);
    view.dispatch({
      selection: { anchor: line.from },
      scrollIntoView: true
    });
    view.focus();
  }, [targetCursorLine]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !insertTextRequest) {
      return;
    }

    if (lastInsertRequestIdRef.current === insertTextRequest.id) {
      return;
    }
    lastInsertRequestIdRef.current = insertTextRequest.id;

    const selection = view.state.selection.main;
    view.dispatch({
      changes: {
        from: selection.from,
        to: selection.to,
        insert: insertTextRequest.text
      },
      selection: {
        anchor: selection.from + insertTextRequest.text.length
      },
      scrollIntoView: true
    });
    view.focus();
  }, [insertTextRequest]);

  return (
    <div className="editor-pane" ref={shellRef} style={{ "--editor-font-size": `${settings.fontSize}px` } as React.CSSProperties}>
      <div className="editor-pane-host" ref={containerRef} />
      {selectionToolbar ? (
        <div
          className="selection-toolbar"
          role="toolbar"
          aria-label="Text annotation tools"
          style={{ left: selectionToolbar.left, top: selectionToolbar.top }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button
            type="button"
            aria-label="Highlight selection"
            onClick={() => {
              if (viewRef.current) {
                wrapSelection(viewRef.current, "==");
              }
              setSelectionToolbar(null);
            }}
          >
            Highlight
          </button>
          <button
            type="button"
            aria-label="Underline selection"
            onClick={() => {
              if (viewRef.current) {
                wrapSelection(viewRef.current, "++");
              }
              setSelectionToolbar(null);
            }}
          >
            Underline
          </button>
        </div>
      ) : null}
      {tableToolbar && !selectionToolbar && !slashMenu ? (
        <TableToolbar
          context={tableToolbar}
          left={tableToolbar.left}
          top={tableToolbar.top}
          onAction={(action) => tableActionRef.current?.(action)}
          onNavigate={(direction) => tableNavigateRef.current?.(direction)}
          onDone={() => {
            const view = viewRef.current;
            if (!view) return;
            dismissedTableCursorRef.current = view.state.selection.main.head;
            setTableToolbar(null);
            view.focus();
          }}
        />
      ) : null}
      <SlashMenu
        id={slashMenuId}
        open={slashMenu !== null}
        left={slashMenu?.left ?? 0}
        top={slashMenu?.top ?? 0}
        items={slashMenu?.items ?? []}
        activeIndex={slashMenu?.activeIndex ?? 0}
        onSelect={(commandId) => { void applySlashSelection(commandId); }}
        onHoverIndex={setSlashActiveIndex}
      />
      <div id={slashStatusId} className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {slashMenu
          ? slashMenu.items.length > 0
            ? `${slashMenu.items[slashMenu.activeIndex]?.title ?? "Command"}, ${slashMenu.activeIndex + 1} of ${slashMenu.items.length}. Use up and down arrows to navigate, Enter to insert, Escape to close.`
            : "No slash commands match."
          : ""}
      </div>
    </div>
  );
}
