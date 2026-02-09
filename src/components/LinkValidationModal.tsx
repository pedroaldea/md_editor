import type { LinkValidationIssue } from "../types/app";

interface LinkValidationModalProps {
  open: boolean;
  issues: LinkValidationIssue[];
  checkedExternal: boolean;
  onClose: () => void;
  onJumpToLine: (line: number) => void;
}

export default function LinkValidationModal({
  open,
  issues,
  checkedExternal,
  onClose,
  onJumpToLine
}: LinkValidationModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Link validation report">
      <div className="modal-card validation-modal">
        <header className="modal-header">
          <h2>Link Validation</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="modal-content">
          <p className="validation-meta">
            {issues.length} issue(s) · External checks: {checkedExternal ? "enabled" : "disabled"}
          </p>
          {issues.length === 0 ? <p className="modal-empty">No link issues found.</p> : null}
          {issues.map((issue, index) => (
            <div key={`${issue.line}-${issue.link}-${index}`} className={`validation-item ${issue.severity}`}>
              <div>
                <strong>
                  {issue.severity.toUpperCase()} · Line {issue.line}
                </strong>
                <p>{issue.message}</p>
                <code>{issue.link}</code>
              </div>
              <button type="button" onClick={() => onJumpToLine(issue.line)}>
                Go
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

