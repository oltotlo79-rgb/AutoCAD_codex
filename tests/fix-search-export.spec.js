const fs = require("node:fs");
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
  expect(issues?.consoleErrors ?? [], "console errorが発生していないこと").toEqual([]);
  expect(issues?.pageErrors ?? [], "page errorが発生していないこと").toEqual([]);
});

const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);

// 検索と一括置換が共通で対象にする文字フィールド(index.htmlのREPLACE_FIELDSと同じ)。
const TEXT_FIELDS = ["tag", "label", "description", "installation", "location", "manufacturer", "catalog", "rating", "item", "text", "wireNo", "prefix", "cellText", "pinText", "rightPinText", "terminalLabels", "note", "fromOverride", "toOverride"];

function onePage(elements, extra = {}) {
  return {
    schemaVersion: 4,
    activePageId: "p1",
    ...extra,
    pages: [{ id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements }]
  };
}

async function openSearch(page, query) {
  await page.locator("#searchBtn").click();
  await page.locator("#searchQuery").fill(query);
}

async function captureDownload(page, trigger) {
  const [download] = await Promise.all([page.waitForEvent("download"), trigger()]);
  return { name: download.suggestedFilename(), bytes: fs.readFileSync(await download.path()) };
}

// PDFの各ページのMediaBoxをmm単位[幅, 高さ]で返す。
function pdfPageSizesMm(buffer) {
  const text = buffer.toString("latin1");
  return [...text.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)]
    .map(match => [Number(match[3]), Number(match[4])].map(pt => Math.round(pt * 25.4 / 72)));
}

test("検索は端子名・右ピン文字・FROM/TOも大文字小文字を区別せず見つけ、種別は表示名で出す", async ({ page }) => {
  // 操作手順が長く、並行実行などで負荷が高いと既定の15秒を超えるため余裕を持たせる。
  test.slow();
  await page.evaluate(data => window.__edsTest.installProjectData(data), onePage([
    { id: "tb1", type: "terminalStrip", x: 20, y: 50, w: 30, h: 12, count: 2, terminalLabels: "XT77\nXT78", layer: "symbols" },
    { id: "box1", type: "deviceBox", x: 80, y: 50, w: 30, h: 25, label: "機器", pins: 2, pinText: "1\n2", rightPinText: "UQ9\nUQ10", layer: "symbols" },
    { id: "w1", type: "wire", points: [[20, 120], [80, 120]], wireNo: "101", fromOverride: "FROMQ", toOverride: "TOQ", layer: "wires" }
  ]));

  const cases = [
    ["  xt77 ", "tb1", "端子台"],
    ["uq9", "box1", "機器箱"],
    ["fromq", "w1", "配線"],
    ["TOQ", "w1", "配線"]
  ];
  await page.locator("#searchBtn").click();
  for (const [query, id, typeLabel] of cases) {
    await page.locator("#searchQuery").fill(query);
    await page.locator("#runSearchBtn").click();
    const rows = page.locator("#searchResults tbody tr");
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator("[data-select-id]")).toHaveAttribute("data-select-id", id);
    await expect(rows.first().locator("td").nth(1)).toHaveText(typeLabel);
    // 内容欄に内部の種別名(terminalStrip等)を出さない。
    await expect(rows.first().locator("td").nth(2)).not.toContainText(/terminalStrip|deviceBox|wire/);
  }

  // 種別の表示名でも検索できる(内部名では当たらない)。
  await page.locator("#searchQuery").fill("端子台");
  await page.locator("#runSearchBtn").click();
  await expect(page.locator("#searchResults tbody tr")).toHaveCount(1);
  await page.locator("#searchQuery").fill("terminalStrip");
  await page.locator("#runSearchBtn").click();
  await expect(page.locator("#searchResults")).toContainText("該当する要素はありません。");
});

