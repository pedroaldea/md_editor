# Design QA — ASCII editorial revamp

## Comparison target

- Source visual truth: `/Users/pedroaldeamas/.codex/generated_images/01a018b2-ce7c-7383-bf68-349cf48f3a9f/exec-81108907-8fe9-4684-b530-7b13a197eaee.png`
- Rendered implementation: `http://127.0.0.1:1420/`
- Dark side-by-side comparison: `docs/qa/comparison-current-dark.png`
- Light side-by-side comparison: `docs/qa/comparison-current-light.png`
- Viewport/state: desktop split mode with realistic Markdown content and `/` menu open; sources and implementations are aligned 1:1 inside each comparison.

## Findings

- No actionable P0, P1, or P2 differences remain.
- [P3] The implementation uses truthful dynamic state (`Unsaved`, word count) instead of the mock's static `Saved · Page 1 of 3`. This is intentional product behavior, not visual drift.
- [P3] The generated source contains slight photographic grain. The implementation stays pixel-crisp to protect editor legibility and rendering cost.
- [P3] The implementation's 12-command default popup uses explicit ASCII marks and one compact footer rather than a right-hand shortcut on every row. Ten additional commands remain searchable; hierarchy, square border, active row and placement match the selected direction.

## Required fidelity surfaces

- Fonts and typography: passed. System mono is used for chrome/editor; system sans for reading. Weight, line height, left alignment, line wrapping, heading scale, truncation, and small-label contrast were checked at full size and in focused crops.
- Spacing and layout rhythm: passed. Full-bleed 92 px rail, 64 px header, 55 px status bar, 54:46 split, zero structural radii/shadows, dashed rules, editor gutter, reading measure, and popup placement match the reference grammar.
- Colors and tokens: passed. Flat `#080a0b` dark canvas, bone text, restrained gray hierarchy, cyan focus/accent, and the light counterpart were verified. No gradients or glass effects remain.
- Image quality and asset fidelity: passed. The target contains no required logo, illustration, product image, or icon asset; no substitute raster, SVG, emoji, or decorative CSS art was introduced.
- Copy and content: passed. The app uses real document/status text. Default `/` commands are 12 high-frequency actions; advanced inline formats, footnotes and details remain searchable.

## Full-view comparison evidence

- Dark: `docs/qa/comparison-current-dark.png`
- Light: `docs/qa/comparison-current-light.png`
- The overall silhouette, information architecture, rail distribution, split ratio, reading hierarchy, flat surfaces, borders, and bottom status bar align with the source.

## Focused comparison evidence

- Focus surface: `docs/qa/current-light-focus.png`
- Mobile slash sheet: `docs/qa/current-mobile-light-slash.png`
- Browser PDF desktop/mobile: `docs/qa/current-pdf-desktop.png`, `docs/qa/current-pdf-mobile.png`
- Native DMG PDF and persisted highlight: `docs/qa/current-native-final-pdf.png`, `docs/qa/current-native-final-pdf-annotated.png`
- Quick Read sizing: `docs/qa/current-quick-read-font-100.png`, `docs/qa/current-quick-read-font-130.png`, `docs/qa/current-quick-read-font-mobile-140.png`, and exact-DMG WebKit `docs/qa/current-native-quick-read-font-110.png`
- Native Markdown-to-PDF export: `docs/qa/current-native-pdf-export-document-only.png`; saved artifact: `docs/qa/current-native-pdf-export-proof.pdf`
- Extension proof: `/private/tmp/md-editor-slash-expanded.png`, `/private/tmp/md-editor-table-toolbar.png`, `/private/tmp/md-editor-final-native-redact.png`
- Focused crops were required because toolbar text, editor line length, and popup density were too small to judge reliably in the 2974 px-wide combined image.

## Comparison history

1. Initial audit — blocked.
   - Findings: padded card dashboard, rounded grouped toolbar, gradients/glass, no permanent rail, no real bottom status bar, serif-heavy preview, and no visible direct light/dark control.
   - Fixes: rebuilt the shell as a full-bleed ASCII grid; replaced the toolbar silhouette; added rail, status bar, flat tokens, mono chrome, sans preview, persistent theme, and mobile drawer.
