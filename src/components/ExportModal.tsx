import { useRef } from "react";
import { useDialogFocus } from "../lib/useDialogFocus";
import type { ExportProfile } from "../types/app";

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (profile: ExportProfile) => void;
}

export default function ExportModal({ open, onClose, onSelect }: ExportModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstOptionRef = useRef<HTMLButtonElement | null>(null);
  useDialogFocus(open, dialogRef, onClose, firstOptionRef);

  if (!open) {
    return null;
  }

  return (
    <div ref={dialogRef} className="modal-overlay" role="dialog" aria-modal="true" aria-label="Export options" tabIndex={-1}>
      <div className="modal-card export-modal">
        <header className="modal-header">
          <h2>Export</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="modal-content export-options">
          <button ref={firstOptionRef} type="button" onClick={() => onSelect("clean-markdown")}>
            Clean Markdown (.md)
          </button>
          <button type="button" onClick={() => onSelect("html")}>
            HTML (.html)
          </button>
          <button type="button" onClick={() => onSelect("pdf-print")}>
            PDF (Print)
          </button>
        </div>
      </div>
    </div>
  );
}
