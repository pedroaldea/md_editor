import { test as base, expect, chromium, type BrowserContext, type Worker } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

const EXTENSION = fileURLToPath(new URL("../../chrome-extension", import.meta.url));

// Evaluated inside the extension's service worker, where `chrome` exists.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

const ARTICLE = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Artículo de prueba con un título muy largo que no cabe en un móvil - Mi blog</title>
<style>body{font:18px Georgia;max-width:700px;margin:40px auto}</style></head><body>
<nav><a href="#">Inicio</a> <a href="#">Blog</a> menú de navegación con enlaces</nav>
<article id="post">
  <h1>Leer mejor en la web</h1>
  <p>La lectura biónica resalta el inicio de cada palabra. Así la mirada avanza con menos esfuerzo.</p>
  <p>La lectura rápida muestra una palabra cada vez, con pausas en comas y puntos.</p>
  <pre><code>const codigo = "no se toca";</code></pre>
  <p><input id="campo" value="no se toca"> Formulario intacto.</p>
</article>
<aside>Publicidad lateral irrelevante para la lectura principal del artículo.</aside>
</body></html>`;

const MARKDOWN = `# Documento Markdown

Texto con ==resaltado== y **negrita**. Segunda frase del párrafo.

- uno
- dos

\`\`\`js
const a = 1 == 2;
\`\`\`
`;

type Fixtures = { context: BrowserContext; worker: Worker; origin: string };