2. Exact pass 2 — blocked by P2 typography/density drift.
   - Findings: editor and reading measures were too wide; popup contained 13 default options; PDF mode was not visible in the main chrome; status lacked cursor column.
   - Fixes: constrained editor/preview measures, exposed `[pdf]`, added `Ln/Col`, made CodeMirror theme-aware, and kept the default popup compact while retaining advanced search.
3. Exact dark/light final pass — passed.
   - Evidence: `docs/qa/comparison-current-dark.png`, `docs/qa/comparison-current-light.png`
   - Post-fix result: no actionable P0/P1/P2 mismatch remains.
4. Native PDF pass — initially blocked, then passed.
   - The mounted DMG exposed a WebKit-only `ReadableStream` async-iteration gap that Chromium did not reproduce.
   - The final build adds the missing standards compatibility plus a portable selectable-text renderer; render, keyboard highlight, reopen persistence and removal all passed in the exact DMG.

## Interaction and browser evidence

- Theme light ↔ dark and persistence: passed.
- Edit, split, read, focus, command palette, mobile drawer: passed.
- `/` filtering, arrows, Enter, Escape, mouse/tap, table, highlight, underline: passed.
- `/image` native picker/import, richer block search and contextual table add/remove/align/format on desktop/mobile: passed.
- PDF render, selectable text, zoom, fit-width mobile behavior, highlight, underline, opaque redaction, privacy-preserving sidecar quote, removal, persistence, corrupt-file state and native WebKit path: passed.
- Mobile 320, 390 and 430 px plus desktop overflow checks: passed.
- Initial load and theme/Edit/Split/Read transitions: passed the frame-bounded performance smoke five consecutive times.
- Quick Read `A− / A+`, 70–150% bounds, `[` / `]`, persistence, 44 px touch targets and 390 px containment: passed. The final DMG also exposed the controls through macOS accessibility and restored the saved 110% value.
- Final Playwright matrix: 81/81 scenarios passed; product console/error assertions remained clean.

## Extension QA — 2026-08-20

- Slash menu: passed at desktop and mobile. Twelve defaults fit in the bounded square menu; 22 total commands are keyboard searchable.
- Table mini toolbar: passed. Six operations follow the active cell; mobile uses a fixed 3×2 grid with every target at least 44 px and no horizontal overflow.
- P1 Markdown blocks: passed. Mermaid edge detection ignores operator-like content inside labels, quoted strings, pipe labels and comments, so `---` cannot steal a dotted feedback edge; E2E covers the exact `1/3` path. Callouts render as callouts, and a one-column table inserted from `/` survives the edit/preview roundtrip.
- PDF redaction: passed in Chromium and was repeated in the definitive installed package/WebKit. The real one-page fixture loaded; focused chunk + `R` produced `Redacted · page 1`, mark count `1`, sidebar `p. 1 [redacted]` and a visible opaque band. `Remove` returned the count to `0`; the empty sidecar was deleted and the app returned to the real Markdown document in Saved/Read/light state. Evidence: `/private/tmp/md-editor-final-native-redact.png`. This is visual-only masking: it does not securely remove the original PDF text or bytes.
- Native packaging: passed after clearing one stale temporary DMG mount left by the first packaging attempt. Final DMG checksum and deep strict app signature verification pass.

## Preview media and reading-width QA — 2026-08-20

