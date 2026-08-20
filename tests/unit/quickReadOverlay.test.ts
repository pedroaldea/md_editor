import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import QuickReadOverlay from "../../src/components/QuickReadOverlay";

const mountOverlay = (props: Partial<React.ComponentProps<typeof QuickReadOverlay>> = {}) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onClose = props.onClose ?? vi.fn();

  act(() => {
    flushSync(() => {
      root.render(
        createElement(QuickReadOverlay, {
          open: true,
          words: ["First", "second", "third"],
          onClose,
          ...props
        })
      );
    });
  });

  return {
    host,
    onClose,
    unmount: () => {
      act(() => {
        flushSync(() => root.unmount());
      });
      host.remove();
    }
  };
};

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT;

beforeAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("QuickReadOverlay", () => {
  it("renders the current word, accessible progress, and speed control", () => {
    const { host, unmount } = mountOverlay({ initialWpm: 420 });
    try {
      expect(host.querySelector('[role="dialog"]')).not.toBeNull();
      expect(host.querySelector(".quick-read-word")?.textContent).toBe("First");
      expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("1");
      expect(host.querySelector("output")?.textContent).toBe("420 WPM");
      expect(host.querySelector('input[type="range"]')?.getAttribute("aria-label")).toBe(
        "Words per minute"
      );
    } finally {
      unmount();
    }
  });

  it("advances one word per WPM interval and pauses cleanly", () => {
    vi.useFakeTimers();
    const { host, unmount } = mountOverlay({ words: ["One", "Two"], initialWpm: 600 });
    try {
      const play = host.querySelector<HTMLButtonElement>('button[aria-label="Play reading"]');
      expect(play).not.toBeNull();

      act(() => play?.click());
      expect(host.querySelector(".quick-read-word")?.textContent).toBe("One");

      act(() => vi.advanceTimersByTime(100));
      expect(host.querySelector(".quick-read-word")?.textContent).toBe("Two");
      expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("2");

      const pause = host.querySelector<HTMLButtonElement>('button[aria-label="Pause reading"]');
      act(() => pause?.click());
      act(() => vi.advanceTimersByTime(500));
      expect(host.querySelector(".quick-read-word")?.textContent).toBe("Two");
    } finally {
      unmount();
    }
  });

  it("restarts and closes through the explicit controls", () => {
    const onClose = vi.fn();
    const { host, unmount } = mountOverlay({ words: ["One"], onClose });
    try {
      const restart = host.querySelector<HTMLButtonElement>('button[aria-label="Restart reading"]');
      act(() => restart?.click());
      expect(host.querySelector(".quick-read-word")?.textContent).toBe("One");

      const overlay = host.querySelector<HTMLElement>(".quick-read-overlay");
      act(() =>
        overlay?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      );
      act(() => overlay?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      host.querySelector<HTMLButtonElement>(".quick-read-close")?.click();
      expect(onClose).toHaveBeenCalledTimes(3);
    } finally {
      unmount();
    }
  });
});
