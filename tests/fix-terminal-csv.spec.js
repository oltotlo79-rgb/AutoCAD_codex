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

// CSV文字列を隠しファイル入力へ渡し、ページ追加まで待つ。
async function importCsv(page, inputId, name, text) {
  const before = await page.evaluate(() => window.__edsTest.state.pages.length);
  await page.locator(inputId).setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text, "utf8") });
  await expect.poll(() => page.evaluate(() => window.__edsTest.state.pages.length)).toBeGreaterThan(before);
}

// prompt/confirm を順番に応答する(false=キャンセル、文字列=入力、true=OK)。
function answerDialogs(page, answers) {
  const queue = answers.slice();
  const handler = async dialog => {
    const answer = queue.shift();
    if (answer === false || answer === undefined) await dialog.dismiss();
    else await dialog.accept(typeof answer === "string" ? answer : undefined);
    if (!queue.length) page.off("dialog", handler);
  };
  page.on("dialog", handler);
}

// 生成ページの概要(端子台・配線・説明文)を返す。
function summarizePages(page) {
  return page.evaluate(() => window.__edsTest.state.pages.slice(1).map(p => ({
    name: p.name,
    title: p.title.title,
    junctions: p.elements.filter(e => e.type === "junction").length,
    strips: p.elements.filter(e => e.type === "terminalStrip").map(e => ({ label: e.label, count: e.count, start: e.start, terminalLabels: e.terminalLabels })),
    wires: p.elements.filter(e => e.type === "wire" && !e.ladderRail).map(e => ({ points: e.points, wireNo: e.wireNo, wireNoDx: e.wireNoDx, from: e.fromOverride, to: e.toOverride })),
    texts: p.elements.filter(e => e.type === "text").map(e => e.text)
  })));
}

test("端子CSV: 見出しありの空セルを他列で補わず、端子台ごとにページを分ける", async ({ page }) => {
  await importCsv(page, "#terminalCsvInput", "term.csv", [
    "端子台,端子,線番,信号,接続先,備考",
    "X1,1,101,START,PB1,始動",
    "X1,2,,STOP,PB2,",
    ",3,103,,MC1,",
    "X2,1,201,LAMP,PL1,"
  ].join("\r\n"));
  const pages = await summarizePages(page);
  expect(pages.map(p => [p.name, p.title])).toEqual([["端子接続図 X1", "端子接続図 X1 1/1"], ["端子接続図 X2", "端子接続図 X2 1/1"]]);
  // 空欄の端子台セルは直前の行(X1)を引き継ぐ。
  expect(pages[0].strips).toEqual([{ label: "X1", count: 3, start: 1, terminalLabels: "1\n2\n3" }]);
  expect(pages[1].strips).toEqual([{ label: "X2", count: 1, start: 1, terminalLabels: "1" }]);
  // 空の線番セルに端子番号が入らず、空の信号セルに線番が入らない。
  expect(pages[0].wires.map(w => w.wireNo)).toEqual(["101", "", "103"]);
  expect(pages[0].texts).toEqual(["START PB1", "STOP PB2", "MC1"]);
  // 各行は母線(x=32.5)へ接続しない独立配線で、接続点も打たない。線番は端子台の外形にかからない。
  expect(pages[0].junctions).toBe(0);
  expect(pages[0].wires.every(w => w.points[0][0] === 37.5 && w.points[1][0] === 130 && w.wireNoDx === -5)).toBe(true);
  const labelEnd = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(p => p.id === window.__edsTest.state.activePageId);
    const wire = current.elements.find(e => e.type === "wire" && e.wireNo === "101");
    const text = Array.from(document.querySelectorAll(`[data-id="${wire.id}"] text`)).find(t => t.textContent === "101");
    return { x: Number(text.getAttribute("x")), anchor: text.getAttribute("text-anchor") };
  });
  expect(labelEnd.anchor).toBe("end");
  expect(labelEnd.x).toBeLessThan(125);
});

