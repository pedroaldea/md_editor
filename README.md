# Md Editor

Simple, lightweight, local-first Markdown viewer/editor for macOS with live preview.

## Stack

- Tauri v2 (desktop shell)
- React + TypeScript + Vite
- CodeMirror 6 (editor)
- marked + highlight.js + DOMPurify (preview)
- Zustand (state)

## Prerequisites

- Node.js 20+
- pnpm 9+
- Rust toolchain (`rustup`)
- Xcode command line tools (`xcode-select --install`)

## Development

```bash
pnpm install
pnpm tauri:dev
```

## Tests

```bash
pnpm test
pnpm test:e2e
```

## Build DMG

```bash
pnpm tauri:build
```

The unsigned DMG output is created under:

`src-tauri/target/release/bundle/dmg/`

On first launch, macOS may warn because the app is unsigned. Use right-click -> `Open` once.
