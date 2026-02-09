interface ShortcutHandlers {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onCommandPalette: () => void;
  onWorkspaceSearch: () => void;
}

const isApplePlatform = (): boolean => navigator.userAgent.includes("Mac");

export const bindShortcuts = (handlers: ShortcutHandlers): (() => void) => {
  const listener = (event: KeyboardEvent): void => {
    const hasModifier = isApplePlatform() ? event.metaKey : event.ctrlKey;
    if (!hasModifier) {
      return;
    }

    const key = event.key.toLowerCase();

    if (key === "n") {
      event.preventDefault();
      handlers.onNew();
      return;
    }

    if (key === "o") {
      event.preventDefault();
      handlers.onOpen();
      return;
    }

    if (key === "s" && event.shiftKey) {
      event.preventDefault();
      handlers.onSaveAs();
      return;
    }

    if (key === "s") {
      event.preventDefault();
      handlers.onSave();
      return;
    }

    if (key === "k") {
      event.preventDefault();
      handlers.onCommandPalette();
      return;
    }

    if (key === "f" && event.shiftKey) {
      event.preventDefault();
      handlers.onWorkspaceSearch();
    }
  };

  window.addEventListener("keydown", listener);
  return () => window.removeEventListener("keydown", listener);
};
