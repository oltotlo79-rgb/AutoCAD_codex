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

test("パネル見出しは部品名の英字を大文字にせず、配線接続点のない要素のミニツールバーに「配線」を出さない", async ({ page }) => {
  await page.evaluate(data => window.__edsTest.installProjectData(data), {
    schemaVersion: 4,
    activePageId: "p1",
    pages: [{ id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements: [
      { id: "c1", type: "contactNO", x: 40, y: 60, w: 10, h: 4.4, label: "CR1", layer: "symbols" },
      { id: "tbl", type: "table", x: 40, y: 120, w: 60, h: 30, rows: 2, cols: 2, cellText: "A,B\nC,D", layer: "notes" }
    ] }]
  });
  await page.evaluate(() => window.__edsTest.selectElement("c1"));
  const title = page.locator("#selectionPanel .panel-title").first();
  await expect(title).toContainText("a接点");
  const transform = await title.evaluate(element => getComputedStyle(element).textTransform);
  expect(transform).toBe("none");
  await expect(page.locator("#miniToolbar button", { hasText: "配線" })).toHaveCount(1);

  await page.evaluate(() => window.__edsTest.selectElement("tbl"));
  await expect(page.locator("#miniToolbar button", { hasText: "回転" })).toHaveCount(1);
  await expect(page.locator("#miniToolbar button", { hasText: "配線" })).toHaveCount(0);
});

test("下絵の表示範囲を変えても画像を引き伸ばさず、「下絵を選択」は選択部品タブを開く", async ({ page }) => {
  await page.evaluate(data => window.__edsTest.installProjectData(data), {
    schemaVersion: 4,
    activePageId: "p1",
    pages: [{ id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements: [
      { id: "u1", type: "underlayImage", x: 10, y: 20, w: 180, h: 120, imageData: "", opacity: 0.35, cropPreset: "full", locked: false, layer: "layout" }
    ] }]
  });
  await page.evaluate(() => window.__edsTest.selectElement("u1"));
  await page.locator('#selectionPanel [data-bind="cropPreset"]').selectOption("left");
  // 左半分は元の縦横比の半分の幅になる(高さはそのまま)。
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements[0])).toMatchObject({ cropPreset: "left", w: 90, h: 120 });
  await page.locator('#selectionPanel [data-bind="cropPreset"]').selectOption("top");
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements[0])).toMatchObject({ cropPreset: "top", w: 360, h: 120 });

  // 下絵を選択したままページ設定タブへ切り替えてから「下絵を選択」しても、下絵の設定が見える。
  await page.locator("#inspectorTabPage").click();
  await page.locator("#underlayMenu").selectOption("select");
  await expect(page.locator("#selectionPanel")).toBeVisible();
  await expect(page.locator('#selectionPanel [data-bind="cropPreset"]')).toBeVisible();
});

test("カタログ差分更新は項目名を表示名で出し、端子台エディタは詳細列まで横スクロールなしで見える", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.evaluate(data => window.__edsTest.installProjectData(data), {
    schemaVersion: 4,
    activePageId: "p1",
    catalog: [{ family: "CR", manufacturer: "新メーカー", catalog: "RY-1", description: "補助リレー", rating: "DC24V", maxNO: 4 }],
    pages: [{ id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements: [
      { id: "c1", type: "coil", x: 40, y: 60, w: 10, h: 4.4, tag: "CR1", label: "CR1", catalog: "RY-1", manufacturer: "旧", layer: "symbols" },
      { id: "tb1", type: "terminalStrip", x: 120, y: 50, w: 10, h: 28.5, count: 3, orientation: "vertical", stripStyle: "unit", label: "TB1", layer: "symbols" }
    ] }]
  });
  await page.locator("#actionMenu").selectOption("catalogRefresh");
  const body = page.locator("#dialogBody");
  await expect(body).toContainText("メーカー");
  await expect(body).not.toContainText("manufacturer");
  await page.locator("#dialogClose").click();

  await page.locator("#actionMenu").selectOption("terminalEditor");
  const detail = page.locator("#dialogBody button", { hasText: "詳細" }).first();
  await expect(detail).toBeVisible();
  const fits = await page.evaluate(() => {
    const dialog = document.querySelector(".dialog");
    const button = Array.from(dialog.querySelectorAll("button")).find(item => item.textContent.trim() === "詳細");
    const box = button.getBoundingClientRect();
    const frame = dialog.getBoundingClientRect();
    return dialog.scrollWidth <= dialog.clientWidth + 1 && box.right <= frame.right;
  });
  expect(fits).toBe(true);
});

test("縦配線列の開始Xは、母線のあるページでは最も右の左母線の右側を既定にする", async ({ page }) => {
  await page.locator("#templateMenu").selectOption("facilityLadder");
  await page.locator("#ladRails").fill("P1,P2,P3");
  await page.locator("#ladBuildBtn").click();
  await page.locator("#actionMenu").selectOption("wireColumn");
  // P1/P2/P3は32.5/37.5/42.5なので、P3の7.5mm右(50)から始める。
  await expect(page.locator("#wireColumnX")).toHaveValue("50");
  await page.locator("#dialogClose").click();

  await page.locator("#tabbar .page-tab").first().click();
  await page.locator("#actionMenu").selectOption("wireColumn");
  // 母線のないページは従来どおり30。
  await expect(page.locator("#wireColumnX")).toHaveValue("30");
});
