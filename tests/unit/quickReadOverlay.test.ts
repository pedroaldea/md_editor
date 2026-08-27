import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import QuickReadOverlay, {
  QUICK_READ_FONT_SCALE_STORAGE_KEY
} from "../../src/components/QuickReadOverlay";

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
  window.localStorage.removeItem(QUICK_READ_FONT_SCALE_STORAGE_KEY);
});

describe("QuickReadOverlay", () => {
  it("renders the current word, accessible progress, and speed control", () => {
    const { host, unmount } = mountOverlay({ initialWpm: 420 });
    try {
      expect(host.querySelector('[role="dialog"]')).not.toBeNull();
      expect(host.querySelector(".quick-read-word")?.textContent).toBe("First");
      expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("1");
      expect(host.querySelector(".quick-read-speed output")?.textContent).toBe("420 WPM");
      expect(host.querySelector('input[type="range"]')?.getAttribute("aria-label")).toBe(
        "Words per minute"
      );
    } finally {
      unmount();
    }
  });

  it("keeps the 35% RSVP focus intact and reconstructs every word without duplication", () => {
    const { host, unmount } = mountOverlay({ words: ["te", "fuentes", "cooperación"] });
    try {
      const overlay = host.querySelector<HTMLElement>(".quick-read-overlay");
      const readSegments = () =>
        Array.from(host.querySelectorAll<HTMLElement>(".quick-read-word span")).map(
          (segment) => segment.textContent ?? ""
        );

      expect(readSegments()).toEqual(["", "t", "e"]);

      act(() =>
        overlay?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
      );
      expect(readSegments()).toEqual(["fu", "ent", "es"]);

      act(() =>
        overlay?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
      );
      const cooperationSegments = readSegments();
      expect(cooperationSegments.join("")).toBe("cooperación");
      const focusLength = Array.from(
        new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
          cooperationSegments[1]
        )
      ).length;
      expect(focusLength).toBe(4);
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

  it("resizes the reading word with buttons and keyboard and persists the choice", () => {
    const firstMount = mountOverlay();
    try {
      const word = firstMount.host.querySelector<HTMLElement>(".quick-read-word");
      const sizeOutput = firstMount.host.querySelector<HTMLOutputElement>(
        '.quick-read-text-size output'
      );
      expect(sizeOutput?.textContent).toBe("100%");
      expect(word?.style.getPropertyValue("--quick-read-font-max")).toBe("88px");

      const increase = firstMount.host.querySelector<HTMLButtonElement>(
        'button[aria-label="Increase Quick Read text size"]'
      );
      act(() => increase?.click());
      expect(sizeOutput?.textContent).toBe("110%");
      expect(word?.style.getPropertyValue("--quick-read-font-max")).toBe("96.8px");

      const overlay = firstMount.host.querySelector<HTMLElement>(".quick-read-overlay");
      act(() =>
        overlay?.dispatchEvent(new KeyboardEvent("keydown", { key: "]", bubbles: true }))
      );
      expect(sizeOutput?.textContent).toBe("120%");
      expect(window.localStorage.getItem(QUICK_READ_FONT_SCALE_STORAGE_KEY)).toBe("120");
    } finally {
      firstMount.unmount();
    }

    const secondMount = mountOverlay();
    try {
      expect(
        secondMount.host.querySelector<HTMLOutputElement>('.quick-read-text-size output')
          ?.textContent
      ).toBe("120%");
      const decrease = secondMount.host.querySelector<HTMLButtonElement>(
        'button[aria-label="Decrease Quick Read text size"]'
      );
      act(() => decrease?.click());
      expect(window.localStorage.getItem(QUICK_READ_FONT_SCALE_STORAGE_KEY)).toBe("110");
    } finally {
      secondMount.unmount();
    }
  });

  it("clamps stored text sizes and disables controls at both limits", () => {
    window.localStorage.setItem(QUICK_READ_FONT_SCALE_STORAGE_KEY, "999");
    const maximumMount = mountOverlay();
    try {
      expect(
        maximumMount.host.querySelector<HTMLOutputElement>('.quick-read-text-size output')
          ?.textContent
      ).toBe("150%");
      expect(
        maximumMount.host.querySelector<HTMLButtonElement>(
          'button[aria-label="Increase Quick Read text size"]'
        )?.disabled
      ).toBe(true);
    } finally {
      maximumMount.unmount();
    }

    window.localStorage.setItem(QUICK_READ_FONT_SCALE_STORAGE_KEY, "1");
    const minimumMount = mountOverlay();
    try {
      expect(
        minimumMount.host.querySelector<HTMLOutputElement>('.quick-read-text-size output')
          ?.textContent
      ).toBe("70%");
      expect(
        minimumMount.host.querySelector<HTMLButtonElement>(
          'button[aria-label="Decrease Quick Read text size"]'
        )?.disabled
      ).toBe(true);
    } finally {
      minimumMount.unmount();
    }
  });
});