const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  origin: async ({}, use) => {
    const server: Server = createServer((request, response) => {
      if (request.url?.endsWith(".md")) {
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        response.end(MARKDOWN);
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(ARTICLE);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    await use(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    await new Promise((resolve) => server.close(resolve));
  },
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      // Optional override when the Playwright-pinned browser is not downloaded.
      executablePath: process.env.PW_CHROMIUM_PATH || undefined,
      headless: true,
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`]
    });
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    await use(worker);
  }
});

/** Sends a page action through the service worker, like the popup and shortcuts do. */
const sendToActiveTab = (worker: Worker, payload: Record<string, unknown>) =>
  worker.evaluate(async (message) => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return chrome.tabs.sendMessage(tab.id!, message);
  }, payload);

test("bionic wraps the article, leaves code and fields alone, follows new content and reverts", async ({ context, worker, origin }) => {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/articulo`);
  await page.bringToFront();

  await expect.poll(() => sendToActiveTab(worker, { type: "mdr:status" })).toMatchObject({ bionic: false });
  expect(await sendToActiveTab(worker, { type: "mdr:toggle-bionic" })).toEqual({ bionic: true });

  await expect(page.locator("article p mdr-w").first()).toBeVisible();
  await expect(page.locator("h1 mdr-f").first()).toHaveText("Le");
  await expect(page.locator("pre mdr-w")).toHaveCount(0);
  await expect(page.locator("#campo")).toHaveValue("no se toca");
  expect(await page.locator("article p").first().textContent()).toContain("La lectura biónica resalta");
  const weight = await page.locator("mdr-f").first().evaluate((node) => getComputedStyle(node).fontWeight);
  expect(weight).toBe("700");

  await page.evaluate(() => {
    const extra = document.createElement("p");
    extra.id = "extra";
    extra.textContent = "Párrafo cargado más tarde";
    document.querySelector("article")!.append(extra);
  });
  await expect(page.locator("#extra mdr-w")).toHaveCount(4);

  expect(await sendToActiveTab(worker, { type: "mdr:toggle-bionic" })).toEqual({ bionic: false });
  await expect(page.locator("mdr-w")).toHaveCount(0);
  expect(await page.locator("#extra").textContent()).toBe("Párrafo cargado más tarde");
  expect(errors).toEqual([]);
});

test("quick read extracts the main text, plays with pauses and closes with Escape", async ({ context, worker, origin }) => {
  const page = await context.newPage();
  await page.goto(`${origin}/articulo`);
  await page.bringToFront();
  await expect.poll(() => sendToActiveTab(worker, { type: "mdr:status" })).toBeTruthy();

  expect(await sendToActiveTab(worker, { type: "mdr:quick-read" })).toEqual({ quickRead: true });
  const overlay = page.locator("#mdr-quickread-host .overlay");
  await expect(overlay).toBeVisible();
  const word = page.locator("#mdr-quickread-host .word");
  await expect(word).toHaveText("Leer");
  await expect(page.locator("#mdr-quickread-host .pivot")).toHaveText("e");
  await expect(page.locator("#mdr-quickread-host .meta")).toContainText("1 / ");
  // Paused state shows the surrounding sentence; nav and aside are not part of it.
  await expect(page.locator("#mdr-quickread-host .context")).toHaveText(/Leer mejor en la web/);
  const total = await page.locator("#mdr-quickread-host .progress").getAttribute("max");
  expect(Number(total) + 1).toBe(37);

  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#mdr-quickread-host .wpm")).toHaveText("380 ppm");
  await page.keyboard.press("Space");
  await expect(page.locator("#mdr-quickread-host [data-action='play']")).toHaveText("Pausa");
  await expect(word).not.toHaveText("Leer");
  await page.keyboard.press("Space");
  await expect(page.locator("#mdr-quickread-host [data-action='play']")).toHaveText("Leer");

  // 390 px phone width: nothing overflows and the close button stays reachable.
  await page.setViewportSize({ width: 390, height: 760 });
  const fit = await page.evaluate(() => {
    const overlay = document.getElementById("mdr-quickread-host")!.shadowRoot!.querySelector(".overlay")!;
    const close = overlay.querySelector("[data-action='close']")!.getBoundingClientRect();
    return { overflow: overlay.scrollWidth - overlay.clientWidth, closeRight: close.right };
  });
  expect(fit.overflow).toBe(0);
  expect(fit.closeRight).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.keyboard.press("End");
  await expect(word).toHaveText("intacto.");
  await page.keyboard.press("Escape");
  await expect(page.locator("#mdr-quickread-host")).toHaveCount(0);

  // Speed persisted to chrome.storage.sync for the next session.
  const stored = await worker.evaluate(() => chrome.storage.sync.get("settings"));
  expect(stored.settings.wpm).toBe(380);
});

test("quick read reads only the selection when there is one", async ({ context, worker, origin }) => {
  const page = await context.newPage();
  await page.goto(`${origin}/articulo`);
  await page.bringToFront();
  await expect.poll(() => sendToActiveTab(worker, { type: "mdr:status" })).toBeTruthy();
  await sendToActiveTab(worker, { type: "mdr:quick-read", text: "Solo estas cuatro palabras." });
  await expect(page.locator("#mdr-quickread-host .title")).toHaveText("Selección");
  await expect(page.locator("#mdr-quickread-host .meta")).toContainText("1 / 4");
});

test("raw .md files render as a sanitized reader with bionic and quick read", async ({ context, origin }) => {
  const page = await context.newPage();
  await page.goto(`${origin}/notas/documento.md`);
  await expect(page.locator("article h1")).toHaveText("Documento Markdown");
  await expect(page).toHaveTitle("Documento Markdown");
  await expect(page.locator("article mark")).toHaveText("resaltado");
  await expect(page.locator("article pre code")).toHaveText("const a = 1 == 2;");
  await expect(page.locator("article li")).toHaveCount(2);

  await page.getByRole("button", { name: "Bionic" }).click();
  await expect(page.getByRole("button", { name: "Bionic" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("article p mdr-w").first()).toBeVisible();
  await expect(page.locator(".mdr-bar mdr-w")).toHaveCount(0);

  await page.getByRole("button", { name: "Fuente" }).click();
  await expect(page.locator("pre.raw")).toContainText("==resaltado==");
  await page.getByRole("button", { name: "Fuente" }).click();

  await page.getByRole("button", { name: "Lectura rápida" }).click();
  await expect(page.locator("#mdr-quickread-host .word")).toHaveText("Documento");
});

test("popup settings persist and reach open pages live", async ({ context, worker, origin }) => {
  const page = await context.newPage();
  await page.goto(`${origin}/articulo`);
  await expect.poll(() => page.evaluate(() => Boolean(document.querySelector("article")))).toBe(true);
  await page.bringToFront();
  await expect.poll(() => sendToActiveTab(worker, { type: "mdr:status" })).toBeTruthy();
  await sendToActiveTab(worker, { type: "mdr:set-bionic", value: true });
  await expect(page.locator("mdr-w").first()).toBeVisible();

  const extensionId = new URL(worker.url()).host;
  const popup = await context.newPage();
  const popupErrors: string[] = [];
  popup.on("pageerror", (error) => popupErrors.push(error.message));
  await popup.setViewportSize({ width: 340, height: 640 });
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await expect(popup.locator("output[for='wpm']")).toHaveText("360 ppm");
  // "La" is below the default 3-letter minimum, so "lectura" is the first emphasised word.
  await expect(popup.locator("#sample b").first()).toHaveText("lec");

  await popup.locator("#bionicWeight").fill("900");
  await expect(popup.locator("output[for='bionicWeight']")).toHaveText("900");
  await popup.locator("#bionicFixation").fill("60");
  await expect(popup.locator("#sample b").first()).toHaveText("lect");
  await popup.getByText("Oscuro").click();
  await popup.screenshot({ path: "test-results/extension-popup-dark.png" });

  await expect
    .poll(() => page.locator("mdr-f").first().evaluate((node) => getComputedStyle(node).fontWeight))
    .toBe("900");
  await expect(page.locator("article p").first().locator("mdr-f").first()).toHaveText("lect");
  expect(popupErrors).toEqual([]);

  const stored = await worker.evaluate(() => chrome.storage.sync.get("settings"));
  expect(stored.settings).toMatchObject({ bionicWeight: 900, bionicFixation: 0.6, theme: "dark" });
});

test("on-demand injection is idempotent for tabs opened before install", async ({ context, worker, origin }) => {
  const page = await context.newPage();
  await page.goto(`${origin}/articulo`);
  await page.bringToFront();
  await expect.poll(() => sendToActiveTab(worker, { type: "mdr:status" })).toBeTruthy();
  // The service worker injects these same files when a tab has no content script;
  // injecting over a live one must not duplicate listeners (a double toggle would cancel out).
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      files: ["content/core.js", "content/bionic.js", "content/quickread.js", "content/main.js"]
    });
  });
  expect(await sendToActiveTab(worker, { type: "mdr:toggle-bionic" })).toEqual({ bionic: true });
  await expect(page.locator("mdr-w").first()).toBeVisible();
  expect(await sendToActiveTab(worker, { type: "mdr:status" })).toMatchObject({ bionic: true });
});
