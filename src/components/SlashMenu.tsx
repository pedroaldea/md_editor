import type { CSSProperties } from "react";
import type { SlashCommand } from "../lib/slashCommands";

interface SlashMenuProps {
  id: string;
  open: boolean;
  left: number;
  top: number;
  items: SlashCommand[];
  activeIndex: number;
  onSelect: (commandId: SlashCommand["id"]) => void;
  onHoverIndex: (index: number) => void;
}

export default function SlashMenu({
  id,
  open,
  left,
  top,
  items,
  activeIndex,
  onSelect,
  onHoverIndex
}: SlashMenuProps) {
  if (!open) {
    return null;
  }

  const activeItem = items[activeIndex];
  const activeOptionId = activeItem ? `slash-command-${activeItem.id}` : undefined;

  return (
    <div
      id={id}
      className="slash-menu"
      style={
        {
          left,
          top,
          width: "min(370px, calc(100% - 16px))",
          gridTemplateColumns: "minmax(0, 1fr)"
        } as CSSProperties
      }
      role="listbox"
      aria-label="Slash commands"
      aria-activedescendant={activeOptionId}
    >
      {items.length === 0 ? (
        <p className="slash-menu-empty">No matches</p>
      ) : (
        items.map((item, index) => (
          <button
            key={item.id}
            id={`slash-command-${item.id}`}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            aria-posinset={index + 1}
            aria-setsize={items.length}
            className={`slash-menu-item${index === activeIndex ? " is-active" : ""}`}
            onMouseDown={(event) => event.preventDefault()}
            onPointerMove={() => onHoverIndex(index)}
            onClick={() => onSelect(item.id)}
          >
            <span className="slash-menu-title">
              <span aria-hidden="true">[{item.mark}] </span>
              {item.title}{" "}
            </span>
            <span className="slash-menu-subtitle">{item.subtitle}</span>
          </button>
        ))
      )}
      <div className="slash-menu-hint" role="status" aria-live="polite">
        <span>{items.length} commands</span>
        <span aria-hidden="true">↑↓ navigate · ↵ insert · esc close</span>
      </div>
    </div>
  );
}