test("端子CSV: 見出しなしは列位置で読み、単一端子台は従来のページ名で17行ごとに分割する", async ({ page }) => {
  const rows = Array.from({ length: 20 }, (_, i) => `${i + 1},W${i + 1},SIG${i + 1},DEV${i + 1},`);
  await importCsv(page, "#terminalCsvInput", "noheader.csv", rows.join("\n"));
  const pages = await summarizePages(page);
  expect(pages.map(p => [p.name, p.title])).toEqual([["端子接続図", "端子接続図 1/2"], ["端子接続図", "端子接続図 2/2"]]);
  expect(pages[0].strips[0]).toMatchObject({ label: "X1", count: 17, start: 1 });
  expect(pages[1].strips[0]).toMatchObject({ label: "X1", count: 3, start: 18, terminalLabels: "18\n19\n20" });
  expect(pages[0].wires[0].wireNo).toBe("W1");
  expect(pages[0].texts[0]).toBe("SIG1 DEV1");
});

test("端子CSV: 複数端子台は端子台ごとに17行で分割する", async ({ page }) => {
  const rows = ["端子台,端子,線番"];
  for (let i = 1; i <= 20; i++) rows.push(`X1,${i},A${i}`);
  rows.push("X2,1,B1", "X2,2,B2");
  await importCsv(page, "#terminalCsvInput", "multi.csv", rows.join("\n"));
  const pages = await summarizePages(page);
  expect(pages.map(p => [p.name, p.title, p.strips[0].label, p.strips[0].count, p.strips[0].start])).toEqual([
    ["端子接続図 X1", "端子接続図 X1 1/2", "X1", 17, 1],
    ["端子接続図 X1", "端子接続図 X1 2/2", "X1", 3, 18],
    ["端子接続図 X2", "端子接続図 X2 1/1", "X2", 2, 1]
  ]);
  await expect(page.locator("#status")).toContainText("端子台2台");
});

test("端子CSV取込ページで線番採番してもCSVの線番は行ごとに残る", async ({ page }) => {
  await importCsv(page, "#terminalCsvInput", "term.csv", [
    "端子台,端子,線番,信号,接続先,備考",
    "X1,1,101,START,PB1,",
    "X1,2,,STOP,PB2,",
    "X1,3,102,RUN,MC1,"
  ].join("\n"));
  // 現在ページのみ / 未採番のみ / 開始番号1
  answerDialogs(page, [false, false, "1"]);
  await page.locator("#autoWireBtn").click();
  const wireNos = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(p => p.id === window.__edsTest.state.activePageId);
    return current.elements.filter(e => e.type === "wire" && !e.ladderRail).map(e => ({ wireNo: e.wireNo, hidden: Boolean(e.hideWireNo) }));
  });
  expect(wireNos[0]).toEqual({ wireNo: "101", hidden: false });
  expect(wireNos[2]).toEqual({ wireNo: "102", hidden: false });
  expect(wireNos[1].wireNo).not.toBe("");
  expect(new Set(wireNos.map(w => w.wireNo)).size).toBe(3);
  await expect(page.locator("#status")).toContainText("1ネットへ線番を付与しました");
});

test("PLC CSV: 見出しありの空線番は信号で補わず、Y/Q始まりは入出力列なしでも出力", async ({ page }) => {
  await importCsv(page, "#plcCsvInput", "plc.csv", [
    "アドレス,入出力,信号,線番,接続先,備考",
    "X000,入力,起動,101,PB1,",
    "X001,入力,停止,,PB2,",
    "Y000,出力,運転,201,MC1,",
    "Y001,出力,警報,,BZ1,"
  ].join("\n"));
  let pages = await summarizePages(page);
  expect(pages[0].junctions).toBe(0);
  expect(pages[0].wires.map(w => w.wireNo)).toEqual(["101", "", "201", ""]);
  expect(pages[0].wires.every(w => w.points[0][0] === 37.5)).toBe(true);
  expect(pages[0].texts).toEqual(["入力 起動 PB1", "入力 停止 PB2", "出力 運転 MC1", "出力 警報 BZ1"]);

  await page.goto(appUrl, { waitUntil: "load" });
  await importCsv(page, "#plcCsvInput", "plc_noheader.csv", [
    "X000,起動,101,PB1,",
    "Y000,運転,201,MC1,",
    "Q0.1,警報,202,BZ1,",
    "%QX0.2,表示,203,PL1,",
    "%IX0.0,非常停止,102,PB3,"
  ].join("\n"));
  pages = await summarizePages(page);
  expect(pages[0].texts).toEqual(["入力 起動 PB1", "出力 運転 MC1", "出力 警報 BZ1", "出力 表示 PL1", "入力 非常停止 PB3"]);
  expect(pages[0].wires[1]).toMatchObject({ wireNo: "201", from: "PLC(1/1):Y000", to: "MC1" });
  expect(pages[0].wires[0]).toMatchObject({ wireNo: "101", from: "PB1", to: "PLC(1/1):X000" });
});