test("検索で見つかる文字欄はすべて一括置換でも対象になる", async ({ page }) => {
  const element = { id: "box1", type: "deviceBox", x: 80, y: 50, w: 30, h: 25, pins: 2, layer: "symbols" };
  TEXT_FIELDS.forEach(field => { element[field] = "v-PARITY-" + field; });
  await page.evaluate(data => window.__edsTest.installProjectData(data), onePage([element]));

  await openSearch(page, "parity");
  await page.locator("#runSearchBtn").click();
  await expect(page.locator("#searchResults tbody tr")).toHaveCount(1);

  await page.locator("#replaceValue").fill("ok");
  await page.locator("#runReplaceBtn").click();
  await expect(page.locator("#dialogBody")).toContainText(`置換対象 ${TEXT_FIELDS.length}件`);
  await expect(page.locator("[data-replace-row]")).toHaveCount(TEXT_FIELDS.length);
  await page.locator("#replaceApplyBtn").click();

  const after = await page.evaluate(() => window.__edsTest.state.pages[0].elements[0]);
  TEXT_FIELDS.forEach(field => expect(after[field]).toBe("v-ok-" + field));
});

test("一括置換は検索語の前後空白を除き大文字小文字を区別せず、一致部分だけを置き換える", async ({ page }) => {
  // 操作手順が長く、並行実行などで負荷が高いと既定の15秒を超えるため余裕を持たせる。
  test.slow();
  await page.evaluate(data => window.__edsTest.installProjectData(data), onePage([
    { id: "tb1", type: "terminalStrip", x: 20, y: 50, w: 30, h: 12, count: 3, terminalLabels: "XT77\nxt78\nY1", layer: "symbols" },
    { id: "box1", type: "deviceBox", x: 80, y: 50, w: 30, h: 25, label: "機器", pins: 2, pinText: "1\n2", rightPinText: "UQ9\nuq10", layer: "symbols" },
    { id: "c1", type: "coil", x: 40, y: 150, tag: "KM1", label: "km1", layer: "symbols" }
  ]));

  await openSearch(page, "  xT7 ");
  await page.locator("#replaceValue").fill("TB");
  await page.locator("#runReplaceBtn").click();
  await expect(page.locator("[data-replace-row]")).toHaveCount(1);
  await expect(page.locator("#dialogBody tbody td").nth(5)).toHaveText("TB7 TB8 Y1");
  await page.locator("#replaceApplyBtn").click();
  let elements = await page.evaluate(() => window.__edsTest.state.pages[0].elements);
  expect(elements.find(item => item.id === "tb1").terminalLabels).toBe("TB7\nTB8\nY1");

  // 置換後の「$&」は置換パターンではなく文字としてそのまま入る。
  await openSearch(page, "uq");
  await page.locator("#replaceValue").fill("$&-");
  await page.locator("#runReplaceBtn").click();
  await page.locator("#replaceApplyBtn").click();
  elements = await page.evaluate(() => window.__edsTest.state.pages[0].elements);
  expect(elements.find(item => item.id === "box1").rightPinText).toBe("$&-9\n$&-10");

  // 既に置換後と同じ表記の欄(タグKM1)は変化しないので対象一覧に出さない。
  await openSearch(page, "km1");
  await page.locator("#replaceValue").fill("KM1");
  await page.locator("#runReplaceBtn").click();
  await expect(page.locator("[data-replace-row]")).toHaveCount(1);
  await expect(page.locator("#dialogBody tbody td").nth(3)).toHaveText("ラベル");
  await page.locator("#replaceApplyBtn").click();
  elements = await page.evaluate(() => window.__edsTest.state.pages[0].elements);
  expect(elements.find(item => item.id === "c1")).toMatchObject({ tag: "KM1", label: "KM1" });

  // 種別名だけの一致は置換対象にならない。
  await openSearch(page, "コイル");
  await page.locator("#runSearchBtn").click();
  await expect(page.locator("#searchResults tbody tr")).toHaveCount(1);
  await page.locator("#runReplaceBtn").click();
  await expect(page.locator("#status")).toHaveText("置換対象が見つかりませんでした。");
});

