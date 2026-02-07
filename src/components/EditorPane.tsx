import { useEffect, useRef } from "react";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, placeholder } from "@codemirror/view";
import { basicSetup } from "codemirror";

interface EditorPaneProps {
  value: string;
  targetScrollRatio: number | null;
  onChange: (value: string) => void;
  onCursorLineChange: (lineNumber: number) => void;
  onScrollRatioChange: (ratio: number) => void;
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
  onChange,
  onCursorLineChange,
  onScrollRatioChange
}: EditorPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const applyingExternalContentRef = useRef(false);
  const applyingExternalScrollRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || viewRef.current) {
      return;
    }

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !applyingExternalContentRef.current) {
        onChange(update.state.doc.toString());
      }

      if (update.docChanged || update.selectionSet) {
        const line = update.state.doc.lineAt(update.state.selection.main.head).number;
        onCursorLineChange(line);
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
      onScrollRatioChange(ratio);
    };

    view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    viewRef.current = view;
    onCursorLineChange(1);

    return () => {
      view.scrollDOM.removeEventListener("scroll", onScroll);
      view.destroy();
      viewRef.current = null;
    };
  }, [onChange, onCursorLineChange, onScrollRatioChange, value]);

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

  return <div className="editor-pane" ref={containerRef} />;
}