test("端子台プラン表は端子記号(左辺の小円)へ接続した配線を拾う", async ({ page }) => {
  await page.evaluate(() => {
    const strip = { ...window.__edsTest.defaultElement("terminalStrip", 100, 40), id: "tb", x: 100, y: 40 };
    const node = window.__edsTest.terminalStripNodeLocal(strip, 0);
    const y = 40 + node.y;
    window.__edsTest.installProjectData({
      schemaVersion: 4,
      activePageId: "p1",
      pages: [{
        id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {},
        elements: [
          strip,
          { id: "w1", type: "wire", points: [[60, y], [100, y]], wireNo: "W1", layer: "wires" },
          { id: "t1", type: "text", x: 50, y: y - 2, w: 9, h: 4, text: "PB1", fontSize: 2.5, layer: "notes" }
        ]
      }]
    });
  });
  await page.locator("#actionMenu").selectOption("terminalPlan");
  const first = await page.locator("#dialogBody tbody tr").first().locator("td").allTextContents();
  expect(first).toEqual(["P1", "TB1", "1", "W1", "PB1", ""]);
  const second = await page.locator("#dialogBody tbody tr").nth(1).locator("td").allTextContents();
  expect(second.slice(3, 5)).toEqual(["", ""]);
});

test("From-To一覧CSVの配線種別は種別名で出力する", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 4,
    activePageId: "p1",
    pages: [{
      id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {},
      elements: [
        { id: "w1", type: "wire", points: [[40, 40], [80, 40]], wireNo: "101", wireType: "control", layer: "wires" },
        { id: "w2", type: "wire", points: [[40, 60], [80, 60]], wireNo: "102", wireType: "power", layer: "wires" }
      ]
    }]
  }));
  await page.evaluate(() => {
    window.__capturedBlobs = [];
    const original = URL.createObjectURL;
    URL.createObjectURL = blob => {
      window.__capturedBlobs.push(blob);
      return original.call(URL, blob);
    };
  });
  await page.locator("#actionMenu").selectOption("wireSequence");
  await page.locator("#wireFromToCsvBtn").click();
  const csv = await page.evaluate(() => window.__capturedBlobs.at(-1).text());
  const lines = csv.replace(/^﻿/, "").split("\r\n");
  expect(lines[0]).toBe("page,wireNo,from,to,wireType");
  expect(lines[1].split(",").at(-1)).toBe("制御線");
  expect(lines[2].split(",").at(-1)).toBe("動力線");
});

test("横向き端子台ではユニット列専用の項目を隠し、注記を出す", async ({ page }) => {
  await page.evaluate(() => {
    const strip = { ...window.__edsTest.defaultElement("terminalStrip", 60, 40), id: "tb", x: 60, y: 40 };
    window.__edsTest.installProjectData({
      schemaVersion: 4,
      activePageId: "p1",
      pages: [{ id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements: [strip] }]
    });
    window.__edsTest.selectElement("tb");
  });
  await expect(page.locator('[data-bind="cardMode"]')).toHaveCount(1);
  await expect(page.locator('[data-bind="levels"]')).toHaveCount(1);
  await expect(page.locator("[data-strip-horizontal-note]")).toHaveCount(0);
  await page.locator('[data-bind="orientation"]').selectOption("horizontal");
  await expect(page.locator("[data-strip-horizontal-note]")).toBeVisible();
  for (const key of ["cardMode", "zeroVTerminal", "comTerminal", "comLabelStyle", "levels", "start2", "prefix2"]) {
    await expect(page.locator(`[data-bind="${key}"]`)).toHaveCount(0);
  }
});

