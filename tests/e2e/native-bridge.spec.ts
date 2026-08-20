import { expect, test, type Page } from "@playwright/test";

interface NativeCall {
  cmd: string;
  args: Record<string, unknown>;
}

const installNativeBridgeMock = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const testWindow = window as Window & {
      __TAURI_INTERNALS__?: Record<string, unknown>;
      nativeCalls?: NativeCall[];
      nativeConflict?: boolean;
      convertedAssetPaths?: string[];
    };
    const callbacks = new Map<number, (...args: unknown[]) => unknown>();
    let callbackId = 0;
    testWindow.nativeCalls = [];
    testWindow.convertedAssetPaths = [];

    const activeContent = "# Alpha\n\nWorkspace needle.\n\n## Destination\n\nEnd.";
    const invoke = async (cmd: string, args: Record<string, unknown> = {}) => {
      testWindow.nativeCalls?.push({ cmd, args });
      switch (cmd) {
        case "plugin:event|listen":
          return 1;
        case "plugin:event|unlisten":
        case "store_recovery_draft":
        case "save_session_state":
        case "create_snapshot":
          return null;
        case "load_recovery_draft":
        case "take_pending_open_path":
          return null;
        case "load_session_state":
          if (localStorage.getItem("native-scenario") === "pdf-session") {
            return {
              workspaceFolder: null,
              activePath: "/workspace/report.pdf",
              draftContent: null,
              editorActivePath: "/workspace/alpha.md",
              editorDraftContent: "# Draft behind PDF\n\nStill here.",
              readMode: false,
              focusMode: false,
              focusPreviewOnly: false,
              splitRatio: 0.542,
              readerPalette: "void",
              ultraReadEnabled: false,
              ultraReadFixation: 0.45,
              ultraReadMinWordLength: 4,
              ultraReadFocusWeight: 760,
              activeBlockIndex: 0,
              previewScrollRatio: 0,
              editorScrollRatio: 0
            };
          }
          if (localStorage.getItem("native-scenario") === "stale-draft") {
            return {
              workspaceFolder: null,
              activePath: "/workspace/missing.md",
              draftContent: "# Recovered after deletion\n\nUnsaved work survives.",
              editorActivePath: "/workspace/missing.md",
              editorDraftContent: "# Recovered after deletion\n\nUnsaved work survives.",
              readMode: false,
              focusMode: false,
              focusPreviewOnly: false,
              splitRatio: 0.542,
              readerPalette: "void",
              ultraReadEnabled: false,
              ultraReadFixation: 0.45,
              ultraReadMinWordLength: 4,
              ultraReadFocusWeight: 760,
              activeBlockIndex: 0,
              previewScrollRatio: 0,
              editorScrollRatio: 0
            };
          }
          return {
            workspaceFolder: "/workspace",
            activePath: "/workspace/alpha.md",
            draftContent: null,
            editorActivePath: "/workspace/alpha.md",
            editorDraftContent: null,
            readMode: false,
            focusMode: false,
            focusPreviewOnly: false,
            splitRatio: 0.542,
            readerPalette: "void",
            ultraReadEnabled: false,
            ultraReadFixation: 0.45,
            ultraReadMinWordLength: 4,
            ultraReadFocusWeight: 760,
            activeBlockIndex: 0,
            previewScrollRatio: 0,
            editorScrollRatio: 0,
            editorSettings: {
              fontSize: 16,
              lineNumbers: true,
              wordWrap: true,
              highlightActiveLine: true
            }
          };
        case "list_markdown_files":
          return [
            { path: "/workspace/alpha.md", name: "alpha.md", relativePath: "alpha.md" },
            { path: "/workspace/beta.md", name: "beta.md", relativePath: "beta.md" }
          ];
        case "open_document":
          if (args.path === "/workspace/missing.md") {
            throw { code: "FILE_NOT_FOUND", message: "Document does not exist" };
          }
          return {
            path: String(args.path),
            content: args.path === "/workspace/beta.md" ? "# Beta\n\nSearch destination." : activeContent,
            mtimeMs: 100
          };
        case "search_workspace":
          return [{
            path: "/workspace/beta.md",
            name: "beta.md",
            relativePath: "beta.md",
            line: 3,
            snippet: "Search destination."
          }];
        case "list_snapshots":
          return [{ id: "snapshot-1", createdAtMs: 1_800_000_000_000, reason: "manual", sizeBytes: 42 }];
        case "load_snapshot":
          return { path: String(args.path), content: "# Restored snapshot\n\nHistorical text.", mtimeMs: 100 };
        case "validate_links":
          return {
            checkedExternal: false,
            issues: [{ line: 3, link: "missing.md", severity: "error", message: "Target file does not exist" }]
          };
        case "plugin:dialog|save":
          return String((args.options as { defaultPath?: string } | undefined)?.defaultPath ?? "/tmp/export.md");
        case "plugin:dialog|open":
          return "/outside/process-diagram.png";
        case "write_text_file":
          return { path: String(args.path), mtimeMs: 200, savedAtMs: 300 };
        case "save_document":
          if (testWindow.nativeConflict) {
            throw {
              code: "CONFLICT",
              message: "File changed on disk. Reopen or Save As to avoid overwriting."
            };
          }
          return { path: String(args.path), mtimeMs: 200, savedAtMs: 300 };
        case "save_image_asset":
          return { path: "/workspace/assets/clipboard.png", relativePath: "assets/clipboard.png" };
        case "import_image_asset":
          return { path: "/workspace/assets/process-diagram.png", relativePath: "assets/process-diagram.png" };
        case "read_pdf_document":
          return [37, 80, 68, 70, 45, 49, 46, 55];
        case "read_image_asset":
          return {
            mimeType: "image/svg+xml",
            base64Data: btoa("<svg xmlns='http://www.w3.org/2000/svg' width='240' height='90'><rect width='240' height='90' fill='#155f9f'/></svg>")
          };
        default:
          return null;
      }
    };

    testWindow.__TAURI_INTERNALS__ = {
      invoke,
      convertFileSrc: (path: string) => {
        testWindow.convertedAssetPaths?.push(path);
        if (path.endsWith("preview diagram.svg")) {
          return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='120'%3E%3Crect width='320' height='120' fill='%23155f9f'/%3E%3Ctext x='160' y='68' text-anchor='middle' fill='white'%3EIMAGE OK%3C/text%3E%3C/svg%3E";
        }
        return `asset://localhost/${encodeURIComponent(path)}`;
      },
      transformCallback: (callback: (...args: unknown[]) => unknown) => {
        callbackId += 1;
        callbacks.set(callbackId, callback);
        return callbackId;
      },
      unregisterCallback: (id: number) => callbacks.delete(id),
      runCallback: (id: number, data: unknown) => callbacks.get(id)?.(data),
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" }
      }
    };
  });
};

