import type { CSSProperties } from "react";
import type { SlashCommand } from "../lib/slashCommands";

interface SlashMenuProps {
  open: boolean;
  left: number;
  top: number;
  items: SlashCommand[];
  activeIndex: number;
  onSelect: (commandId: SlashCommand["id"]) => void;
  onHoverIndex: (index: number) => void;
}

export default function SlashMenu({
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

  return (
    <div className="slash-menu" style={{ left, top } as CSSProperties} role="listbox" aria-label="Slash commands">
      {items.length === 0 ? (
        <p className="slash-menu-empty">No matches</p>
      ) : (
        items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            className={`slash-menu-item${index === activeIndex ? " is-active" : ""}`}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onHoverIndex(index)}
            onClick={() => onSelect(item.id)}
          >
            <span className="slash-menu-title">{item.title}</span>
            <span className="slash-menu-subtitle">{item.subtitle}</span>
          </button>
        ))
      )}
    </div>
  );
}
