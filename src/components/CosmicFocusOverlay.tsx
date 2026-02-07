import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { ReaderPalette } from "../types/app";

interface CosmicChunk {
  index: number;
  preview: string;
}

interface CosmicFocusOverlayProps {
  open: boolean;
  words: string[];
  currentIndex: number;
  isPlaying: boolean;
  wpm: number;
  bionicEnabled: boolean;
  palette: ReaderPalette;
  wordSize: number;
  baseWeight: number;
  focusWeight: number;
  fixation: number;
  minWordLength: number;
  onClose: () => void;
  onTogglePlay: () => void;
  onReset: () => void;
  onSeek: (index: number) => void;
  onWpmChange: (wpm: number) => void;
  onBionicChange: (enabled: boolean) => void;
  onPaletteChange: (palette: ReaderPalette) => void;
  onWordSizeChange: (size: number) => void;
  onBaseWeightChange: (weight: number) => void;
  onFocusWeightChange: (weight: number) => void;
  onFixationChange: (fixation: number) => void;
  onMinWordLengthChange: (value: number) => void;
  renderWord: (word: string) => string;
}

const CHUNK_SIZE = 24;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export default function CosmicFocusOverlay({
  open,
  words,
  currentIndex,
  isPlaying,
  wpm,
  bionicEnabled,
  palette,
  wordSize,
  baseWeight,
  focusWeight,
  fixation,
  minWordLength,
  onClose,
  onTogglePlay,
  onReset,
  onSeek,
  onWpmChange,
  onBionicChange,
  onPaletteChange,
  onWordSizeChange,
  onBaseWeightChange,
  onFocusWeightChange,
  onFixationChange,
  onMinWordLengthChange,
  renderWord
}: CosmicFocusOverlayProps) {
  const safeIndex = clamp(currentIndex, 0, Math.max(words.length - 1, 0));

  const chunks = useMemo<CosmicChunk[]>(() => {
    const result: CosmicChunk[] = [];
    for (let i = 0; i < words.length; i += CHUNK_SIZE) {
      const preview = words.slice(i, i + 8).join(" ");
      result.push({
        index: i,
        preview: preview.length > 0 ? preview : "..."
      });
    }
    return result;
  }, [words]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="cosmic-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Cosmic Focus Mode"
      data-cosmic-palette={palette}
      style={
        {
          "--cosmic-word-size": `${wordSize}px`,
          "--cosmic-base-weight": String(baseWeight),
          "--cosmic-focus-weight": String(focusWeight)
        } as CSSProperties
      }
    >
      <aside className="cosmic-side">
        <div className="cosmic-side-top">
          <h2>Cosmic Focus</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="cosmic-controls">
          <div className="cosmic-controls-row">
            <button type="button" onClick={onTogglePlay}>
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button type="button" onClick={onReset}>
              Restart
            </button>
          </div>
          <label className="control-select">
              <span>Palette</span>
            <select
              value={palette}
              onChange={(event) => onPaletteChange(event.target.value as ReaderPalette)}
            >
              <option value="void">Void</option>
              <option value="paper">Paper</option>
              <option value="mist">Mist</option>
            </select>
          </label>
          <label className="control-slider">
            <span>WPM {wpm}</span>
            <input
              type="range"
              min={120}
              max={900}
              step={10}
              value={wpm}
              onChange={(event) => onWpmChange(Number(event.target.value))}
            />
          </label>
          <label className="control-slider">
            <span>Size {wordSize}px</span>
            <input
              type="range"
              min={44}
              max={180}
              step={2}
              value={wordSize}
              onChange={(event) => onWordSizeChange(Number(event.target.value))}
            />
          </label>
          <label className="control-slider">
            <span>Text Weight {baseWeight}</span>
            <input
              type="range"
              min={350}
              max={750}
              step={10}
              value={baseWeight}
              onChange={(event) => onBaseWeightChange(Number(event.target.value))}
            />
          </label>
          <label className="cosmic-inline">
            <input
              type="checkbox"
              checked={bionicEnabled}
              onChange={(event) => onBionicChange(event.target.checked)}
            />
            Bionic words
          </label>
          <label className="control-slider">
            <span>Bionic Weight {focusWeight}</span>
            <input
              type="range"
              min={560}
              max={900}
              step={10}
              value={focusWeight}
              onChange={(event) => onFocusWeightChange(Number(event.target.value))}
              disabled={!bionicEnabled}
            />
          </label>
          <label className="control-slider">
            <span>Bionic Focus {Math.round(fixation * 100)}%</span>
            <input
              type="range"
              min={25}
              max={75}
              step={5}
              value={Math.round(fixation * 100)}
              onChange={(event) => onFixationChange(Number(event.target.value) / 100)}
              disabled={!bionicEnabled}
            />
          </label>
          <label className="control-number">
            <span>Bionic Min</span>
            <input
              type="number"
              min={2}
              max={12}
              step={1}
              value={minWordLength}
              onChange={(event) => onMinWordLengthChange(Number(event.target.value))}
              disabled={!bionicEnabled}
            />
          </label>
          <label className="control-slider">
            <span>
              Position {safeIndex + 1}/{Math.max(words.length, 1)}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(words.length - 1, 0)}
              step={1}
              value={safeIndex}
              onChange={(event) => onSeek(Number(event.target.value))}
            />
          </label>
        </div>
        <div className="cosmic-chunks">
          {chunks.map((chunk) => (
            <button
              key={chunk.index}
              type="button"
              className={safeIndex >= chunk.index && safeIndex < chunk.index + CHUNK_SIZE ? "is-active" : ""}
              onClick={() => onSeek(chunk.index)}
            >
              {chunk.preview}
            </button>
          ))}
        </div>
      </aside>

      <main className="cosmic-stage">
        <div className="cosmic-word" dangerouslySetInnerHTML={{ __html: renderWord(words[safeIndex] ?? "") }} />
      </main>
    </div>
  );
}
