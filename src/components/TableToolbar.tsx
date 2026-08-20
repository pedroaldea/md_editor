import type {
  MarkdownTableContext,
  TableEditAction,
  TableMoveDirection
} from "../lib/tableEditor";

interface TableToolbarProps {
  context: MarkdownTableContext;
  left: number;
  top: number;
  onAction: (action: TableEditAction) => void;
  onNavigate: (direction: TableMoveDirection) => void;
  onDone: () => void;
}

const alignmentMark = (alignment: MarkdownTableContext["alignment"]): string => {
  if (alignment === "left") return "L";
  if (alignment === "center") return "C";
  if (alignment === "right") return "R";
  return "–";
};

export default function TableToolbar({
  context,
  left,
  top,
  onAction,
  onNavigate,
  onDone
}: TableToolbarProps) {
  const rowLabel = context.rowIndex === 0 ? "H" : String(Math.max(1, context.rowIndex - 1));
  const spokenRow = context.rowIndex === 0 ? "Header" : `Row ${Math.max(1, context.rowIndex - 1)}`;

  return (
    <div
      className="table-toolbar"
      role="toolbar"
      aria-label="Table editing tools"
      aria-describedby="table-toolbar-position"
      style={{ left, top }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <span
        id="table-toolbar-position"
        className="table-toolbar-position"
        aria-label={`${spokenRow}, column ${context.columnIndex + 1} of ${context.columnCount}`}
      >
        [{rowLabel}:{context.columnIndex + 1}]
      </span>
      <div className="table-toolbar-group table-toolbar-navigation" role="group" aria-label="Navigate table">
        <button
          type="button"
          aria-label="Previous cell"
          aria-keyshortcuts="Shift+Tab"
          title="Previous cell · Shift+Tab"
          onClick={() => onNavigate("previous")}
        >
          ←
        </button>
        <button
          type="button"
          aria-label="Next cell"
          aria-keyshortcuts="Tab"
          title="Next cell · Tab"
          onClick={() => onNavigate("next")}
        >
          →
        </button>
      </div>
      <div className="table-toolbar-group table-toolbar-structure" role="group" aria-label="Change table structure">
        <button type="button" title="Add row below" onClick={() => onAction("add-row")}>+ row</button>
        <button type="button" title="Add column to the right" onClick={() => onAction("add-column")}>+ col</button>
        <button type="button" title="Delete current row" disabled={!context.canDeleteRow} onClick={() => onAction("delete-row")}>− row</button>
        <button type="button" title="Delete current column" disabled={!context.canDeleteColumn} onClick={() => onAction("delete-column")}>− col</button>
      </div>
      <div className="table-toolbar-group table-toolbar-finish" role="group" aria-label="Format and finish">
        <button
          type="button"
          title={`Change column alignment · Current: ${context.alignment}`}
          onClick={() => onAction("cycle-alignment")}
        >
          align {alignmentMark(context.alignment)}
        </button>
        <button type="button" title="Tidy column spacing" onClick={() => onAction("format")}>tidy</button>
        <button
          type="button"
          className="table-toolbar-done"
          aria-keyshortcuts="Escape"
          title="Finish table editing · Escape"
          onClick={onDone}
        >
          done
        </button>
      </div>
    </div>
  );
}