test("CSV/TSV出力はすべてBOM付きUTF-8で書き出す", async ({ page }) => {
  // 操作手順が長く、並行実行などで負荷が高いと既定の15秒を超えるため余裕を持たせる。
  test.slow();
  await page.evaluate(data => window.__edsTest.installProjectData(data), onePage([
    { id: "c1", type: "coil", x: 40, y: 60, tag: "KM1", manufacturer: "汎用", catalog: "RY-1", description: "補助リレー", layer: "symbols" },
    { id: "tb1", type: "terminalStrip", x: 120, y: 50, w: 30, h: 12, count: 2, terminalLabels: "端子1\n端子2", label: "端子台A", layer: "symbols" },
    { id: "w1", type: "wire", points: [[20, 120], [80, 120]], wireNo: "線101", fromOverride: "盤内", toOverride: "現場", layer: "wires" }
  ], { catalog: [{ family: "CR", manufacturer: "汎用", catalog: "RY-1", description: "補助リレー", rating: "DC24V" }] }));

  const menu = action => page.locator("#actionMenu").selectOption(action);
  const exports = [
    ["electrical-report.csv", () => menu("reportCsv"), "補助リレー"],
    ["electrical-bom.csv", async () => { await menu("bom"); await page.locator("#bomCsvBtn").click(); }, "補助リレー"],
    ["netlist.csv", async () => { await menu("netlist"); await page.locator("#netlistCsvBtn").click(); }, "線101"],
    ["terminal-plan.csv", async () => { await menu("terminalPlan"); await page.locator("#terminalPlanCsvBtn").click(); }, "端子台A"],
    ["wire-from-to.csv", async () => { await menu("wireSequence"); await page.locator("#wireFromToCsvBtn").click(); }, "盤内"],
    ["catalog.csv", async () => { await menu("catalog"); await page.locator("#catalogCsvExportBtn").click(); }, "補助リレー"],
    ["electrical-roundtrip.tsv", async () => { await menu("spreadsheetRoundtrip"); await page.locator("#spreadsheetExport").click(); }, "補助リレー"]
  ];
  for (const [fileName, trigger, sample] of exports) {
    const { name, bytes } = await captureDownload(page, trigger);
    expect(name).toBe(fileName);
    expect(bytes.subarray(0, 3).equals(BOM), fileName + " にBOMがない").toBe(true);
    // BOMは1個だけ(二重に付けない)。
    expect(bytes.subarray(3, 6).equals(BOM), fileName + " のBOMが二重").toBe(false);
    expect(bytes.subarray(3).toString("utf8")).toContain(sample);
    await page.keyboard.press("Escape");
  }
});

test("BOM付きCSVを端子CSV・PLC CSV・カタログCSV取込と表計算往復で読める", async ({ page }) => {
  // 操作手順が長く、並行実行などで負荷が高いと既定の15秒を超えるため余裕を持たせる。
  test.slow();
  await page.evaluate(data => window.__edsTest.installProjectData(data), onePage([
    { id: "c1", type: "coil", x: 40, y: 60, tag: "KM1", description: "旧説明", layer: "symbols" }
  ]));

  // 端子CSV: 先頭列の見出し「端子台」がBOMで崩れないこと。
  await page.locator("#terminalCsvInput").setInputFiles({
    name: "terminal.csv", mimeType: "text/csv",
    buffer: Buffer.concat([BOM, Buffer.from("端子台,端子,線番,信号,接続先\nXT,1,101,運転,MC1\nXT,2,102,停止,MC2\n", "utf8")])
  });
  await expect.poll(() => page.evaluate(() => window.__edsTest.state.pages.length)).toBe(2);
  const strip = await page.evaluate(() => window.__edsTest.state.pages[1].elements.find(item => item.type === "terminalStrip"));
  expect(strip).toMatchObject({ label: "XT", terminalLabels: "1\n2" });

  // PLC CSV
  await page.locator("#plcCsvInput").setInputFiles({
    name: "plc.csv", mimeType: "text/csv",
    buffer: Buffer.concat([BOM, Buffer.from("アドレス,信号名,線番\nX0,運転指令,201\nY0,運転表示,202\n", "utf8")])
  });
  await expect.poll(() => page.evaluate(() => window.__edsTest.state.pages.length)).toBe(3);
  const plcJson = await page.evaluate(() => JSON.stringify(window.__edsTest.state.pages[2]));
  expect(plcJson).toContain("運転指令");
  expect(plcJson).toContain("X0");

  // カタログCSV(自前のcatalog.csv出力と同じBOM付き形式)
  await page.locator("#actionMenu").selectOption("catalog");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.locator("#catalogCsvImportBtn").click()]);
  await chooser.setFiles({
    name: "catalog.csv", mimeType: "text/csv",
    buffer: Buffer.concat([BOM, Buffer.from("\"family\",manufacturer,catalog,description\r\nCR,汎用,RY-9,補助リレー\r\n", "utf8")])
  });
  await expect.poll(() => page.evaluate(() => window.__edsTest.state.catalog.find(item => item.catalog === "RY-9"))).toMatchObject({ family: "CR", description: "補助リレー" });
  await page.keyboard.press("Escape");

  // 表計算往復: BOM付きTSVを貼り戻しても1列目(id)で照合できる。
  await page.locator("#actionMenu").selectOption("spreadsheetRoundtrip");
  const data = page.locator("#spreadsheetData");
  const tsv = await data.inputValue();
  await data.fill(String.fromCharCode(0xFEFF) + tsv.replace("旧説明", "新説明").replace(/^id\t/, "\"id\"\t"));
  await page.locator("#spreadsheetPreview").click();
  // 変更したのは説明だけ。複数行の端子名・I/O名は書き出しと貼り戻しで変わらない。
  await expect(page.locator("#dialogBody")).toContainText("1項目を更新します。");
  await expect(page.locator("#dialogBody")).toContainText("説明 旧説明→新説明");
  await page.locator("#spreadsheetApply").click();
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.id === "c1").description)).toBe("新説明");
});

