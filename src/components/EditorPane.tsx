import { useEffect, useRef } from "react";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, placeholder } from "@codemirror/view";
import { basicSetup } from "codemirror";

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

const editorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      fontSize: "15px"
    },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      lineHeight: "1.6",
      padding: "20px 18px"
    },
    ".cm-content": {
      maxWidth: "78ch"
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const applyingExternalContentRef = useRef(false);
  const applyingExternalScrollRef = useRef(false);
  const lastInsertRequestIdRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  const onCursorLineChangeRef = useRef(onCursorLineChange);
  const onScrollRatioChangeRef = useRef(onScrollRatioChange);
  const onClipboardImagePasteRef = useRef(onClipboardImagePaste);

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

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !applyingExternalContentRef.current) {
        onChangeRef.current(update.state.doc.toString());
      }

      if (update.docChanged || update.selectionSet) {
        const line = update.state.doc.lineAt(update.state.selection.main.head).number;
        onCursorLineChangeRef.current(line);
      }
    });

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          markdown(),
          placeholder("Write Markdown here..."),
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

    view.contentDOM.addEventListener("paste", onPaste);
    viewRef.current = view;
    onCursorLineChangeRef.current(1);

    return () => {
      view.scrollDOM.removeEventListener("scroll", onScroll);
      view.contentDOM.removeEventListener("paste", onPaste);
      view.destroy();
      viewRef.current = null;
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

  return <div className="editor-pane" ref={containerRef} />;
}
