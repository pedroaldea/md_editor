# PDF annotations

The PDF reader uses PDF.js only when a PDF is open. It renders a canvas and a
selectable text layer; the original PDF is never rewritten.

Selecting text on one page opens a small contextual toolbar:

- `Highlight` stores a translucent page-relative mark.
- `Underline` stores a mint underline mark.

Marks are saved as `<pdf-file-name>.annotations.json` beside the PDF by the
Tauri commands `load_pdf_annotations` and `save_pdf_annotations`. Browser
fallbacks use localStorage under the same logical key so the component remains
testable without the desktop bridge.

The sidecar stores the page number, normalized rectangles, selected quote and
creation timestamp. Rectangles are normalized to `0..1`, so zoom changes do not
move the mark. Page rendering is lazy: the first page is rendered immediately
and later pages are prepared as they approach the viewport.
