# Markdown annotations

This module is the sidecar foundation for annotations that should not rewrite
the Markdown source or persist CodeMirror offsets. The current editor UI uses
the simpler canonical Markdown forms `==highlight==` and `++underline++`, so a
toolbar action is immediately visible and survives a normal document save.
The PDF reader has a separate normalized sidecar contract for page-relative
highlight and underline rectangles. This file documents the Markdown source
annotation contract; PDF sidecars use `file.pdf.annotations.json` and are
managed by the Tauri commands `load_pdf_annotations` and
`save_pdf_annotations`.

## Integration contract

1. On an editor selection, call `createAnnotation({ markdown, from, to, type })`.
   The `from`/`to` values are transient UTF-16 offsets from the current editor.
2. Keep the returned annotations in memory and write them beside the document
   with `serializeAnnotationSidecar(annotations, { documentFingerprint })`.
   A sidecar can use a name such as `note.md.annotations.json`.
3. On load, parse with `parseAnnotationSidecar`. For recovery flows where a
   sidecar is optional, use `tryParseAnnotationSidecar` and treat `null` as an
   empty annotation set while surfacing the damaged sidecar to the user.
4. For preview/editor decoration, call
   `resolveAnnotations(currentMarkdown, sidecar.annotations)`. Apply the
   returned `from`/`to` ranges only to the current render; never write those
   ranges back to disk. Unresolved annotations should remain in the sidecar so
   the user can repair them after a larger rewrite.
5. Use `mergeAnnotations(current, incoming)` for local concurrent updates and
   `removeAnnotation(annotations, id)` for explicit deletion. Neither function
   mutates its input.

The persisted shape is intentionally small:

```json
{
  "schemaVersion": 1,
  "documentFingerprint": "optional-source-id",
  "annotations": [
    {
      "id": "highlight-lx-example",
      "type": "highlight",
      "anchor": {
        "text": "selected Markdown",
        "prefix": "context before",
        "suffix": "context after"
      },
      "createdAtMs": 0,
      "updatedAtMs": 0
    }
  ]
}
```

The anchor is text plus context, not an absolute location. Duplicate quotes
are resolved by the best matching context; if whitespace changed, the resolver
also accepts a whitespace-normalized match.
