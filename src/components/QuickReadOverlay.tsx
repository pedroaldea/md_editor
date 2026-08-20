import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent
} from "react";
import { useDialogFocus } from "../lib/useDialogFocus";
import "./QuickReadOverlay.css";

const DEFAULT_WPM = 360;
const DEFAULT_MIN_WPM = 120;
const DEFAULT_MAX_WPM = 900;
const DEFAULT_WPM_STEP = 10;

export interface QuickReadProgress {
  current: number;
  total: number;
  percent: number;
  wpm: number;
}

export interface QuickReadOverlayProps {
  /** Whether the reader is visible. The parent owns this state. */
  open: boolean;
  /** Words to reveal, usually from extractReadingWords(markdown). */
  words: readonly string[];
  /** Called by the close button, Escape, or a backdrop click. */
  onClose: () => void;
  /** Optional document label shown in the compact header. */
  title?: string;
  /** Starts playback when the overlay opens. Defaults to false. */
  autoStart?: boolean;
  /** Initial and range limits for the reading speed. */
  initialWpm?: number;
  minWpm?: number;
  maxWpm?: number;
  wpmStep?: number;
  onComplete?: () => void;
  onProgress?: (progress: QuickReadProgress) => void;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const normalizeWords = (words: readonly string[]): string[] =>
  words.map((word) => word.trim()).filter(Boolean);

const getFocusSplit = (word: string): { prefix: string; focus: string; rest: string } => {
  if (!word) {
    return { prefix: "", focus: "", rest: "" };
  }

  const focusLength = Math.max(1, Math.ceil(word.length * 0.35));
  const focusStart = Math.max(0, Math.floor((word.length - focusLength) / 2));
  return {
    prefix: word.slice(0, focusStart),
    focus: word.slice(focusStart, focusStart + focusLength),
    rest: word.slice(focusStart + focusLength)
  };
};

const getSafeNumber = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) ? Number(value) : fallback;