test("A3面付はA4を等倍で2ページずつ並べ、A4縦はA3横・A4横はA3縦になる", async ({ page }) => {
  const pageOf = (id, size, orientation) => ({ id, name: id, size, orientation, frameVariant: "blank", title: {}, elements: [] });
  await page.evaluate(data => window.__edsTest.installProjectData(data), {
    schemaVersion: 4,
    activePageId: "a",
    pages: [
      pageOf("a", "A4", "portrait"), pageOf("b", "A4", "portrait"),
      pageOf("c", "A4", "landscape"), pageOf("d", "A4", "landscape"),
      pageOf("e", "A4", "portrait"), pageOf("f", "A4", "landscape"),
      pageOf("g", "A3", "landscape")
    ]
  });
  await expect(page.locator("#printTwoUpBtn")).toHaveAttribute("title", "A4を2ページずつA3へ等倍で面付けして印刷（A4縦→A3横に左右、A4横→A3縦に上下）");
  await page.evaluate(() => { window.print = () => {}; });
  await page.locator("#printTwoUpBtn").click();

  const sheets = await page.evaluate(() => Array.from(document.querySelectorAll("#printSheets .print-sheet")).map(sheet => ({
    className: sheet.className,
    pages: Array.from(sheet.querySelectorAll(":scope > svg > svg")).map(svg => ["x", "y", "width", "height"].map(key => Math.round(Number(svg.getAttribute(key)) * 100) / 100))
  })));
  expect(sheets).toEqual([
    { className: "print-sheet page-a3-landscape", pages: [[0, 0, 210, 297], [210, 0, 210, 297]] },
    { className: "print-sheet page-a3-portrait", pages: [[0, 0, 297, 210], [0, 210, 297, 210]] },
    { className: "print-sheet page-a3-landscape", pages: [[0, 0, 210, 297]] },
    { className: "print-sheet page-a3-portrait", pages: [[0, 0, 297, 210]] },
    { className: "print-sheet page-a3-landscape", pages: [[0, 0, 420, 297]] }
  ]);
  expect(pdfPageSizesMm(await page.pdf({ preferCSSPageSize: true }))).toEqual([
    [420, 297], [297, 420], [420, 297], [297, 420], [420, 297]
  ]);

  // 通常のPDF印刷は従来どおり1ページ=1枚(用紙寸法そのまま)に戻る。
  await page.locator("#printBtn").click();
  expect(pdfPageSizesMm(await page.pdf({ preferCSSPageSize: true }))).toEqual([
    [210, 297], [210, 297], [297, 210], [297, 210], [210, 297], [297, 210], [420, 297]
  ]);
});
