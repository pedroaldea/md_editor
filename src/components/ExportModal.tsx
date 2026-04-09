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
          <button type="button" className="export-option-card" onClick={() => onSelect("clean-markdown")}>
            <strong>Markdown</strong>
            <span>Save a clean `.md` copy of the current document.</span>
          </button>
          <button type="button" className="export-option-card" onClick={() => onSelect("html")}>
            <strong>HTML</strong>
            <span>Export a styled reading copy with local images resolved.</span>
          </button>
          <button type="button" className="export-option-card" onClick={() => onSelect("pdf-print")}>
            <strong>Print / PDF</strong>
            <span>Open the print dialog and use Save as PDF if needed.</span>
          </button>
        </div>
      </div>
    </div>
  );
}