- Relative and absolute local images: the preview resolves them before native URL conversion. If macOS blocks a path outside `$HOME`, a validated native fallback supports PNG/JPEG/GIF/WebP/BMP/SVG up to 12 MB without widening the asset scope. Remote/data/blob/asset sources are unchanged. Resolver, native-bridge and Rust validation coverage passes; visual evidence is `/private/tmp/md-editor-relative-image.png`.
- Read layout: the standalone reader uses a centered 960 px canvas. Split is adaptive rather than left anchored: each editor/preview panel centers its own bounded content and fills naturally when narrow; 390 px mobile keeps safe padding. Focused geometry/browser coverage passes; evidence is `/private/tmp/md-editor-read-wide.png` and `docs/qa/current-native-final-adaptive-split.png`.
- Mermaid: fenced `mermaid` blocks render in light/dark, redraw on theme change, support labels containing literal `\\n`, expose `/diagram`, and show a bounded error for invalid source. WebKit lays out labelled dotted feedback as a temporary solid edge, then the generated SVG restores its dotted stroke. The preview memoizes injected HTML so scroll-progress rerenders cannot wipe the SVG. Evidence: `/private/tmp/md-editor-mermaid-read.png` and final native `/private/tmp/md-editor-final-native-media.png`.
- Lightweight behavior: Mermaid is dynamically imported and rendered only when a diagram is near the viewport; the production entry does not preload its renderer or flowchart chunks. Production build and diff check pass.
- Edit layout: the standalone editor now centers its line-number gutter and a 96ch source column as one 980 px writing desk. At the exact reported 1144 px window width the editable column is at least 840 px, outer gaps are balanced within 4 px, the page has no horizontal overflow, and Split remains narrower. Native before/after: `/private/tmp/md-editor-before-edit-width.png` → `/private/tmp/md-editor-after-edit-width.png`.
- Quick Read checkpoint: **110/110 unit tests across 19 files and 73/73 Playwright scenarios passed; production and Tauri/DMG builds passed**. The unchanged native baseline remained 18/18 Rust with strict Clippy and format checks.
- Final follow-up package: 6,211,763-byte ARM64 DMG, SHA-256 `8f3d7ec73818236232ba956c0f4d8b8625767b8f782a7fb3442db0157f98feb6`. The DMG verifies as valid and its mounted app passes strict deep signature verification; executable SHA-256 is `5f82d989b75edab378f4508158ef8153ed1a0446440ef33f08b0fd9bb423f735`.
- Definitive native Edit/media/Read/Split gate repeated on the final package: only the installed `/Applications` app was running as PID 10534. Pointer drag and keyboard resizing produced balanced 25:75 and 50:50 layouts on the real document; the app was left Saved/light/Split 50:50. Evidence: `docs/qa/current-native-final-split-25-75.png`, `docs/qa/current-native-final-split-50-50.png` and `docs/qa/current-native-final-adaptive-split.png`.

## Clean PDF export QA — 2026-08-27

- Reproduced failure before the fix: Chromium generated a four-page PDF containing rail controls, the status line, dark application colors, poor use of page width and an unresolved `Rendering diagram…` placeholder.
- Export isolation: only a prepared `.preview-content` print surface is printable. App rail, top bar, editor, status bar, dialogs and all other body children are excluded by the print contract rather than by fragile per-control selectors.
- Source correctness: the print surface is created from the latest `document.content` in Edit/Split/Read/Focus, so a delayed or unmounted preview cannot block export and display-only Bionic formatting cannot leak into the file.
- Resource readiness: lazy images are promoted to eager/synchronous decoding, local image fallback, document fonts and all Mermaid diagrams — including off-screen assets — finish before the native print command opens. Mermaid rendering is serialized so live preview and export cannot race each other.
- Pagination: A4 margins, white paper, readable maximum measure and `break-inside` guards cover headings, tables, code, blockquotes, images and Mermaid. A real four-page Chromium artifact and a real two-page macOS WebKit artifact were rendered and visually inspected page by page.
- Native lifecycle regression: macOS resolves the Tauri print command when the sheet opens, not when Save/Cancel completes. The first saved native proof therefore re-rendered after cleanup and leaked the UI even though its preview looked clean. The final implementation keeps the print surface alive through `afterprint`; both real Save and real Cancel were exercised from Edit, and the app restored cleanly after each.
- Final evidence: `docs/qa/current-native-pdf-export-proof.pdf` is a 28,834-byte, two-page A4 Quartz PDF, SHA-256 `4068f05a100392dd56b9da218e591f46cedc4e5c44d080ef3392691f9e4c38f4`. The print-sheet capture is `docs/qa/current-native-pdf-export-document-only.png`, SHA-256 `8ef1f7dca6ca7bbb5bd3d5a87a90f1d2e17dd53cbbeeb7e12466e01c9a61f84e`.
- Final matrix after reader supervision: **123/123 unit tests, 81/81 Playwright scenarios and 18/18 Rust tests pass; TypeScript/Vite production build, strict Clippy, Rust format check and exact `.app` bundle build pass**. The current DMG wrapper failed after producing the valid app bundle, so no fresh DMG is claimed for this wave. Native Quartz output remains untagged (`Tagged: no`), so structural PDF accessibility is not claimed.