const openMore = async (page: Page): Promise<void> => {
  const details = page.locator(".top-more");
  if (!(await details.evaluate((element) => element.hasAttribute("open")))) {
    await details.locator(":scope > summary").click();
  }
};

test.beforeEach(async ({ page }) => {
  await installNativeBridgeMock(page);
  await page.goto("/");
  await expect(page.getByText("alpha.md", { exact: true })).toBeVisible();
});

test("runs workspace search and history restoration through the native bridge", async ({ page }) => {
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByLabel("Search markdown files in workspace").fill("destination");
  await expect(page.getByRole("button", { name: /beta\.md.*Line 3/s })).toBeVisible();
  await page.getByRole("button", { name: /beta\.md.*Line 3/s }).click();
  await expect(page.locator(".cm-content")).toContainText("Search destination");

  await openMore(page);
  await page.getByRole("button", { name: "History" }).click();
  const history = page.getByRole("dialog", { name: "Version history" });
  await history.getByRole("button", { name: "Restore" }).click();
  await expect(page.locator(".cm-content")).toContainText("Restored snapshot");
  await expect(page.getByRole("button", { name: "Unsaved" })).toBeVisible();

  const calls = await page.evaluate(() => (window as Window & { nativeCalls?: NativeCall[] }).nativeCalls ?? []);
  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ cmd: "search_workspace" }),
    expect.objectContaining({ cmd: "load_snapshot", args: expect.objectContaining({ snapshotId: "snapshot-1" }) })
  ]));
});

test("validates links and writes Markdown and HTML exports through native commands", async ({ page }) => {
  await openMore(page);
  await page.getByRole("button", { name: "Check Links" }).click();
  const validation = page.getByRole("dialog", { name: "Link validation report" });
  await expect(validation).toContainText("Target file does not exist");
  await validation.getByRole("button", { name: "Close" }).click();

  for (const label of ["Clean Markdown (.md)", "HTML (.html)"]) {
    await openMore(page);
    await page.getByRole("button", { name: "Export" }).click();
    await page.getByRole("dialog", { name: "Export options" }).getByRole("button", { name: label }).click();
  }

  const calls = await page.evaluate(() => (window as Window & { nativeCalls?: NativeCall[] }).nativeCalls ?? []);
  const writes = calls.filter((call) => call.cmd === "write_text_file");
  expect(writes).toHaveLength(2);
  expect(String(writes[0].args.content)).toContain("# Alpha");
  expect(String(writes[1].args.content)).toContain("<!doctype html>");
  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({
      cmd: "validate_links",
      args: expect.objectContaining({ documentPath: "/workspace/alpha.md", checkExternal: false })
    })
  ]));
});

