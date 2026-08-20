# Md Editor

Local-first Markdown and PDF workbench for macOS: write, read, annotate and move through a document without leaving the keyboard.

## Highlights

- Ultra-minimal ASCII/editorial shell with `Edit`, `Split`, `Read` and `Focus` layouts
- Explicit, persisted light and dark themes across chrome, editor and reader
- Contextual `/` menu with 22 commands: headings, lists, media, links, callouts, footnotes, details, inline formats, tables and marks
- Native `/image` picker/importer plus clipboard and drag-and-drop image support
- Contextual table mini toolbar for adding/removing rows and columns, cycling alignment and formatting
- Inline `==highlight==` and `++underline++` marks that remain plain Markdown
- Quick Read (RSVP) mode with play/pause, WPM, progress and keyboard stepping
- Local PDF.js reader in the Tauri desktop shell with selectable text, page navigation and zoom
- PDF highlights, underlines and opaque redactions persisted beside the source as `file.pdf.annotations.json`
- Keyboard-accessible PDF annotation and a local backup when the sidecar cannot be written
- Responsive command rail/drawer, outline navigation, workspace search and command palette
- Optional bionic reading and adjustable reading width
- Autosave, recovery drafts, snapshots and conflict-safe file writes
- Markdown, HTML and PDF (print) export

PDF scope: the desktop reader renders a local PDF.js canvas plus selectable text layer.
Select text to create a highlight, underline or redaction; marks are stored in a small
sidecar next to the PDF. Redaction draws a fully opaque cover and stores only
`[redacted]` instead of the selected quote. It is reversible and the original PDF
remains untouched, so it is not a secure content-removal/export feature. Markdown marks
continue to use the canonical `==highlight==` and `++underline++` source forms.
The Tauri bridge reads validated PDF bytes, so documents outside the home folder
work without widening the asset-protocol scope. A small runtime compatibility
layer keeps text extraction working on the WebKit versions supported by macOS 13+.

## Stack

- Tauri v2 (desktop shell)
- React + TypeScript + Vite
- CodeMirror 6 (editor)
- marked + highlight.js core + DOMPurify (preview)
- PDF.js (lazy-loaded only when a PDF is opened)
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
cd src-tauri && cargo test
```

## Build DMG

```bash
npm run tauri:build
```

The ad-hoc signed DMG output is created under:

`src-tauri/target/release/bundle/dmg/`

The local build is integrity-signed but not Developer ID signed or notarized.
Gatekeeper may therefore warn on another Mac; use right-click → `Open` for local
testing. Public distribution requires an Apple Developer identity and notarization.
