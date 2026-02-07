# Md Editor

Simple, lightweight, local-first Markdown viewer/editor for macOS with live preview.

## Highlights

- Three readability palettes: `Void Black`, `Paper Light`, `Mist Contrast`
- `Ultra Read` preview mode with configurable bionic-reading settings
- Folder workspace sidebar for switching across multiple Markdown files
- `Cosmic Focus` mode with palette selection, WPM, word size, boldness controls, and seek preview
- Autosave + Save As workflow with conflict-safe file writes

## Stack

- Tauri v2 (desktop shell)
- React + TypeScript + Vite
- CodeMirror 6 (editor)
- marked + highlight.js + DOMPurify (preview)
- Zustand (state)

## Prerequisites

- Node.js 20+
- Rust toolchain (`rustup`)
- Xcode command line tools (`xcode-select --install`)

## Development

```bash
npm install
npm run tauri:dev
```

## Tests

```bash
npm test
npm run test:e2e
```

## Build DMG

```bash
npm run tauri:build
```

The unsigned DMG output is created under:

`src-tauri/target/release/bundle/dmg/`

On first launch, macOS may warn because the app is unsigned. Use right-click -> `Open` once.