test("preserves conflict protection and inserts pasted images through native commands", async ({ page }) => {
  await page.evaluate(() => {
    (window as Window & { nativeConflict?: boolean }).nativeConflict = true;
  });
  await page.locator(".cm-content").click();
  await page.keyboard.insertText(" changed");
  await expect(page.getByRole("button", { name: "Error: CONFLICT" })).toBeVisible({ timeout: 3_000 });

  await page.evaluate(() => {
    (window as Window & { nativeConflict?: boolean }).nativeConflict = false;
    const editor = document.querySelector<HTMLElement>(".cm-content");
    if (!editor) throw new Error("Editor not found");
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([new Uint8Array([137, 80, 78, 71])], "clipboard.png", {
      type: "image/png"
    }));
    editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  });

  await expect(page.locator(".cm-content")).toContainText("![clipboard](assets/clipboard.png)");
  const calls = await page.evaluate(() => (window as Window & { nativeCalls?: NativeCall[] }).nativeCalls ?? []);
  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({
      cmd: "save_document",
      args: expect.objectContaining({ expectedMtimeMs: 100 })
    }),
    expect.objectContaining({
      cmd: "save_image_asset",
      args: expect.objectContaining({
        documentPath: "/workspace/alpha.md",
        fileName: "clipboard.png",
        mimeType: "image/png"
      })
    })
  ]));
});

test("chooses and imports an image through the native slash command", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.insertText("\n/img");
  await expect(page.getByRole("listbox", { name: "Slash commands" })).toBeVisible();
  await page.keyboard.press("Enter");

  await expect(page.locator(".cm-content")).toContainText(
    "![process diagram](assets/process-diagram.png)"
  );
  const calls = await page.evaluate(() => (
    window as Window & { nativeCalls?: NativeCall[] }
  ).nativeCalls ?? []);
  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ cmd: "plugin:dialog|open" }),
    expect.objectContaining({
      cmd: "import_image_asset",
      args: {
        documentPath: "/workspace/alpha.md",
        sourcePath: "/outside/process-diagram.png"
      }
    })
  ]));
});

test("resolves and displays Markdown-relative images through the native asset bridge", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText("# Local image\n\n![Process diagram](assets/preview%20diagram.svg)");
  await page.getByRole("button", { name: "Read", exact: true }).click();

  const image = page.getByRole("img", { name: "Process diagram" });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(320);
  const convertedPaths = await page.evaluate(() => (
    window as Window & { convertedAssetPaths?: string[] }
  ).convertedAssetPaths ?? []);
  expect(convertedPaths).toContain("/workspace/assets/preview diagram.svg");
  await page.screenshot({ path: "/private/tmp/md-editor-relative-image.png", animations: "disabled" });
});

test("falls back to validated native bytes when an image is outside the asset scope", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText("# External volume image\n\n![Fallback diagram](assets/fallback%20diagram.png)");
  await page.getByRole("button", { name: "Read", exact: true }).click();

  const image = page.getByRole("img", { name: "Fallback diagram" });
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(240);
  const calls = await page.evaluate(() => (
    window as Window & { nativeCalls?: NativeCall[] }
  ).nativeCalls ?? []);
  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({
      cmd: "read_image_asset",
      args: { path: "/workspace/assets/fallback diagram.png" }
    })
  ]));
});

test("recovers a dirty session as untitled when its backing file was deleted", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("native-scenario", "stale-draft"));
  await page.reload();

  await expect(page.getByText("untitled.md", { exact: true })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("Recovered after deletion");
  await expect(page.getByRole("button", { name: "Unsaved" })).toBeVisible();
  await expect(page.getByText("Recovered unsaved draft from missing file", { exact: true })).toBeVisible();

  const calls = await page.evaluate(() => (window as Window & { nativeCalls?: NativeCall[] }).nativeCalls ?? []);
  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({
      cmd: "save_session_state",
      args: expect.objectContaining({
        state: expect.objectContaining({
          activePath: null,
          draftContent: "# Recovered after deletion\n\nUnsaved work survives."
        })
      })
    })
  ]));
});

test("restores the Markdown draft retained behind an active PDF session", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("native-scenario", "pdf-session"));
  await page.reload();

  await expect(page.getByText("report.pdf", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close PDF and return to editor" }).click();
  await expect(page.getByText("alpha.md", { exact: true })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("Draft behind PDF");
  await expect(page.getByRole("button", { name: "Unsaved" })).toBeVisible();
});
