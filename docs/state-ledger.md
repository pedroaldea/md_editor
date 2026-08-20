# State Ledger — ASCII Minimal Revamp

Updated: 2026-08-20

## Goal

- Rebuild the application shell around the selected Option 2 direction: an ultra-minimal, editorial, ASCII-inspired workspace with a quiet split editor/preview, thin rules, restrained blue accent and monospaced interface labels.
- Borrow the compact menu treatment from Option 3.
- Keep explicit light and dark modes available at all times.
- In the Markdown editor, typing `/` in a valid context must open a keyboard- and mouse-operable formatting menu.
- Preserve the useful Markdown/PDF capabilities while removing or hiding chrome that does not support writing, reading or navigation.
- Extend the finished shell without visual drift: reversible opaque PDF redaction, richer `/` blocks with native images, and a contextual table editor.
- Make every Split/Focus surface use the panel it actually owns: resizing must recenter Editor, Preview and contextual menus instead of leaving them anchored to the left.

## Current Known State

- Repo: `/Users/pedroaldeamas/Desktop/Coding/md_editor`
- Branch: `main`
- Product commit: `e3385e4` (`origin/main`, `feat: revamp Markdown and PDF workspace`).
- Release tree: all revamp, PDF, Markdown, test, fixture and visual-evidence changes are captured in the product commit; this ledger and `design-qa.md` are the final documentation closeout. Playwright session caches are intentionally ignored.
- Browser QA service: stopped cleanly after QA; `npm run dev -- --host 127.0.0.1` restores the local preview at `http://127.0.0.1:1420/`. Only the final installed app from `/Applications` remains running as PID 10534, left on the real saved Markdown document in light Split mode at 50:50.
- The selected ASCII redesign is implemented as a full-bleed 92 px rail, 64 px command header, 54:46 default editor/reader split and 55 px status line. Structural surfaces are square and flat; the former card/pill/glass silhouette is gone.
- The default `/` menu exposes 12 compact actions (Heading, Bullet list, Checklist, Quote, Code block, Table, Image, Link, Callout, Divider, Highlight and Underline). Ten advanced actions remain searchable, for 22 total commands.
- `/image` opens a native image picker/importer in Tauri and inserts a portable relative Markdown asset path; browser preview inserts an explicit placeholder. Existing paste/drop flows remain intact.
- A square contextual table toolbar follows the active cell and supports add/remove row, add/remove column, alignment cycling and formatting; on mobile it becomes a six-action 44 px bottom toolbar.
- `ThemeMode` is now the explicit persisted `light | dark` contract. The main chrome, CodeMirror and reading surface switch together.
- Markdown, Quick Read and PDF.js flows are integrated in the new shell. PDF highlight/underline/redaction, marks navigation/removal, mobile fit-width and corrupt-file errors are covered.
- PDF redaction is intentionally reversible and non-destructive: the overlay is fully opaque and the sidecar stores `[redacted]`, but the original PDF bytes and underlying selectable text are unchanged.
- The native PDF reader now transports validated bytes through Tauri, uses a portable selectable-text renderer in the macOS WebView, and installs only the missing Promise/ReadableStream standards needed by PDF.js 6.
- The native macOS startup now ignores and clears a stale recent-document path instead of presenting `FILE_NOT_FOUND`. Markdown and PDF session targets are checked before restoration.
- Markdown preview assets now resolve relative or absolute local image paths before rendering. A validated native fallback covers images outside the macOS asset scope without widening filesystem access; remote, data, blob and already converted URLs remain unchanged.
- Read mode uses a centered 960 px reading canvas. Split now measures each live panel: Editor centers gutter plus source up to 760 px, Preview centers up to 760 px, and both fill naturally when the panel is narrower. Focus Editor/Preview follow the same rule with their own measures; mobile keeps explicit edge padding.
- The separator uses Pointer Events and the exact width remaining after its 8 px track, so mouse, pen and touch share one resize path. Slash, selection and table overlays observe panel-size changes, clamp to the panel, and reposition while resizing.
- Fenced `mermaid` blocks render as diagrams in light and dark modes, including labels containing literal `\\n`; invalid syntax falls back to a visible error. For WebKit layout, labelled dotted feedback edges are temporarily normalized to solid and their dotted stroke is restored in the generated SVG.
- Mermaid remains optional: its renderer and diagram-specific chunks load only when a diagram is near the viewport. The preview memoizes its injected HTML so scroll-progress rerenders do not erase an already generated SVG. `/diagram` inserts a valid starter flowchart.
- Final P1 closures: Mermaid edge detection ignores operator-like text inside labels, quoted strings, pipe labels and comments, so `---` cannot steal a dotted feedback edge; browser E2E covers the exact `1/3` path. Callout blocks render as callouts, and a one-column table inserted from `/` survives the edit/preview roundtrip.

## Last Known Good State

- Verified release product: `e3385e4`, synchronized with `origin/main`. Markdown editing/preview, reading modes, Quick Read, annotations, PDF.js and native bridges passed the final deterministic/browser/native matrix on 2026-08-20.
- Pre-revamp baseline: `ea40c6a` (`Fix print pagination flow`). It remains reachable in Git history; no reset or history rewrite was used.

