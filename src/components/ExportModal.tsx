import type { ExportProfile } from "../types/app";

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (profile: ExportProfile) => void;
}

export default function ExportModal({ open, onClose, onSelect }: ExportModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Export options">
      <div className="modal-card export-modal">
        <header className="modal-header">
          <h2>Export</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="modal-content export-options">
          <button type="button" onClick={() => onSelect("clean-markdown")}>
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