test("PLC/I-Oのユニット列の選択肢名は長方形表記", async ({ page }) => {
  await page.evaluate(() => {
    window.__edsTest.installProjectData({
      schemaVersion: 4,
      activePageId: "p1",
      pages: [{ id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements: [{ ...window.__edsTest.defaultElement("plcBlock", 60, 40), id: "plc" }] }]
    });
    window.__edsTest.selectElement("plc");
  });
  await expect(page.locator('[data-bind="plcStyle"] option[value="unit"]')).toHaveText("ユニット列（端子円・長方形）");
  await expect(page.locator('[data-bind="plcStyle"]')).toHaveValue("grid");
});

test("配線種別管理の種別追加で未適用の編集を失わない", async ({ page }) => {
  await page.locator("#actionMenu").selectOption("wireTypeManager");
  const firstLabel = page.locator('[data-wire-type-row="control"] [data-wire-type-field="label"]');
  await firstLabel.fill("制御線(編集中)");
  await page.locator('[data-wire-type-row="power"] [data-wire-type-field="noNumber"]').check();
  answerDialogs(page, ["signal", "信号線"]);
  await page.locator("#addWireTypeBtn").click();
  await expect(page.locator('[data-wire-type-row="signal"]')).toHaveCount(1);
  await expect(firstLabel).toHaveValue("制御線(編集中)");
  await expect(page.locator('[data-wire-type-row="power"] [data-wire-type-field="noNumber"]')).toBeChecked();
  expect(await page.evaluate(() => window.__edsTest.state.wireTypes[0].label)).toBe("制御線");
  await page.locator("#applyWireTypeBtn").click();
  expect(await page.evaluate(() => window.__edsTest.state.wireTypes.map(t => [t.id, t.label, t.noNumber]).slice(0, 2)))
    .toEqual([["control", "制御線(編集中)", false], ["power", "動力線", true]]);
});

test("端子台エディタの各行の詳細でその端子台の端子単位詳細を開く", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 4,
    activePageId: "p1",
    pages: [
      { id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements: [
        { id: "tb1", type: "terminalStrip", x: 40, y: 40, w: 10, h: 30, count: 3, orientation: "vertical", stripStyle: "unit", label: "TB1", layer: "symbols" }
      ] },
      { id: "p2", name: "P2", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements: [
        { id: "tb2", type: "terminalStrip", x: 40, y: 40, w: 10, h: 20, count: 2, orientation: "vertical", stripStyle: "unit", label: "TB2", layer: "symbols" }
      ] }
    ]
  }));
  await page.locator("#actionMenu").selectOption("terminalEditor");
  await expect(page.locator("[data-terminal-detail-open]")).toHaveCount(2);
  await page.locator('[data-terminal-detail-open="tb2"]').click();
  await expect(page.locator("[data-terminal-detail]")).toHaveCount(2);
  await page.locator('[data-terminal-detail="2:1"] [data-td="catalog"]').fill("UK5N");
  await page.locator("#terminalDetailApply").click();
  const details = await page.evaluate(() => window.__edsTest.state.pages.map(p => p.elements[0].terminalDetails || null));
  expect(details[0]).toBeNull();
  expect(details[1][1]).toMatchObject({ terminal: 2, level: 1, catalog: "UK5N" });
});

test("端子番号の振り直しは接頭辞のキャンセルで中止し、端子名入力済みの端子台を知らせる", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 4,
    activePageId: "p1",
    pages: [{ id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements: [
      { id: "tb1", type: "terminalStrip", x: 40, y: 40, w: 10, h: 30, count: 3, start: 1, orientation: "vertical", stripStyle: "unit", label: "TB1", terminalLabels: "A\nB\nC", layer: "symbols" },
      { id: "tb2", type: "terminalStrip", x: 80, y: 40, w: 10, h: 20, count: 2, start: 1, orientation: "vertical", stripStyle: "unit", label: "TB2", layer: "symbols" }
    ] }]
  }));
  answerDialogs(page, ["5", false]);
  await page.locator("#actionMenu").selectOption("terminalNo");
  await expect.poll(() => page.evaluate(() => window.__edsTest.state.pages[0].elements.map(e => e.start))).toEqual([1, 1]);

  answerDialogs(page, ["11", "T"]);
  await page.locator("#actionMenu").selectOption("terminalNo");
  await expect.poll(() => page.evaluate(() => window.__edsTest.state.pages[0].elements.map(e => [e.prefix, e.start])))
    .toEqual([["T", 11], ["T", 14]]);
  await expect(page.locator("#status")).toContainText("TB1 は端子名が入力済み");
});
