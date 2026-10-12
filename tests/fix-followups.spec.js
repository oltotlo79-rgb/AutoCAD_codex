const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test, expect } = require("@playwright/test");

const appUrl = pathToFileURL(path.resolve(__dirname, "..", "index.html")).href;
const runtimeIssues = new WeakMap();

test.beforeEach(async ({ page }) => {
  const issues = { consoleErrors: [], pageErrors: [] };
  runtimeIssues.set(page, issues);

  page.on("console", message => {
    if (message.type() === "error") issues.consoleErrors.push(message.text());
  });
  page.on("pageerror", error => {
    issues.pageErrors.push(error.message);
  });

  await page.goto(appUrl, { waitUntil: "load" });
  await expect(page.locator("svg#canvas")).toBeVisible();
});

test.afterEach(async ({ page }) => {
  const issues = runtimeIssues.get(page);
  expect(issues.pageErrors).toEqual([]);
});

test("ブラウザ自身の印刷(Ctrl+P)でも印刷直前に最新の図面で印刷シートを作る", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 4,
    activePageId: "p1",
    pages: [
      { id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements: [] },
      { id: "p2", name: "P2", size: "A4", orientation: "landscape", frameVariant: "blank", title: {}, elements: [] }
    ]
  }));
  const sheets = page.locator("#printSheets");
  // アプリの印刷ボタンを経由しない印刷でも、beforeprintで全ページ分のシートが用意される。
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await expect(sheets.locator("text", { hasText: "CTRLP-MARK" })).toHaveCount(0);
  const sheetCount = await sheets.evaluate(element => element.children.length);
  expect(sheetCount).toBeGreaterThanOrEqual(2);

  // 図面を変えてから再度印刷すると、前回のシートではなく変更後の内容になる。
  await page.evaluate(() => {
    const target = window.__edsTest.state.pages[0];
    target.elements.push({ id: "t1", type: "text", x: 30, y: 30, w: 40, h: 8, text: "CTRLP-MARK", fontSize: 3.5, layer: "notes" });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await expect(sheets.locator("text", { hasText: "CTRLP-MARK" })).toHaveCount(1);

  // A3面付は印刷中だけ面付けのまま。印刷が終われば(afterprint)、次のCtrl+Pは等倍1面に戻る。
  await page.evaluate(() => { window.print = () => {}; });
  await page.locator("#printTwoUpBtn").click();
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await expect(sheets.locator(".print-sheet")).toHaveCount(2);
  await expect(sheets.locator(".print-sheet").first()).toHaveClass(/page-a3-/);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("afterprint"));
    window.dispatchEvent(new Event("beforeprint"));
  });
  await expect(sheets.locator(".print-sheet").first()).not.toHaveClass(/page-a3-/);
});

test("端子・PLC CSV取込ページの各行は左端の端子小円で受け、監査で未接続扱いにならない", async ({ page }) => {
  const importCsv = async (inputId, name, text) => {
    const before = await page.evaluate(() => window.__edsTest.state.pages.length);
    await page.locator(inputId).setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text, "utf8") });
    await expect.poll(() => page.evaluate(() => window.__edsTest.state.pages.length)).toBeGreaterThan(before);
  };
  await importCsv("#terminalCsvInput", "term.csv", "端子台,端子,線番,信号,接続先\nX1,1,101,運転,PB1\nX1,2,102,停止,PB2\n");
  await importCsv("#plcCsvInput", "plc.csv", "アドレス,入出力,信号,線番\nX000,入力,運転,201\nY000,出力,表示,202\n");

  const rowEnds = await page.evaluate(() => window.__edsTest.state.pages.slice(1).map(p => {
    const terminals = p.elements.filter(e => e.type === "terminal");
    return p.elements.filter(e => e.type === "wire" && !e.ladderRail).map(wire => {
      const [x, y] = wire.points[0];
      // 端子小円の中心(左上+0.9)が配線の左端と一致すること。
      return terminals.some(t => Math.abs(t.x + 0.9 - x) < 0.01 && Math.abs(t.y + 0.9 - y) < 0.01);
    });
  }));
  expect(rowEnds).toEqual([[true, true], [true, true]]);

  for (const index of [1, 2]) {
    await page.locator("#tabbar .page-tab").nth(index).click();
    page.once("dialog", dialog => dialog.accept());
    await page.locator("#auditBtn").click();
    await expect(page.locator("#dialogBody")).toBeVisible();
    await expect(page.locator("#dialogBody")).not.toContainText("配線端点が未接続");
    await page.locator("#dialogClose").click();
  }
});

test("帳票表挿入は最大行数で切った行数をステータスで知らせる", async ({ page }) => {
  const coils = Array.from({ length: 5 }, (_, index) => ({
    id: "c" + index, type: "coil", x: 40, y: 40 + index * 15, w: 10, h: 4.4, tag: "CR" + (index + 1), label: "CR" + (index + 1), layer: "symbols"
  }));
  await page.evaluate(data => window.__edsTest.installProjectData(data), {
    schemaVersion: 4,
    activePageId: "p1",
    pages: [{ id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements: coils }]
  });
  await page.locator("#actionMenu").selectOption("insertReport");
  await page.locator("#insertReportKind").selectOption("component");
  await page.locator("#insertReportRows").fill("3");
  await page.locator("#runInsertReportBtn").click();
  await expect(page.locator("#status")).toContainText("対象5行のうち先頭3行");
  await expect(page.locator("#status")).toContainText("残り2行");
  const table = await page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.type === "table"));
  expect(table.rows).toBe(4);
});