## Adaptive Split follow-up — 2026-08-20

- Root cause: Split Editor used fixed left padding and 58ch content; Split Preview used `500px` plus `margin:0`. The separator changed panel width but the internal canvases did not follow it. Focus Editor inherited the same override.
- Product fix: Editor and Preview now use pane-relative maximum measures and balanced whitespace. Focus uses its own centered writing/reading measures. Narrow panels fill safely instead of preserving unusable blank space.
- Interaction fix: the divider uses Pointer Events and removes its own 8 px track from the ratio calculation. Slash, selection and table overlays observe editor-panel size and remain clamped inside it during resize.
- Browser proof: 1144×768 and 1440×900 at 25:75, 50:50 and 75:25; pane ratios within 1%, Editor center within 5 px, Preview within 2 px, no horizontal overflow, pointer release stable, overlays contained.
- Native proof: real `/Applications` WebKit app on the real Cartés Markdown document. At 25:75 the 760 px Preview had balanced space and the narrow Editor filled its pane; at 50:50 both surfaces stayed centered. Final neutral capture: `docs/qa/current-native-final-adaptive-split.png`.

## Quick Reader supervision and configurable Read — 2026-08-27

- Reproduced defect: native WebKit collapsed the Quick Reader focus track to roughly one character because `overflow-wrap: anywhere` leaked into the three-fragment word layout. The focus fragment then painted outside its track, producing the reported `te` and `fuentes` collisions.
- Product fix: words are segmented by grapheme; left, focus and right fragments have independent no-wrap tracks anchored around the pivot. A real `Range` measurement and resize/font observer reduce only the displayed word when its geometry would exceed the stage.
- Read controls: `A− / A+` change and persist 15–24 px text; `← / →` change and persist a centered 640–1280 px reading canvas in 80 px steps. Invalid stored values are repaired. Read headings scale with the preference.
- Responsive gate: 390, 1024, 1200, 1280, 1299, 1300 and 1440 px were checked. At the native default 1280 px, all six reader controls plus Search and More remain visible and contained; mobile uses a dedicated control row without horizontal overflow.
- Browser visual evidence: `output/playwright/quick-read-te-fixed.png`, `output/playwright/quick-read-fuentes-fixed.png`, `output/playwright/read-content-1440.png`, `output/playwright/read-content-1440-large-wide.png`, `output/playwright/read-tablet-1024.png` and `output/playwright/read-mobile-390.png`.
- Installed-app proof: the exact `/Applications/Md Editor.app` bundle changed `18→19 px` and `960→1040 px`, retained Search/More, restored `18 px / 960 px`, and opened Quick Reader cleanly on the real saved document. Build and installed executables are byte-identical at SHA-256 `21d7fb3028619a3c4c2436127d4045530198fa1fee8223e934e650d5ee89d00a`; strict deep signature verification passes. The previous app is recoverable from `/Users/pedroaldeamas/.Trash/Md Editor before 192e750.app`.
- Adversarial result: no open P0/P1/P2/P3 after the 1200–1299 px header compaction fix. Final proof is 123/123 unit, 81/81 Playwright and 18/18 Rust, plus production and native bundle builds.

## Follow-up polish

- Optional P3: tune the reading pane's final 10–20 px of vertical rhythm if a future design export establishes a deterministic font rather than a system fallback.

final result: passed — product commit `192e750` is verified through browser, responsive, unit, Rust, production-build, exact-app and installed native WebKit gates. `/Applications/Md Editor.app` is the byte-identical tested bundle; only a fresh notarized DMG remains unproven for public distribution.