## What Changed Before This Decision

- The earlier revamp reorganized controls, introduced dark/paper/mist tokens, reading modes, annotations, Quick Read and a PDF.js reader.
- It removed the older cosmic overlay and user-guide modal and added substantial frontend, Tauri, PDF and test work.
- It did not move far enough from the V1 visual structure. The same top-toolbar/sidebar/panel grammar remained recognizable, so Pedro correctly judged it as visually too similar.

## Suspected Failure Point

- Visual changes were applied mainly as styling and control regrouping instead of replacing the information architecture and silhouette.
- The top bar still exposes many equally weighted controls; the sidebar remains a conventional content panel; rounded surfaces, pills and the mint/dark identity dominate.
- “Theme” is currently modeled as reader palettes rather than a simple, persistent light/dark application control.
- Functional test volume was presented as proof of design completion, but tests do not prove that the product is materially different, elegant or aligned with the selected reference.

## Files and Systems in Scope

- Shell and navigation: `src/App.tsx`, `src/components/TopBar.tsx`, `src/components/FileSidebar.tsx`.
- Editor and reading surface: `src/components/EditorPane.tsx`, `src/components/PreviewPane.tsx`, `src/components/SlashMenu.tsx`.
- Visual system: `src/styles/tokens.css`, `src/styles/app.css`, `index.html`.
- State/contracts: `src/state/documentStore.ts`, `src/types/app.ts`.
- Regression coverage: `tests/e2e/app.spec.ts`, relevant unit tests, and PDF tests.
- PDF functionality and Tauri commands are preservation constraints, not redesign targets unless their chrome must be aligned.

## Decisions Made

- Option 2 is the primary composition and visual direction.
- Option 3 contributes the menu/navigation treatment only.
- The supplied image is a visual reference, not an instruction document or a pixel-copy requirement.
- The application must offer explicit light and dark themes; neither is a separate product mode.
- `/` remains a smart contextual command: it opens formatting choices at valid block positions, supports keyboard/mouse use, and must not trigger inside URLs.
- Minimalism means fewer visible decisions and stronger hierarchy, not removal of useful core behavior.
- Existing user work was preserved in `e3385e4`; no reset, history rewrite or unrelated deletion was used.

## Evidence Collected

- Git: branch `main`; product commit `e3385e4` is published on `origin/main`. The pre-revamp commit remains in history and no reset or force-push was used.
- Visual QA: exact dark and light source/implementation comparisons plus desktop, mobile, Focus and PDF captures are recorded in `design-qa.md`; final result is `passed` with no actionable P0/P1/P2 mismatch.
- Browser: final preview has no horizontal overflow at 320, 390 or 430 px; rail/drawer exposes Library, Outline and Command; light/dark themes are effective and persistent.
- Unit suite: 108/108 frontend tests pass across 19 files.
- Browser suite: 73/73 Playwright scenarios pass, including Split geometry at 25:75, 50:50 and 75:25 across 1144/1440 px; real pointer release; adaptive Slash/selection/table overlays; Focus geometry; the exact Mermaid `1/3` path; mobile; native bridge; PDF redaction and performance.
- Performance smoke: initial load plus theme/Edit/Split/Read transitions passed five consecutive runs; every core transition stayed below the 200 ms guardrail.
- Rust suite: 18/18 tests pass; `cargo fmt --check` and strict Clippy pass.
- Security: `npm audit` reports 0 vulnerabilities after updating DOMPurify and the compatible build/test toolchain.
- Build: production TypeScript/Vite build passes. Initial JavaScript is 274.60 kB (86.30 kB gzip); Mermaid remains outside initial preload in lazy core/diagram chunks, alongside lazy editor and PDF code.
- Native package: Tauri release and DMG build pass. The definitive DMG is 6,211,456 bytes; SHA-256 is `c2ddce459e487b1b50eeba0034dfdd1a3f86a01800d4417961fb79d1c05f2755`.
- Package integrity: the DMG verifies as valid; its ARM64 `.app` passes strict deep `codesign` verification. The installed and mounted executables share SHA-256 `8b7008c174551be55c40e899955b3523199618c38c0cc4089d6900fdd385c54d`.
- Native Split smoke: the final installed `/Applications` app was launched as the only running instance, PID 10534. On the real saved Markdown document, pointer drag reached 25:75, keyboard Home/Shift+Arrow reached 50:50, both pane contents recentered, and the app stayed Saved/light. Evidence: `docs/qa/current-native-final-split-25-75.png`, `docs/qa/current-native-final-split-50-50.png` and neutral final `docs/qa/current-native-final-adaptive-split.png`.
- Definitive native PDF proof repeated on the final package: the installed app opened the real one-page fixture and reported `PDF loaded · 1 page`. After focusing a text chunk, `R` produced `Redacted · page 1`, mark count `1`, sidebar `p. 1 [redacted]` and a visible opaque band. `Remove` returned the count to `0`; the empty generated sidecar was deleted, the PDF was closed, and the app was left on the real Markdown document in Saved/Read/light state. Evidence: `/private/tmp/md-editor-final-native-redact.png` and reproducible fixture `tests/fixtures/md-editor-redaction-smoke.pdf`.
- Current preview-media wave covers the exact complex Mermaid source, dotted-edge preservation, invalid-diagram fallback, `/diagram`, wide Read/Split geometry, 390 px mobile layout and native image fallback outside asset scope.
- Current build: production TypeScript/Vite build and `git diff --check` pass. Mermaid is absent from the initial preload path and remains in lazy diagram chunks.
- Current visual evidence: `/private/tmp/md-editor-relative-image.png`, `/private/tmp/md-editor-mermaid-read.png` and `/private/tmp/md-editor-read-wide.png`.
- Final full-suite rerun: **108/108 unit tests across 19 files, 73/73 Playwright scenarios and 18/18 Rust tests pass; strict Clippy, format check, production build, audit 0 and diff check pass**.
- Definitive native Edit proof: the installed app uses the full writing desk at the exact reported 1144 px window width. Browser geometry asserts an editable column of at least 840 px with balanced outer gaps, no horizontal overflow and a narrower Split surface. Evidence: `/private/tmp/md-editor-after-edit-width.png` (before: `/private/tmp/md-editor-before-edit-width.png`).
- Definitive native media smoke repeated on the final package: the sole running app is the installed `/Applications` build whose binary matches the mounted DMG. It opened `Estrategia_IA_Cartes_2026-2027.md` with its local image and complex Mermaid visible together. Evidence: `/private/tmp/md-editor-final-native-media.png`.
- Definitive native Read smoke repeated on the final package: the wide reader remained centered and the installed app was left in light Read mode on the saved real document. Evidence: `/private/tmp/md-editor-final-native-read.png`.

