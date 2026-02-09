import { useEffect, useMemo, useRef, useState } from "react";
import type { CommandPaletteItem } from "../types/app";

interface CommandPaletteProps {
  open: boolean;
  items: CommandPaletteItem[];
  onClose: () => void;
}

const normalize = (value: string): string => value.toLowerCase().trim();

const scoreItem = (item: CommandPaletteItem, query: string): number => {
  if (!query) {
    return 1;
  }

  const haystack = `${item.title} ${item.subtitle ?? ""} ${item.keywords.join(" ")}`.toLowerCase();
  if (haystack.includes(query)) {
    if (item.title.toLowerCase().startsWith(query)) {
      return 100;
    }
    return 60;
  }

  let score = 0;
  let cursor = 0;
  for (const char of query) {
    const index = haystack.indexOf(char, cursor);
    if (index < 0) {
      return 0;
    }
    score += 1;
    cursor = index + 1;
  }
  return score;
};

export default function CommandPalette({ open, items, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const normalizedQuery = normalize(query);
    return items
      .map((item) => ({ item, score: scoreItem(item, normalizedQuery) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.item)
      .slice(0, 100);
  }, [items, query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      return;
    }

    setActiveIndex(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (filtered.length === 0 ? 0 : (current + 1) % filtered.length));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) =>
          filtered.length === 0 ? 0 : (current - 1 + filtered.length) % filtered.length
        );
        return;
      }

      if (event.key === "Enter") {
        const selected = filtered[activeIndex];
        if (!selected) {
          return;
        }
        event.preventDefault();
        void Promise.resolve(selected.run()).finally(() => {
          onClose();
        });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, filtered, onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="modal-card command-palette">
        <input
          ref={inputRef}
          className="command-palette-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type a command, file, or heading..."
          aria-label="Command palette query"
        />

        <div className="command-palette-list">
          {filtered.length === 0 ? (
            <p className="modal-empty">No matches</p>
          ) : (
            filtered.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`command-palette-item${index === activeIndex ? " is-active" : ""}`}
                onClick={() => {
                  void Promise.resolve(item.run()).finally(() => onClose());
                }}
              >
                <span className="command-item-title">{item.title}</span>
                {item.subtitle ? <span className="command-item-subtitle">{item.subtitle}</span> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

