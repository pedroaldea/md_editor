import { useCallback, useEffect, useRef, useState } from "react";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, placeholder } from "@codemirror/view";
import { basicSetup } from "codemirror";
import {
  applySlashCommand,
  filterSlashCommands,
  type SlashCommand,
  type SlashCommandId
} from "../lib/slashCommands";
import SlashMenu from "./SlashMenu";

interface EditorPaneProps {
  value: string;
  targetScrollRatio: number | null;
  targetCursorLine: number | null;
  insertTextRequest: { id: number; text: string } | null;
  onChange: (value: string) => void;
  onCursorLineChange: (lineNumber: number) => void;
  onScrollRatioChange: (ratio: number) => void;
  onClipboardImagePaste: (payload: {
    fileName: string;
    mimeType: string;
    base64Data: string;
  }) => Promise<string | null>;
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

const SLASH_MENU_WIDTH = 280;
const SLASH_MENU_VERTICAL_PADDING = 8;

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

const editorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      fontSize: "15px"
    },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      lineHeight: "1.6",
      padding: "20px clamp(14px, 3vw, 48px)"
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
    dark: false
  }
);

export default function EditorPane({
  value,
  targetScrollRatio,
  targetCursorLine,
  insertTextRequest,
  onChange,
  onCursorLineChange,
  onScrollRatioChange,
  onClipboardImagePaste
}: EditorPaneProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
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
  const [slashMenu, setSlashMenu] = useState<SlashSession | null>(null);

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
    (forcedCommandId?: SlashCommandId): void => {
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
      const estimatedHeight = Math.min(360, Math.max(56, itemCount * 46 + 12));

      let left = coordinates.left - shellRect.left;
      let top = coordinates.bottom - shellRect.top + 6;

      if (left + SLASH_MENU_WIDTH > shellRect.width - 8) {
        left = shellRect.width - SLASH_MENU_WIDTH - 8;
      }
      left = Math.max(8, left);

      if (top + estimatedHeight > shellRect.height - 8) {
        const aboveTop = coordinates.top - shellRect.top - estimatedHeight - 6;
        top = Math.max(SLASH_MENU_VERTICAL_PADDING, aboveTop);
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

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !applyingExternalContentRef.current) {
        onChangeRef.current(update.state.doc.toString());
      }

      if (update.docChanged || update.selectionSet) {
        const line = update.state.doc.lineAt(update.state.selection.main.head).number;
        onCursorLineChangeRef.current(line);
        syncSlashSession(update.view);
      }
    });

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          markdown(),
          placeholder("Write Markdown here..."),
          EditorView.lineWrapping,
          editorTheme,
          updateListener
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
    };

    view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });

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
        applySlashSelection();
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
    onCursorLineChangeRef.current(1);

    return () => {
      view.scrollDOM.removeEventListener("scroll", onScroll);
      view.contentDOM.removeEventListener("paste", onPaste);
      view.contentDOM.removeEventListener("keydown", onKeyDown, true);
      view.destroy();
      viewRef.current = null;
      closeSlashMenu();
    };
  }, []);

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
    <div className="editor-pane" ref={shellRef}>
      <div className="editor-pane-host" ref={containerRef} />
      <SlashMenu
        open={slashMenu !== null}
        left={slashMenu?.left ?? 0}
        top={slashMenu?.top ?? 0}
        items={slashMenu?.items ?? []}
        activeIndex={slashMenu?.activeIndex ?? 0}
        onSelect={(commandId) => applySlashSelection(commandId)}
        onHoverIndex={setSlashActiveIndex}
      />
    </div>
  );
}