## Requirement → Proof Matrix

| Requirement | Proof | Result |
| --- | --- | --- |
| Materially different ultra-minimal shell | 1:1 dark/light comparisons in `docs/qa/comparison-current-*.png` | PASS |
| Persistent light and dark modes | store unit test + repeated browser persistence scenario + native toggle smoke | PASS |
| `/` formatting menu, images and table tools | unit transforms + native-bridge picker/import + keyboard/mouse/tap/mobile E2E + one-column table roundtrip | PASS |
| Markdown edit/read/focus/Quick Read | unit, accessibility, performance and repeated E2E | PASS |
| PDF render/select/redact/persist/remove | unit + repeated browser PDF E2E + final installed-app WebKit create/visual/remove/cleanup smoke | PASS |
| Native save/search/history/export/images/recovery | Tauri invoke contract + Rust roundtrips + native-bridge E2E | PASS |
| Mobile 320–430 px without overflow | exact viewport, drawer, touch and long-document slash E2E | PASS |
| Adaptive Split/Focus geometry | 25:75, 50:50 and 75:25 browser measurements, pointer/keyboard resize, overlay bounds and final installed-app captures | PASS |
| Lightweight/clean package | lazy Mermaid/editor/PDF chunks, 6,211,456-byte DMG, strict Clippy, audit 0 | PASS |
| Local Markdown images inside/outside asset scope | resolver units + validated Rust bridge + native-bridge data-URI assertion + final installed-app visual proof | PASS |
| Mermaid light/dark, complex `\\n`, dotted feedback, protected labels/quotes/pipes/comments, exact `1/3`, errors and `/diagram` | unit + exact browser source + lazy-build inspection + final installed-app visual proof | PASS |
| Callout block rendering | Markdown unit + browser render scenario | PASS |
| Wide centered Read plus adaptive Split/Focus | geometry E2E at desktop/390 px + final installed-app Split/Read captures | PASS |

## Open Risks

- CodeMirror is a 506.72 kB lazy chunk and the PDF worker is 2.22 MB. They do not inflate the initial shell, but first-open latency on older hardware is not benchmarked.
- The local package is ad-hoc signed and integrity-verified, but public distribution still requires Pedro's Apple Developer identity and notarization credentials. No deployment or external release was attempted.
- Opaque redaction is a reading/markup aid, not cryptographic sanitization: exporting or sharing the original PDF still exposes the original content. Secure destructive redaction would require a separate flatten-and-remove export flow with its own proof gate.

## Next Action

1. Pedro inspects the installed app, visual comparison and final DMG from product commit `e3385e4`.
2. Public sharing remains a separate explicit decision: Developer ID/notarization for macOS or a selected web deployment target.

## Stop Condition

- Stop and do not call the revamp complete if the result still resembles the previous rounded dark-mint shell, if any parallel edit is lost, or if required functionality regresses.
- Closure requires: a visibly distinct ASCII/editorial shell; explicit working light/dark modes; working `/` formatting menu; no desktop/mobile overflow; clean browser console; green deterministic test/build suite; native launch proof; and fresh visual evidence for Markdown and PDF flows.
- Current verdict: implementation, browser, Rust, package integrity and final installed-app media/Read/PDF gates pass. Product commit `e3385e4` is on `origin/main`; this documentation closeout follows it. Public notarized distribution remains a separate release authorization, and no deployment was performed.
