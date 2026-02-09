import type { SnapshotEntry } from "../types/app";

interface HistoryModalProps {
  open: boolean;
  snapshots: SnapshotEntry[];
  loading: boolean;
  onClose: () => void;
  onRestore: (snapshotId: string) => void;
}

const formatDate = (value: number): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
};

const formatBytes = (value: number): string => {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

export default function HistoryModal({
  open,
  snapshots,
  loading,
  onClose,
  onRestore
}: HistoryModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Version history">
      <div className="modal-card history-modal">
        <header className="modal-header">
          <h2>Version History</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="modal-content">
          {loading ? <p className="modal-empty">Loading snapshots...</p> : null}
          {!loading && snapshots.length === 0 ? (
            <p className="modal-empty">No snapshots yet.</p>
          ) : null}
          {!loading &&
            snapshots.map((snapshot) => (
              <div key={snapshot.id} className="history-item">
                <div>
                  <strong>{formatDate(snapshot.createdAtMs)}</strong>
                  <p>
                    {snapshot.reason} · {formatBytes(snapshot.sizeBytes)}
                  </p>
                </div>
                <button type="button" onClick={() => onRestore(snapshot.id)}>
                  Restore
                </button>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