export default function QuickReadOverlay({
  open,
  words,
  onClose,
  title = "Quick read",
  autoStart = false,
  initialWpm = DEFAULT_WPM,
  minWpm = DEFAULT_MIN_WPM,
  maxWpm = DEFAULT_MAX_WPM,
  wpmStep = DEFAULT_WPM_STEP,
  onComplete,
  onProgress
}: QuickReadOverlayProps) {
  const normalizedWords = useMemo(() => normalizeWords(words), [words]);
  const wordsKey = useMemo(() => normalizedWords.join("\u0000"), [normalizedWords]);
  const headingId = useId();
  const speedId = useId();
  const playButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const completionNotifiedRef = useRef(false);
  const resetKeyRef = useRef<string | null>(null);

  const safeMinWpm = Math.max(1, Math.round(getSafeNumber(minWpm, DEFAULT_MIN_WPM)));
  const safeMaxWpm = Math.max(safeMinWpm, Math.round(getSafeNumber(maxWpm, DEFAULT_MAX_WPM)));
  const safeStepWpm = Math.max(1, Math.round(getSafeNumber(wpmStep, DEFAULT_WPM_STEP)));
  const safeInitialWpm = clamp(
    Math.round(getSafeNumber(initialWpm, DEFAULT_WPM)),
    safeMinWpm,
    safeMaxWpm
  );

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoStart);
  const [wpm, setWpm] = useState(safeInitialWpm);
  useDialogFocus(open, dialogRef, onClose, playButtonRef);

  useLayoutEffect(() => {
    const resetKey = `${open ? "open" : "closed"}:${autoStart ? "auto" : "manual"}:${wordsKey}`;
    if (resetKeyRef.current === resetKey) {
      return;
    }
    resetKeyRef.current = resetKey;

    if (!open) {
      if (currentIndex !== 0) {
        setCurrentIndex(0);
      }
      if (isPlaying) {
        setIsPlaying(false);
      }
      completionNotifiedRef.current = false;
      return;
    }

    if (currentIndex !== 0) {
      setCurrentIndex(0);
    }
    const shouldPlay = autoStart && normalizedWords.length > 0;
    if (isPlaying !== shouldPlay) {
      setIsPlaying(shouldPlay);
    }
    completionNotifiedRef.current = false;
  }, [autoStart, currentIndex, isPlaying, normalizedWords.length, open, wordsKey]);

  useLayoutEffect(() => {
    if (wpm < safeMinWpm || wpm > safeMaxWpm) {
      setWpm(clamp(wpm, safeMinWpm, safeMaxWpm));
    }
  }, [safeMaxWpm, safeMinWpm, wpm]);

  useEffect(() => {
    if (!open || !isPlaying || normalizedWords.length === 0) {
      return;
    }

    if (currentIndex >= normalizedWords.length - 1) {
      setIsPlaying(false);
      if (!completionNotifiedRef.current) {
        completionNotifiedRef.current = true;
        onComplete?.();
      }
      return;
    }

    const delayMs = 60_000 / wpm;
    const timer = window.setTimeout(() => {
      setCurrentIndex((index) => Math.min(index + 1, normalizedWords.length - 1));
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [currentIndex, isPlaying, normalizedWords.length, onComplete, open, wpm]);

  useEffect(() => {
    if (!open || !onProgress) {
      return;
    }

    const total = normalizedWords.length;
    onProgress({
      current: total === 0 ? 0 : currentIndex + 1,
      total,
      percent: total === 0 ? 0 : Math.round(((currentIndex + 1) / total) * 100),
      wpm
    });
  }, [currentIndex, normalizedWords.length, onProgress, open, wpm]);

  const togglePlayback = (): void => {
    if (normalizedWords.length === 0) {
      return;
    }

    if (!isPlaying && currentIndex >= normalizedWords.length - 1) {
      completionNotifiedRef.current = false;
      setCurrentIndex(0);
    }
    setIsPlaying((playing) => !playing);
  };

  const restart = (): void => {
    completionNotifiedRef.current = false;
    setCurrentIndex(0);
    setIsPlaying(false);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    const target = event.target as HTMLElement | null;
    const isFormControl = target?.tagName === "INPUT" || target?.tagName === "SELECT";
    if (event.code === "Space" && !isFormControl) {
      event.preventDefault();
      togglePlayback();
      return;
    }

    if (event.key === "ArrowRight" && !isFormControl) {
      event.preventDefault();
      setCurrentIndex((index) => Math.min(index + 1, Math.max(normalizedWords.length - 1, 0)));
      setIsPlaying(false);
      return;
    }

    if (event.key === "ArrowLeft" && !isFormControl) {
      event.preventDefault();
      setCurrentIndex((index) => Math.max(index - 1, 0));
      setIsPlaying(false);
    }
  };

  const handleBackdropClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  if (!open) {
    return null;
  }

  const total = normalizedWords.length;
  const currentWord = normalizedWords[currentIndex] ?? "";
  const { prefix, focus, rest } = getFocusSplit(currentWord);
  const current = total === 0 ? 0 : currentIndex + 1;
  const percent = total === 0 ? 0 : Math.round((current / total) * 100);
  const progressStyle = { width: `${percent}%` } satisfies CSSProperties;

  return (
    <div
      className="quick-read-overlay"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <section
        ref={dialogRef}
        className="quick-read-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
      >
        <header className="quick-read-header">
          <div>
            <h2 id={headingId} className="quick-read-title">
              {title}
            </h2>
            <p className="quick-read-subtitle">One word at a time</p>
          </div>
          <button
            className="quick-read-close"
            type="button"
            onClick={onClose}
            aria-label="Close quick reader"
            title="Close"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="quick-read-stage" aria-live="off">
          {currentWord ? (
            <div className="quick-read-word" aria-label={currentWord}>
              <span className="quick-read-word-prefix" aria-hidden="true">
                {prefix}
              </span>
              <span className="quick-read-word-focus" aria-hidden="true">
                {focus}
              </span>
              <span className="quick-read-word-rest" aria-hidden="true">
                {rest}
              </span>
            </div>
          ) : (
            <p className="quick-read-empty">This document has no readable words.</p>
          )}
        </div>

        <div>
          <div className="quick-read-progress-meta">
            <span>
              {current} / {total} words
            </span>
            <span>{percent}%</span>
          </div>
          <div
            className="quick-read-progress"
            role="progressbar"
            aria-label="Reading progress"
            aria-valuemin={0}
            aria-valuemax={total || 1}
            aria-valuenow={current}
            aria-valuetext={total === 0 ? "No words" : `${percent}% complete`}
          >
            <div className="quick-read-progress-value" style={progressStyle} />
          </div>
        </div>

        <div className="quick-read-toolbar">
          <div className="quick-read-actions">
            <button
              ref={playButtonRef}
              className="quick-read-button is-primary"
              type="button"
              onClick={togglePlayback}
              disabled={total === 0}
              aria-label={isPlaying ? "Pause reading" : "Play reading"}
            >
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button
              className="quick-read-button"
              type="button"
              onClick={restart}
              disabled={total === 0}
              aria-label="Restart reading"
            >
              Restart
            </button>
          </div>

          <label className="quick-read-speed" htmlFor={speedId}>
            <span>Speed</span>
            <input
              id={speedId}
              type="range"
              min={safeMinWpm}
              max={safeMaxWpm}
              step={safeStepWpm}
              value={wpm}
              onChange={(event) => setWpm(Number(event.target.value))}
              disabled={total === 0}
              aria-label="Words per minute"
              aria-valuetext={`${wpm} words per minute`}
            />
            <output htmlFor={speedId}>{wpm} WPM</output>
          </label>
        </div>

        <footer className="quick-read-footer">
          <span>
            {isPlaying ? "Reading…" : current >= total && total > 0 ? "Complete" : "Paused"}
          </span>
          <span>
            <strong>{wpm}</strong> words per minute
          </span>
        </footer>
      </section>
    </div>
  );
}
