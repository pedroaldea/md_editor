interface UserGuideModalProps {
  open: boolean;
  onClose: () => void;
}

export default function UserGuideModal({ open, onClose }: UserGuideModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="User guide">
      <div className="modal-card user-guide-modal">
        <header className="modal-header">
          <h2>User Guide</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="modal-content user-guide-content">
          <p className="user-guide-intro">
            Md Editor is built to help you write and read Markdown quickly without leaving your Mac.
            Everything stays local on your device.
          </p>

          <section className="guide-section">
            <h3>Start quickly</h3>
            <ul>
              <li>Use `New` to start fresh.</li>
              <li>Use `Open` to load a Markdown or text file.</li>
              <li>Use `Save` to keep your latest changes.</li>
              <li>Use `Open Folder` from `More` to browse a workspace.</li>
            </ul>
          </section>

          <section className="guide-section">
            <h3>Write and read</h3>
            <ul>
              <li>Left side is the editor, right side is the live preview.</li>
              <li>Type `/` in the editor to open quick markdown formatting commands.</li>
              <li>Use `Read` for a cleaner reading view.</li>
              <li>Use `Focus` to hide extra UI and concentrate on writing.</li>
              <li>Use `Ultra` + `Reader` settings to tune reading comfort.</li>
            </ul>
          </section>

          <section className="guide-section">
            <h3>Work faster</h3>
            <ul>
              <li>Press `Cmd+K` to open the command palette and jump to actions/files/headings.</li>
              <li>Use workspace search in the sidebar to find text across your folder.</li>
              <li>Save or open a document first when you want to insert images.</li>
              <li>Paste an image from your clipboard or drop an image file into the app window.</li>
              <li>The app stores the image in an `assets/` folder next to your document.</li>
              <li>The app inserts `![alt](relative/path)` markdown for the image automatically.</li>
              <li>Use `History` to restore older local versions of your file.</li>
            </ul>
          </section>

          <section className="guide-section">
            <h3>Useful tools in More</h3>
            <ul>
              <li>`Check Links`: finds broken links in your document.</li>
              <li>`Format Tables`: cleans and aligns markdown tables.</li>
              <li>`Cosmic Focus`: distraction-free word-by-word reading mode.</li>
              <li>`Save As`: save a copy with a new file name.</li>
            </ul>
          </section>

          <section className="guide-section">
            <h3>Export and sharing</h3>
            <ul>
              <li>`Export` lets you create Markdown, HTML, or PDF (Print).</li>
              <li>For PDF, choose `Export` → `PDF (Print)` and then `Save as PDF` in the print dialog.</li>
            </ul>
          </section>

          <section className="guide-section">
            <h3>Safety and recovery</h3>
            <ul>
              <li>The app autosaves while you work.</li>
              <li>Session restore brings back your last workspace and UI state.</li>
              <li>If needed, `History` helps you recover earlier saved snapshots.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
