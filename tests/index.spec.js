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

test("文字・端子名の連続入力中にフォーカスを維持する", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 4,
    activePageId: "p1",
    pages: [{
      id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {},
      elements: [
        { id: "text1", type: "text", x: 20, y: 20, w: 40, h: 10, text: "", fontSize: 3.5, layer: "notes" },
        { id: "tb1", type: "terminalStrip", x: 20, y: 50, w: 30, h: 12, count: 2, terminalLabels: "", layer: "symbols" }
      ]
    }]
  }));

  await page.locator('[data-id="text1"]').click();
  const text = page.locator('[data-bind="text"]');
  await text.fill("ABC");
  await expect(text).toBeFocused();
  await expect(text).toHaveValue("ABC");

  await page.locator('[data-id="tb1"]').click();
  const terminals = page.locator('[data-bind="terminalLabels"]');
  await terminals.fill("X1\nX2");
  await expect(terminals).toBeFocused();
  await expect(terminals).toHaveValue("X1\nX2");
});

test("Y座標・文字配置・線の接続点・ページ設定を編集できる", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 4,
    activePageId: "p1",
    settings: { showPageName: false },
    pages: [
      {
        id: "p1", name: "PAGE ONE", size: "A4", orientation: "portrait", frameVariant: "ladder", title: {},
        elements: [
          { id: "text1", type: "text", x: 20, y: 100, w: 40, h: 20, text: "ABC", fontSize: 3.5, layer: "notes" },
          { id: "line1", type: "line", points: [[20, 30], [50, 30]], label: "", layer: "layout" }
        ]
      },
      { id: "p2", name: "PAGE TWO", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements: [] }
    ]
  }));

  await expect(page.locator("svg#canvas").getByText("PAGE ONE")).toHaveCount(0);
  await page.locator('[data-id="text1"]').click();
  const y = page.locator('[data-bind="y"]');
  const before = await page.evaluate(() => window.__edsTest.state.pages[0].elements[0].y);
  await y.fill("250");
  await y.press("Enter");
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements[0].y)).toBeLessThan(before);
  await page.locator('[data-bind="align"]').selectOption("end");
  await page.locator('[data-bind="verticalAlign"]').selectOption("bottom");
  await expect(page.locator('[data-id="text1"] text')).toHaveAttribute("text-anchor", "end");

  await page.locator('[data-id="line1"] line').click({ force: true });
  await page.locator('[data-bind="showStartConnection"]').check();
  await page.locator('[data-bind="showEndConnection"]').check();
  await expect(page.locator('[data-id="line1"] circle')).toHaveCount(2);

  await page.locator("#pageOrder").fill("2");
  await page.locator("#pageOrder").press("Enter");
  expect(await page.evaluate(() => window.__edsTest.state.pages.map(item => item.id))).toEqual(["p2", "p1"]);
  await page.locator("#showPageNameToggle").check();
  await expect(page.locator("svg#canvas").getByText("PAGE ONE")).toHaveCount(1);
});

test("分数座標の接続点でも直線を15度補正し、部品座標は第1接続点を基準にする", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 4,
    activePageId: "p1",
    pages: [{
      id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {},
      elements: [
        { id: "device", type: "deviceBox", x: 120.32, y: 40.32, w: 30, h: 25, pins: 4, label: "", layer: "symbols" },
        { id: "line", type: "line", points: [[120.32, 45.32], [150, 45.32]], layer: "layout" }
      ]
    }]
  }));
  const snap = await page.evaluate(() => ({
    horizontal: window.__edsTest.snapLineEndpoint([120.32, 45.32], { x: 160.8, y: 46.1 }),
    vertical: window.__edsTest.snapLineEndpoint([120.32, 45.32], { x: 121, y: 90.2 }),
    fifteen: window.__edsTest.snapLineEndpoint([120.32, 45.32], { x: 160, y: 56 })
  }));
  expect(snap.horizontal[1]).toBe(45.32);
  expect(snap.vertical[0]).toBe(120.32);
  expect(Math.abs(Math.atan2(snap.fifteen[1] - 45.32, snap.fifteen[0] - 120.32) * 180 / Math.PI - 15)).toBeLessThan(.05);

  await page.locator('[data-id="device"]').click();
  await expect(page.locator('[data-bind="x"]')).toHaveValue("120.32");
  await expect(page.locator('[data-bind="y"]')).toHaveValue("251.68");
  await page.locator('[data-bind="x"]').fill("125");
  await page.locator('[data-bind="x"]').press("Enter");
  const result = await page.evaluate(() => {
    const element = window.__edsTest.state.pages[0].elements.find(item => item.id === "device");
    return {
      labelCount: document.querySelectorAll('[data-id="device"] text').length,
      anchors: window.__edsTest.elementConnectionAnchors(element)
    };
  });
  expect(result.anchors[0].x).toBe(125);
  expect(result.anchors.every(anchor => Math.abs((anchor.y - result.anchors[0].y) / 2.5 - Math.round((anchor.y - result.anchors[0].y) / 2.5)) < .001)).toBe(true);
  expect(result.labelCount).toBe(0);

  await page.evaluate(() => window.__edsTest.selectElement("line"));
  await expect(page.locator('[data-endpoint-role="start"]')).toHaveText("始");
  await expect(page.locator('[data-endpoint-role="end"]')).toHaveText("終");
});

test("ACE拡張8機能を管理・生成・同期できる", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 4, activePageId: "p1", cables: [], plcModules: [], userCircuits: [],
    pages: [{
      id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {},
      elements: [
        { id: "coil", type: "coil", x: 30, y: 40, w: 10, h: 7, tag: "CR1", label: "CR1", manufacturer: "旧", catalog: "OLD", installation: "盤A", location: "上段", layer: "symbols" },
        { id: "foot", type: "rect", x: 80, y: 40, w: 20, h: 12, label: "CR1", panelRef: "CR1", manufacturer: "新", catalog: "NEW", description: "盤側", layer: "layout" },
        { id: "strip", type: "terminalStrip", x: 50, y: 80, w: 10, h: 30, count: 3, orientation: "vertical", label: "TB1", layer: "symbols" },
        { id: "cable", type: "cableMarker", x: 30, y: 120, w: 28, h: 12, label: "C1", cableTag: "C1", coreNo: "1", layer: "symbols" },
        { id: "wire", type: "wire", points: [[20, 45], [70, 45]], wireNo: "101", layer: "wires" }
      ]
    }]
  }));

  await page.locator("#actionMenu").selectOption("cableManager");
  await page.locator('[data-cable-field="color"]').fill("黒");
  await page.locator('[data-cable-field="gauge"]').fill("1.25sq");
  await page.locator("#applyCableBtn").click();
  expect(await page.evaluate(() => window.__edsTest.state.cables[0])).toMatchObject({ tag: "C1", core: "1", color: "黒", gauge: "1.25sq" });

  await page.locator("#actionMenu").selectOption("locationView");
  await expect(page.locator("#dialogBody")).toContainText("盤A");
  await page.locator("#dialogClose").click();

  await page.locator("#actionMenu").selectOption("terminalEditor");
  await page.locator('[data-terminal-field="terminalLabels"]').fill("3,1,2");
  await page.locator('[data-terminal-field="spares"]').fill("2");
  await page.locator('[data-terminal-field="accessories"]').fill("エンド板");
  await page.locator("#applyTerminalEditorBtn").click();
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.id === "strip"))).toMatchObject({ terminalLabels: "3\n1\n2", spares: "2", accessories: "エンド板" });

  await page.evaluate(() => window.__edsTest.syncPanelFootprints("toSchematic"));
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.id === "coil").catalog)).toBe("NEW");
  await page.evaluate(() => {
    const coil = window.__edsTest.state.pages[0].elements.find(item => item.id === "coil");
    coil.catalog = "SYNC";
    window.__edsTest.syncPanelFootprints("toPanel");
  });
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.id === "foot").catalog)).toBe("SYNC");

  await page.locator("#actionMenu").selectOption("plcModuleManager");
  await page.locator("#plcDbAdd").click();
  const plcRow = page.locator("[data-plc-db-row]").last();
  await plcRow.locator('[data-plc-db="label"]').fill("MELSEC入力");
  await plcRow.locator('[data-plc-db="manufacturer"]').fill("三菱");
  await plcRow.locator('[data-plc-db="catalog"]').fill("QX40");
  await plcRow.locator('[data-plc-db="count"]').fill("16");
  await page.locator("#plcDbApply").click();
  expect(await page.evaluate(() => window.__edsTest.state.plcModules[0].catalog)).toBe("QX40");

  const beforeDin = await page.evaluate(() => window.__edsTest.state.pages[0].elements.length);
  await page.locator("#actionMenu").selectOption("dinRail");
  await page.locator("#dinLength").fill("50");
  await page.locator("#dinBuild").click();
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.length)).toBeGreaterThan(beforeDin);

  await page.evaluate(() => window.__edsTest.selectElement("coil"));
  page.once("dialog", dialog => dialog.accept("自己保持回路"));
  await page.locator("#actionMenu").selectOption("saveUserCircuit");
  expect(await page.evaluate(() => window.__edsTest.state.userCircuits[0].name)).toBe("自己保持回路");
  const beforeCircuit = await page.evaluate(() => window.__edsTest.state.pages[0].elements.length);
  await page.locator("#actionMenu").selectOption("insertUserCircuit");
  await page.locator("#userCircuitInsert").click();
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.length)).toBe(beforeCircuit + 1);

  const avoided = await page.evaluate(() => {
    const wire = window.__edsTest.state.pages[0].elements.find(item => item.id === "wire");
    const original = { x: 31, y: 43.2, anchor: "start" };
    return window.__edsTest.avoidWireNumberCollision(wire, original);
  });
  expect(avoided.y).not.toBe(43.2);
  expect(avoided.leader).toBe(true);
});

test("高速作画支援をキーボードと管理画面から利用できる", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 4, activePageId: "p1",
    pages: [{
      id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {},
      elements: [
        { id: "a", type: "coil", x: 30, y: 40, w: 10, h: 7, tag: "CR01", label: "CR01", manufacturer: "M", catalog: "C1", layer: "symbols" },
        { id: "b", type: "coil", x: 60, y: 70, w: 10, h: 7, tag: "CR10", label: "CR10", layer: "symbols" }
      ]
    }]
  }));

  await page.keyboard.press("Control+k");
  await expect(page.locator("#commandSearch")).toBeFocused();
  await page.locator("#commandSearch").fill("端子");
  await expect(page.locator("#commandResults")).toContainText("端子");
  await page.locator("#dialogClose").click();

  await page.locator("#actionMenu").selectOption("favoriteManager");
  await page.locator('[data-favorite-tool="coil"]').check();
  await page.locator("#continuousPlacementToggle").check();
  await page.locator("#favoriteApply").click();
  expect(await page.evaluate(() => window.__edsTest.state.settings.favoriteTools)).toContain("coil");
  await expect(page.locator("#paletteGrid details.palette-group").filter({ hasText: "お気に入り" })).toContainText("コイル");

  await page.evaluate(() => window.__edsTest.selectElement("a"));
  await page.keyboard.press("Control+d");
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.tag === "CR02")?.label)).toBe("CR02");

  await page.evaluate(() => window.__edsTest.selectElement("a"));
  await page.locator("#actionMenu").selectOption("attributeBrush");
  await page.locator('[data-id="b"]').click();
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.id === "b").catalog)).toBe("C1");
  await page.keyboard.press("Escape");

  await page.evaluate(() => window.__edsTest.setSelectionForTest(["a", "b"]));
  await page.locator("#actionMenu").selectOption("smartAlign");
  const anchors = await page.evaluate(() => {
    const items = window.__edsTest.state.pages[0].elements.filter(item => ["a", "b"].includes(item.id));
    return items.map(window.__edsTest.primaryConnectionPoint);
  });
  expect(anchors[0].y).toBe(anchors[1].y);

  await page.locator("#actionMenu").selectOption("batchEdit");
  await page.locator('[data-batch-id="a"] [data-batch="description"]').fill("一括A");
  await page.locator("#batchApply").click();
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.id === "a").description)).toBe("一括A");

  await page.evaluate(() => window.__edsTest.selectElement("a"));
  await page.keyboard.press("q");
  await page.locator("#quickIdentity").fill("CR20");
  await page.locator("#quickApply").click();
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.id === "a").tag)).toBe("CR20");
});

test("プロジェクト保守・端子詳細・盤・ケーブル拡張を利用できる", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 4, activePageId: "p1",
    catalog: [{ family: "CR", manufacturer: "NEW-M", catalog: "P1", description: "新説明", rating: "24V" }],
    footprintDb: [], cables: [],
    pages: [{
      id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {},
      elements: [
        { id: "contact", type: "contactNO", x: 40, y: 40, w: 14, h: 10, tag: "CR1", label: "CR1", manufacturer: "OLD", catalog: "P1", layer: "symbols" },
        { id: "wire", type: "wire", points: [[20, 45], [40, 45]], wireNo: "1", layer: "wires" },
        { id: "strip", type: "terminalStrip", x: 80, y: 40, w: 10, h: 30, count: 3, levels: 2, orientation: "vertical", label: "TB1", layer: "symbols" },
        { id: "foot", type: "rect", x: 120, y: 40, w: 20, h: 14, label: "CR1", panelRef: "CR1", layer: "layout" }
      ]
    }]
  }));

  await page.locator("#actionMenu").selectOption("projectUpdate");
  await expect(page.locator("#projectUpdateApply")).toBeVisible();
  await page.locator("#dialogClose").click();

  await page.evaluate(() => window.__edsTest.selectElement("contact"));
  await page.locator("#actionMenu").selectOption("symbolSwap");
  await page.locator("#swapTarget").selectOption("contactNC");
  await page.locator("#swapApply").click();
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.id === "contact").type)).toBe("contactNC");
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.id === "wire").points.at(-1))).toEqual([40, 45]);

  await page.locator("#actionMenu").selectOption("spreadsheetRoundtrip");
  const sheet = page.locator("#spreadsheetData");
  await sheet.fill((await sheet.inputValue()).replace("\tOLD\tP1\t", "\tOLD\tP1\t").replace("CR1\t\tOLD", "CR1\t表更新\tOLD"));
  await page.locator("#spreadsheetPreview").click();
  await page.locator("#spreadsheetApply").click();
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.id === "contact").description)).toBe("表更新");

  await page.locator("#actionMenu").selectOption("catalogRefresh");
  await expect(page.locator("#dialogBody")).toContainText("NEW-M");
  await page.locator("#catalogRefreshApply").click();
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.id === "contact").manufacturer)).toBe("NEW-M");

  await page.locator("#actionMenu").selectOption("terminalEditor");
  await page.locator("#terminalDetailBtn").click();
  await page.locator('[data-terminal-detail="1:1"] [data-td="catalog"]').fill("UK5N");
  await page.locator('[data-terminal-detail="1:1"] [data-td="internal"]').fill("CR1-A1");
  await page.locator("#terminalDetailApply").click();
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.id === "strip").terminalDetails[0].catalog)).toBe("UK5N");

  await page.locator("#actionMenu").selectOption("footprintDb");
  await page.locator("#footprintAdd").click();
  const fp = page.locator("[data-footprint-row]").last();
  await fp.locator('[data-fp="catalog"]').fill("P1");
  await fp.locator('[data-fp="w"]').fill("33");
  await fp.locator('[data-fp="h"]').fill("44");
  await page.locator("#footprintApply").click();
  expect(await page.evaluate(() => window.__edsTest.state.footprintDb[0])).toMatchObject({ catalog: "P1", w: 33, h: 44 });

  await page.locator("#actionMenu").selectOption("panelAnnotation");
  await page.locator("#panelAnnotationApply").click();
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.filter(item => item.panelAnnotationFor === "foot").length)).toBeGreaterThan(1);

  const beforeFan = await page.evaluate(() => window.__edsTest.state.pages[0].elements.length);
  await page.locator("#actionMenu").selectOption("cableFan");
  await page.locator("#fanCoreCount").fill("3");
  await page.locator("#fanCableTag").fill("CBL9");
  await page.locator("#fanApply").click();
  expect(await page.evaluate(() => window.__edsTest.state.cables.filter(row => row.tag === "CBL9").length)).toBe(3);
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.length)).toBeGreaterThan(beforeFan);
});

test.afterEach(async ({ page }) => {
  const issues = runtimeIssues.get(page);
  expect(issues?.consoleErrors ?? [], "console errorが発生していないこと").toEqual([]);
  expect(issues?.pageErrors ?? [], "page errorが発生していないこと").toEqual([]);
});

test("初期画面にキャンバスと部品パレットが表示される", async ({ page }) => {
  await expect(page).toHaveTitle("Electrical Drawing Studio");
  await expect(page.locator("svg#canvas")).toHaveCount(1);

  const paletteItems = page.locator("#paletteGrid .palette-item");
  expect(await paletteItems.count()).toBeGreaterThan(0);
});

test("パレット内にscopeした部品を選択してキャンバスへ配置できる", async ({ page }) => {
  const filter = page.getByRole("searchbox", { name: "部品検索" });
  await filter.fill("coil");

  const palette = page.locator("#paletteGrid");
  const coil = palette.locator('.palette-item[data-type="coil"]');
  await expect(coil).toHaveCount(1);
  await expect(coil).toBeVisible();

  await coil.click();
  await expect(coil).toHaveClass(/(?:^|\s)active(?:\s|$)/);

  const canvas = page.locator("svg#canvas");
  await canvas.click({ position: { x: 200, y: 200 } });
  await expect(canvas.locator('g[data-type="coil"]')).toHaveCount(1);
});

test("部品検索からEnterキーで候補を選択できる", async ({ page }) => {
  const filter = page.getByRole("searchbox", { name: "部品検索" });
  await filter.fill("contactNO");

  const candidate = page.locator('#paletteGrid .palette-item[data-type="contactNO"]');
  await expect(candidate).toHaveCount(1);
  await filter.press("Enter");

  await expect(candidate).toHaveClass(/(?:^|\s)active(?:\s|$)/);
  await expect(page.locator("#status")).toContainText("a接点を配置できます");
});

test("ユーザー部品名をHTMLとして解釈せずパレットへ安全に表示する", async ({ page }) => {
  const unsafeLabel = '<img id="palette-injected" src=x onerror="window.paletteInjected=true">';
  await page.evaluate(({ label }) => window.__edsTest.installProjectData({
    schemaVersion: 3,
    activePageId: "p1",
    customSymbols: [{
      id: "unsafe-label",
      label,
      templates: [{ type: "rect", x: 0, y: 0, w: 10, h: 5 }]
    }],
    pages: [{ id: "p1", title: {}, elements: [] }]
  }), { label: unsafeLabel });

  const item = page.locator('#paletteGrid .palette-item[data-type="custom:unsafe-label"]');
  await expect(item.locator(".palette-label")).toHaveText(unsafeLabel);
  await expect(page.locator("#palette-injected")).toHaveCount(0);
  expect(await page.evaluate(() => window.paletteInjected)).toBeUndefined();
});

test("改訂履歴の任意行を削除して適用できる", async ({ page }) => {
  await page.locator("#actionMenu").selectOption("revisionHistory");

  const dialog = page.locator("#dialogBackdrop");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#dialogTitle")).toHaveText("改訂履歴");

  await page.locator("#addRevisionBtn").click();
  await page.locator('[data-rev-row="0"] [data-rev-field="rev"]').fill("A");
  await page.locator('[data-rev-row="0"] [data-rev-field="date"]').fill("2026-01-01");
  await page.locator('[data-rev-row="0"] [data-rev-field="note"]').fill("first");

  await page.locator("#addRevisionBtn").click();
  await page.locator('[data-rev-row="1"] [data-rev-field="rev"]').fill("B");
  await page.locator('[data-rev-row="1"] [data-rev-field="date"]').fill("2026-02-02");
  await page.locator('[data-rev-row="1"] [data-rev-field="note"]').fill("second");
  await expect(page.locator("#dialogBody [data-rev-row]")).toHaveCount(2);

  await page.locator('[data-rev-delete="0"]').click();
  await expect(page.locator("#dialogBody [data-rev-row]")).toHaveCount(1);
  await expect(page.locator('[data-rev-row="0"] [data-rev-field="rev"]')).toHaveValue("B");
  await expect(page.locator('[data-rev-row="0"] [data-rev-field="note"]')).toHaveValue("second");

  await page.locator("#applyRevisionBtn").click();
  await expect(dialog).toBeHidden();

  await page.locator("#actionMenu").selectOption("revisionHistory");
  await expect(page.locator("#dialogBody [data-rev-row]")).toHaveCount(1);
  await expect(page.locator('[data-rev-row="0"] [data-rev-field="rev"]')).toHaveValue("B");

  await page.locator('[data-rev-delete="0"]').click();
  await expect(page.locator("#dialogBody [data-rev-row]")).toHaveCount(0);
  await page.locator("#dialogClose").click();
  await page.locator("#actionMenu").selectOption("revisionHistory");
  await expect(page.locator("#dialogBody [data-rev-row]")).toHaveCount(1);
  await expect(page.locator('[data-rev-row="0"] [data-rev-field="rev"]')).toHaveValue("B");
});

test("SVG内のidが文書内で重複しない", async ({ page }) => {
  const duplicateIds = await page.locator("svg[id], svg [id]").evaluateAll(nodes => {
    const counts = new Map();
    for (const node of nodes) {
      if (node.id) counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([id, count]) => ({ id, count }));
  });

  expect(duplicateIds).toEqual([]);
});

test("リサイズ中のUndoでドラッグを中断し、その後のpointermoveで再変更しない", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 3,
    activePageId: "p1",
    pages: [{
      id: "p1",
      title: {},
      elements: [{ id: "rect1", type: "rect", x: 20, y: 20, w: 20, h: 10, rotation: 0, layer: "symbols" }]
    }]
  }));

  await page.locator('svg#canvas [data-id="rect1"]').first().click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("ArrowRight");
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements[0].x)).toBe(21);

  const handle = page.locator('svg#canvas [data-resize-handle="se"]');
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 30, start.y + 20);
  await page.keyboard.press("Control+z");
  await page.mouse.move(start.x + 60, start.y + 40);
  await page.mouse.up();

  expect(await page.evaluate(() => {
    const element = window.__edsTest.state.pages[0].elements[0];
    return { x: element.x, y: element.y, w: element.w, h: element.h, history: window.__edsTest.historyDiagnostics() };
  })).toMatchObject({ x: 20, y: 20, w: 20, h: 10, history: { index: 0 } });
});

test("破損JSON・空ページ・将来版を拒否して現在図面を保持する", async ({ page }) => {
  const before = await page.evaluate(() => JSON.stringify(window.__edsTest.state));
  const invalidFiles = [
    {
      name: "empty-pages.json",
      body: { schemaVersion: 3, pages: [] },
      expected: "pages"
    },
    {
      name: "future.json",
      body: { schemaVersion: 5, pages: [{ id: "p1", title: {}, elements: [] }] },
      expected: "新しい形式"
    },
    {
      name: "null-element.json",
      body: { schemaVersion: 3, pages: [{ id: "p1", title: {}, elements: [null] }] },
      expected: "elements"
    },
    {
      name: "fractional-schema.json",
      body: { schemaVersion: 2.5, pages: [{ id: "p1", title: {}, elements: [] }] },
      expected: "schemaVersion"
    },
    {
      name: "invalid-unit-pitch.json",
      body: { schemaVersion: 4, pages: [{ id: "p1", title: {}, elements: [{ id: "plc", type: "plcBlock", x: 0, y: 0, pitch: "10" }] }] },
      expected: "pitch"
    },
    {
      name: "too-small-unit-pitch.json",
      body: { schemaVersion: 4, pages: [{ id: "p1", title: {}, elements: [{ id: "plc", type: "plcBlock", x: 0, y: 0, pitch: 1 }] }] },
      expected: "pitch"
    },
    {
      name: "unsafe-key.json",
      raw: '{"schemaVersion":3,"pages":[{"id":"p1","title":{},"elements":[]}],"__proto__":{"polluted":true}}',
      expected: "使用できないキー"
    }
  ];

  for (const item of invalidFiles) {
    await page.locator("#fileInput").setInputFiles({
      name: item.name,
      mimeType: "application/json",
      buffer: Buffer.from(item.raw ?? JSON.stringify(item.body))
    });
    await expect(page.locator("#status")).toContainText(item.expected);
    expect(await page.evaluate(() => JSON.stringify(window.__edsTest.state))).toBe(before);
  }

  const backupResult = await page.evaluate(snapshot => window.__edsTest.applyBackupSnapshot(snapshot), JSON.stringify({ schemaVersion: 3, pages: [] }));
  expect(backupResult).toBe(false);
  expect(await page.evaluate(() => JSON.stringify(window.__edsTest.state))).toBe(before);
  expect(await page.evaluate(() => ({
    normalPrototype: Object.getPrototypeOf(window.__edsTest.state) === Object.prototype,
    polluted: window.__edsTest.state.polluted
  }))).toEqual({ normalPrototype: true, polluted: undefined });
});

test("部分JSONは現在図面を継承せず既定値で補完し、staleなページIDを修復する", async ({ page }) => {
  const normalized = await page.evaluate(() => {
    window.__edsTest.state.settings.grid = 9;
    window.__edsTest.state.catalog = [{ catalog: "CURRENT" }];
    return window.__edsTest.normalizeProjectData({
      schemaVersion: 3,
      activePageId: "missing-page",
      pages: [{ id: "loaded-page", title: {}, elements: [] }]
    });
  });

  expect(normalized.settings.grid).toBe(2.5);
  expect(normalized.catalog).toEqual([]);
  expect(normalized.activePageId).toBe("loaded-page");
  expect(normalized.pages).toHaveLength(1);

  const legacy = await page.evaluate(() => window.__edsTest.normalizeProjectData({
    pages: [{ id: "legacy-page" }]
  }));
  expect(legacy.schemaVersion).toBe(4);
  expect(legacy.pages[0].title).toBeTruthy();
  expect(legacy.pages[0].elements).toEqual([]);
});

test("schema v2の回転部品と機器箱・端子箱を配線ごと現行版へ移行する", async ({ page }) => {
  const migrated = await page.evaluate(() => window.__edsTest.migrateProjectData({
    schemaVersion: 2,
    customSymbols: [{
      id: "legacy-custom",
      templates: [
        { type: "contactNO", x: 0, y: 0, w: 8, h: 4.4, orientation: "horizontal" },
        { type: "wire", points: [[8, 2.2], [12, 2.2]] }
      ]
    }, {
      id: "legacy-single-template",
      template: { type: "contactNO", x: 20, y: 0, w: 8, h: 4.4, orientation: "horizontal" }
    }],
    standardPacks: [{
      customSymbols: [{
        id: "embedded-custom",
        templates: [
          { type: "contactNO", x: 30, y: 0, w: 8, h: 4.4, orientation: "horizontal" },
          { type: "wire", points: [[38, 2.2], [42, 2.2]] }
        ]
      }]
    }],
    pages: [{
      id: "p1",
      title: {},
      elements: [
        { id: "contact", type: "contactNO", x: 50, y: 50, w: 8, h: 4.4, orientation: "horizontal", rotation: 90 },
        { id: "wire-left", type: "wire", points: [[47.8, 48], [47.8, 50]] },
        { id: "wire-right", type: "wire", points: [[47.8, 58], [47.8, 60]] },
        { id: "device", type: "deviceBox", x: 20, y: 30, w: 28, h: 16, pins: 4, rotation: 90 },
        { id: "wire-device", type: "wire", points: [[13.6, 30], [10, 30]] },
        { id: "terminal-box", type: "terminalBox", x: 80, y: 20, w: 22, h: 18, rows: 3, rotation: 90 },
        { id: "wire-terminal", type: "wire", points: [[71, 20], [68, 20]] }
      ]
    }]
  }));

  const elements = Object.fromEntries(migrated.pages[0].elements.map(element => [element.id, element]));
  expect(migrated.schemaVersion).toBe(4);
  expect(elements.contact).toMatchObject({ x: 50, y: 49, w: 10, rotation: 90 });
  expect(elements["wire-left"].points[1][0]).toBeCloseTo(47.8, 6);
  expect(elements["wire-left"].points[1][1]).toBeCloseTo(49, 6);
  expect(elements["wire-right"].points[0][0]).toBeCloseTo(47.8, 6);
  expect(elements["wire-right"].points[0][1]).toBeCloseTo(59, 6);

  expect(elements.device).toMatchObject({ x: 21.8, y: 30, w: 30, h: 25 });
  expect(elements["wire-device"].points[0][0]).toBeCloseTo(11.8, 6);
  expect(elements["wire-device"].points[0][1]).toBeCloseTo(30, 6);

  expect(elements["terminal-box"]).toMatchObject({ x: 79.5, y: 20, w: 22.5, h: 15 });
  expect(elements["wire-terminal"].points[0][0]).toBeCloseTo(72, 6);
  expect(elements["wire-terminal"].points[0][1]).toBeCloseTo(20, 6);

  expect(migrated.customSymbols[0].templates[0]).toMatchObject({ x: -1, w: 10 });
  expect(migrated.customSymbols[0].templates[1].points[0][0]).toBe(9);
  expect(migrated.customSymbols[1].template).toMatchObject({ x: 19, w: 10 });
  expect(migrated.standardPacks[0].customSymbols[0].templates[0]).toMatchObject({ x: 29, w: 10 });
  expect(migrated.standardPacks[0].customSymbols[0].templates[1].points[0][0]).toBe(39);
});

test("schema v3のCPとユニット列を接続を保ってv4へ移行し再適用しても変化しない", async ({ page }) => {
  const result = await page.evaluate(() => {
    const blankTerminal = (id, x, y) => ({
      id,
      type: "terminal",
      x,
      y,
      w: 1.8,
      h: 1.8,
      label: "",
      orientation: "horizontal",
      terminalShape: "circle",
      rotation: 0
    });
    const source = {
      schemaVersion: 3,
      customSymbols: [{
        id: "legacy-cp-custom",
        templates: [
          { id: "custom-cp", type: "breaker", symbolVariant: "cp", x: 0, y: 0, w: 10, h: 5, orientation: "horizontal", rotation: 0 },
          { id: "custom-wire", type: "wire", points: [[10, 3], [20, 3]] }
        ]
      }, {
        id: "legacy-single-unit",
        template: { id: "custom-plc", type: "plcBlock", plcStyle: "unit", x: 40, y: 0, w: 10.5, h: 9.5, rows: 1, rotation: 0 }
      }],
      standardPacks: [{
        customSymbols: [{
          id: "legacy-pack-strip",
          templates: [{ id: "pack-strip", type: "terminalStrip", stripStyle: "unit", orientation: "vertical", x: 60, y: 0, w: 10.5, h: 9.5, count: 1, rotation: 0 }]
        }]
      }],
      pages: [{
        id: "p1",
        title: {},
        elements: [
          { id: "cp-horizontal", type: "breaker", symbolVariant: "cp", x: 20, y: 30, w: 10, h: 5, orientation: "horizontal", rotation: 0 },
          { id: "cp-wire", type: "wire", points: [[30, 33], [40, 33]] },
          { id: "cp-line", type: "line", points: [[10, 33], [30, 33]] },
          { id: "cp-arrow", type: "arrow", points: [[30, 33], [45, 33]] },
          { id: "cp-junction", type: "junction", x: 30, y: 33 },
          { id: "cp-link", type: "mechanicalLink", points: [[25, 33], [25, 48]] },
          { id: "cp-horizontal-2", type: "breaker", symbolVariant: "cp", x: 20, y: 45, w: 10, h: 5, orientation: "horizontal", rotation: 0 },
          { id: "cp-vertical-rotated", type: "breaker", symbolVariant: "cp", x: 100, y: 50, w: 5, h: 10, orientation: "vertical", rotation: 90 },
          { id: "cp-vertical-wire", type: "wire", points: [[90, 52], [85, 52]] },
          { id: "cp-vertical-link", type: "mechanicalLink", points: [[95, 53.9], [80, 53.9]] },

          { id: "strip", type: "terminalStrip", stripStyle: "unit", orientation: "vertical", x: 130, y: 31.75, w: 10.5, h: 19, count: 2, levels: 1, rotation: 0 },
          { id: "strip-wire-1", type: "wire", points: [[100, 36.5], [130, 36.5]] },
          { id: "strip-wire-2", type: "wire", points: [[100, 46], [130, 46]] },
          blankTerminal("el-strip-1", 129.1, 35.6),
          blankTerminal("el-strip-2", 129.1, 45.1),
          { id: "custom-terminal", type: "terminal", x: 140, y: 40, w: 1.8, h: 1.8, label: "保守用", orientation: "horizontal", terminalShape: "circle", rotation: 0 },

          { id: "plc-output", type: "plcBlock", plcStyle: "unit", x: 42, y: 31.75, w: 10.5, h: 19, rows: 2, rotation: 0 },
          { id: "plc-output-wire-1", type: "wire", points: [[52.5, 36.5], [80, 36.5]] },
          { id: "plc-output-wire-2", type: "wire", points: [[52.5, 46], [80, 46]] },
          blankTerminal("el-output-1", 52.6, 35.6),
          blankTerminal("el-output-2", 52.6, 45.1),
          { id: "plc-standalone", type: "plcBlock", plcStyle: "unit", x: 80, y: 80, w: 10.5, h: 9.5, rows: 1, rotation: 0 },

          { id: "strip-incomplete", type: "terminalStrip", stripStyle: "unit", orientation: "vertical", x: 160, y: 31.75, w: 10.5, h: 19, count: 2, levels: 1, rotation: 0 },
          blankTerminal("el-incomplete-1", 159.1, 35.6),
          { id: "strip-two-level", type: "terminalStrip", stripStyle: "unit", orientation: "vertical", x: 170, y: 60, w: 16, h: 19, count: 2, levels: 2, rotation: 0 }
        ]
      }]
    };
    const migrated = window.__edsTest.migrateProjectData(source);
    const once = JSON.stringify(migrated);
    const migratedAgain = window.__edsTest.migrateProjectData(JSON.parse(once));
    return { migrated, idempotent: JSON.stringify(migratedAgain) === once };
  });

  const migrated = result.migrated;
  const elements = Object.fromEntries(migrated.pages[0].elements.map(element => [element.id, element]));
  expect(migrated.schemaVersion).toBe(4);
  expect(result.idempotent).toBe(true);

  expect(elements["cp-horizontal"]).toMatchObject({ w: 12.5, h: 5, cpLinked: true });
  expect(elements["cp-horizontal-2"]).toMatchObject({ w: 12.5, h: 5, cpLinked: true });
  expect(elements["cp-wire"].points[0]).toEqual([32.5, 33]);
  expect(elements["cp-line"].points[1]).toEqual([32.5, 33]);
  expect(elements["cp-arrow"].points[0]).toEqual([32.5, 33]);
  expect(elements["cp-junction"]).toMatchObject({ x: 32.5, y: 33 });
  expect(elements["cp-link"].points).toEqual([[24.75, 30.65], [24.75, 45.65]]);

  expect(elements["cp-vertical-rotated"]).toMatchObject({ w: 5, h: 12.5, cpLinked: true });
  expect(elements["cp-vertical-wire"].points[0]).toEqual([87.5, 52]);
  expect(elements["cp-vertical-link"].points[0]).toEqual([95.25, 54.35]);

  expect(elements.strip).toMatchObject({ x: 125, w: 10 });
  expect(elements["el-strip-1"]).toBeUndefined();
  expect(elements["el-strip-2"]).toBeUndefined();
  expect(elements["custom-terminal"]).toBeTruthy();
  expect(elements["plc-output"]).toMatchObject({ x: 47.5, w: 10 });
  expect(elements["el-output-1"]).toBeUndefined();
  expect(elements["el-output-2"]).toBeUndefined();
  expect(elements["plc-standalone"]).toMatchObject({ x: 75, w: 10 });
  expect(elements["strip-incomplete"]).toMatchObject({ x: 155, w: 10 });
  expect(elements["el-incomplete-1"]).toBeTruthy();
  expect(elements["strip-two-level"]).toMatchObject({ x: 170, w: 16, terminalNodeInset: 0 });

  expect(migrated.customSymbols[0].templates[0]).toMatchObject({ w: 12.5 });
  expect(migrated.customSymbols[0].templates[1].points[0]).toEqual([12.5, 3]);
  expect(migrated.customSymbols[1].template).toMatchObject({ x: 35, w: 10 });
  expect(migrated.standardPacks[0].customSymbols[0].templates[0]).toMatchObject({ x: 55, w: 10 });
});

test("不正な表題欄レイアウトを拒否してダイアログと履歴を壊さない", async ({ page }) => {
  const before = await page.evaluate(() => ({
    state: JSON.stringify(window.__edsTest.state),
    history: window.__edsTest.historyDiagnostics()
  }));

  await page.locator("#actionMenu").selectOption("titleLayout");
  await expect(page.locator("#dialogTitle")).toContainText("表題欄レイアウト編集");
  await page.locator("#titleLayoutJson").fill(JSON.stringify({ compact: { cells: [null] } }));
  await page.locator("#titleLayoutApplyBtn").click();

  await expect(page.locator("#status")).toContainText("適用に失敗");
  await expect(page.locator("#dialogBackdrop")).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(window.__edsTest.state))).toBe(before.state);
  expect(await page.evaluate(() => window.__edsTest.historyDiagnostics().count)).toBe(before.history.count);
});

test("標準パックの不正なユーザー部品・表題欄を入口で拒否する", async ({ page }) => {
  const before = await page.evaluate(() => JSON.stringify(window.__edsTest.state));
  const pack = {
    packVersion: 1,
    id: "broken-pack",
    customSymbols: [{ id: "broken-symbol", templates: {} }],
    titleLayouts: { compact: { cells: [null] } }
  };

  await page.locator("#packImportInput").setInputFiles({
    name: "broken-pack.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(pack))
  });
  await expect(page.locator("#status")).toContainText("取込を中止");
  expect(await page.evaluate(() => JSON.stringify(window.__edsTest.state))).toBe(before);

  await page.locator("#packImportInput").setInputFiles({
    name: "unsafe-pack.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"packVersion":1,"id":"unsafe-pack","catalog":[{"catalog":"X","__proto__":{"polluted":true}}]}')
  });
  await expect(page.locator("#status")).toContainText("使用できないキー");
  expect(await page.evaluate(() => JSON.stringify(window.__edsTest.state))).toBe(before);
});

test("下絵画像を履歴内で重複保持せずUndo/Redoで完全復元する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const imageData = "data:image/png;base64," + "A".repeat(2 * 1024 * 1024);
    window.__edsTest.installProjectData({
      schemaVersion: 3,
      activePageId: "underlay-page",
      pages: [{
        id: "underlay-page",
        title: {},
        elements: [{
          id: "underlay",
          type: "underlayImage",
          x: 10,
          y: 10,
          w: 100,
          h: 80,
          rotation: 0,
          imageData,
          opacity: 0.35,
          cropPreset: "full",
          locked: true,
          layer: "layout"
        }]
      }]
    });
    const element = window.__edsTest.state.pages[0].elements[0];
    for (let index = 1; index <= 8; index++) {
      element.opacity = 0.35 + index / 100;
      window.__edsTest.commitHistory("opacity " + index);
    }
    const afterCommits = window.__edsTest.historyDiagnostics();
    const lastIndex = afterCommits.index;
    window.__edsTest.restoreHistory(0);
    const undone = window.__edsTest.state.pages[0].elements[0];
    const undoOk = undone.imageData === imageData && undone.opacity === 0.35;
    window.__edsTest.restoreHistory(lastIndex);
    const redone = window.__edsTest.state.pages[0].elements[0];
    return {
      afterCommits,
      undoOk,
      redoOk: redone.imageData === imageData && Math.abs(redone.opacity - 0.43) < 0.0001
    };
  });

  expect(result.afterCommits.count).toBe(9);
  expect(result.afterCommits.imageAssetCount).toBe(1);
  expect(result.afterCommits.snapshotsContainImageData).toBe(false);
  expect(result.afterCommits.totalChars).toBeLessThan(200_000);
  expect(result.undoOk).toBe(true);
  expect(result.redoOk).toBe(true);
});

test("現在の大きな下絵を容量超過扱いせずUndo履歴を維持する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const imageData = "data:image/png;base64," + "Z".repeat(17 * 1024 * 1024);
    window.__edsTest.installProjectData({
      schemaVersion: 3,
      activePageId: "large-current-page",
      pages: [{
        id: "large-current-page",
        title: {},
        elements: [{
          id: "large-current",
          type: "underlayImage",
          x: 10,
          y: 10,
          w: 100,
          h: 80,
          rotation: 0,
          imageData,
          opacity: 0.35,
          cropPreset: "full",
          locked: true,
          layer: "layout"
        }]
      }]
    });
    window.__edsTest.state.pages[0].elements[0].opacity = 0.4;
    window.__edsTest.commitHistory("opacity 0.4");
    window.__edsTest.state.pages[0].elements[0].opacity = 0.45;
    window.__edsTest.commitHistory("opacity 0.45");
    return window.__edsTest.historyDiagnostics();
  });

  expect(result.count).toBe(3);
  expect(result.imageAssetCount).toBe(1);
  expect(result.historicalImageAssetChars).toBe(0);
});

test("異なる下絵画像を繰り返し差し替えても履歴アセット総量を上限内に保つ", async ({ page }) => {
  const result = await page.evaluate(() => {
    window.__edsTest.installProjectData({
      schemaVersion: 3,
      activePageId: "asset-page",
      pages: [{ id: "asset-page", title: {}, elements: [] }]
    });
    const pageState = window.__edsTest.state.pages[0];
    ["A", "B", "C", "D"].forEach((fill, index) => {
      pageState.elements = [{
        id: "underlay-" + index,
        type: "underlayImage",
        x: 10,
        y: 10,
        w: 100,
        h: 80,
        rotation: 0,
        imageData: "data:image/png;base64," + fill.repeat(17 * 1024 * 1024),
        opacity: 0.35,
        cropPreset: "full",
        locked: true,
        layer: "layout"
      }];
      window.__edsTest.commitHistory("image " + fill);
      pageState.elements = [];
      window.__edsTest.commitHistory("remove " + fill);
    });
    const limited = window.__edsTest.historyDiagnostics();
    window.__edsTest.restoreHistory(limited.count - 2);
    const latestUndo = window.__edsTest.state.pages[0].elements[0]?.imageData.startsWith("data:image/png;base64,D");
    window.__edsTest.restoreHistory(limited.count - 1);
    return {
      limited,
      latestUndo,
      latestRedo: window.__edsTest.state.pages[0].elements.length === 0
    };
  });

  expect(result.limited.historicalImageAssetChars).toBeLessThanOrEqual(result.limited.maxHistoricalImageAssetChars);
  expect(result.limited.imageAssetCount).toBeLessThanOrEqual(3);
  expect(result.latestUndo).toBe(true);
  expect(result.latestRedo).toBe(true);
});

test("通常データ内の履歴参照名と下絵アセット参照を混同しない", async ({ page }) => {
  const result = await page.evaluate(() => {
    const markerLikeData = { __edsHistoryImageRef: "not-an-underlay-asset" };
    window.__edsTest.installProjectData({
      schemaVersion: 3,
      activePageId: "marker-page",
      pages: [{
        id: "marker-page",
        name: "before",
        title: { custom: markerLikeData },
        elements: []
      }]
    });
    window.__edsTest.state.pages[0].name = "after";
    window.__edsTest.commitHistory("rename");
    window.__edsTest.restoreHistory(0);
    return {
      name: window.__edsTest.state.pages[0].name,
      custom: window.__edsTest.state.pages[0].title.custom,
      index: window.__edsTest.historyDiagnostics().index
    };
  });

  expect(result).toEqual({
    name: "before",
    custom: { __edsHistoryImageRef: "not-an-underlay-asset" },
    index: 0
  });
});

test("Undo/Redoは削除済みの任意トップレベルキーも正確に復元する", async ({ page }) => {
  const result = await page.evaluate(() => {
    window.__edsTest.state.titleLayouts = {
      compact: { w: 40, h: 20, cells: [] },
      detailed: { w: 40, h: 20, cells: [] }
    };
    window.__edsTest.commitHistory("layout added");
    const addedIndex = window.__edsTest.historyDiagnostics().index;
    delete window.__edsTest.state.titleLayouts;
    window.__edsTest.commitHistory("layout removed");
    const removedIndex = window.__edsTest.historyDiagnostics().index;
    window.__edsTest.restoreHistory(addedIndex);
    const restored = Object.prototype.hasOwnProperty.call(window.__edsTest.state, "titleLayouts");
    window.__edsTest.restoreHistory(removedIndex);
    const removedAgain = !Object.prototype.hasOwnProperty.call(window.__edsTest.state, "titleLayouts");
    return { restored, removedAgain };
  });

  expect(result).toEqual({ restored: true, removedAgain: true });
});

test("ブラウザ内プロジェクト保管庫の配列・null項目を無視する", async ({ page }) => {
  const result = await page.evaluate(() => {
    localStorage.setItem("electricalDrawingStudio.projects", JSON.stringify([null, { snapshot: null }]));
    const arrayStore = window.__edsTest.readProjectStore();
    localStorage.setItem("electricalDrawingStudio.projects", JSON.stringify({ bad: null, alsoBad: { snapshot: 42 } }));
    const objectStore = window.__edsTest.readProjectStore();
    localStorage.setItem(
      "electricalDrawingStudio.projects",
      '{"__proto__":{"id":"__proto__","label":"safe","snapshot":"{}"}}'
    );
    const specialKeyStore = window.__edsTest.readProjectStore();
    return {
      arrayStore,
      objectStore,
      specialKeyStore: {
        nullPrototype: Object.getPrototypeOf(specialKeyStore) === null,
        hasOwnEntry: Object.prototype.hasOwnProperty.call(specialKeyStore, "__proto__"),
        label: specialKeyStore["__proto__"]?.label,
        polluted: specialKeyStore.polluted
      }
    };
  });

  expect(result).toEqual({
    arrayStore: {},
    objectStore: {},
    specialKeyStore: {
      nullPrototype: true,
      hasOwnEntry: true,
      label: "safe",
      polluted: undefined
    }
  });
});

test("AC受電・分岐は100V単相の既定値と接地省略を矛盾なく反映する", async ({ page }) => {
  await page.locator("#templateMenu").selectOption("acPower");
  await page.locator("#acVolt").selectOption("100");
  await expect(page.locator("#acInRails")).toHaveValue("R,N");
  await expect(page.locator("#acOutRails")).toHaveValue("R01,N01");
  await expect(page.locator("#acElbModel")).toHaveValue("NV63-CVF 2P 20A");
  await expect(page.locator("#acTr")).toHaveValue("off");
  await expect(page.locator("#acTr")).toBeDisabled();

  await page.locator("#acVolt").selectOption("200");
  await expect(page.locator("#acInRails")).toHaveValue("R,S,T");
  await expect(page.locator("#acOutRails")).toHaveValue("R01,S01,T01");
  await expect(page.locator("#acElbModel")).toHaveValue("NV63-CVF 3P 20A");
  await expect(page.locator("#acTr")).toHaveValue("100VA");
  await expect(page.locator("#acTr")).toBeEnabled();

  await page.locator("#acVolt").selectOption("100");
  await page.locator("#acBuildBtn").click();
  const singlePhase = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    const table = current.elements.find(element => element.type === "table");
    return {
      rails: current.elements.filter(element => element.type === "wire" && element.ladderRail).map(element => element.ladderRail).sort(),
      transformerCount: current.elements.filter(element => element.type === "transformer").length,
      verticalElbPoles: current.elements.filter(element => element.type === "breaker" && element.orientation === "vertical").length,
      tableText: table?.cellText || ""
    };
  });
  expect(singlePhase.rails).toEqual(["G", "N01", "R01"]);
  expect(singlePhase.transformerCount).toBe(0);
  expect(singlePhase.verticalElbPoles).toBe(2);
  expect(singlePhase.tableText).toContain("R N\t6.0mm2");
  expect(singlePhase.tableText).not.toContain("R S T\t");

  await page.goto(appUrl, { waitUntil: "load" });
  await page.locator("#templateMenu").selectOption("acPower");
  await page.locator("#acGround").fill("");
  await page.locator("#acBuildBtn").click();
  const noGround = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    const table = current.elements.find(element => element.type === "table");
    return {
      rails: current.elements.filter(element => element.type === "wire" && element.ladderRail).map(element => element.ladderRail),
      tableText: table?.cellText || ""
    };
  });
  expect(noGround.rails).not.toContain("G");
  expect(noGround.tableText.split("\n").some(line => line.startsWith("G\t"))).toBe(false);
});

test("ACモータは駆動方式の既定値を同期し1軸とモータタグを正しく反映する", async ({ page }) => {
  await page.locator("#templateMenu").selectOption("acMotor");
  await expect(page.locator('#acDrive option[value="servo"]')).toHaveText("サーボアンプ");
  await page.locator("#acDrive").selectOption("inverter");
  await expect(page.locator("#acRails")).toHaveValue("R01,S01,T01");
  await expect(page.locator("#acContactTag")).toHaveValue("MC2M1");
  await expect(page.locator("#acMotorTag")).toHaveValue("M1");
  await page.locator("#acDrive").selectOption("servo");
  await expect(page.locator("#acRails")).toHaveValue("R1,S1,T1");
  await expect(page.locator("#acContactTag")).toHaveValue("MS1M");
  await expect(page.locator("#acMotorTag")).toHaveValue("SM1");

  await page.locator("#acAxes").selectOption("1");
  await page.locator("#acMotorTag").fill("AX9");
  await page.locator("#acMotorBuildBtn").click();
  const servo = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    return {
      motors: current.elements.filter(element => element.type === "motor").map(element => element.tag),
      brakeRelayCoils: current.elements.filter(element => element.type === "coil" && String(element.tag || "").startsWith("CRMBR")).map(element => element.tag),
      brakeRelayContacts: current.elements.filter(element => element.type === "contactNO" && String(element.tag || "").startsWith("CRMBR")).map(element => element.tag),
      signalLabels: current.elements.filter(element => element.type === "arrow").map(element => element.label)
    };
  });
  expect(servo.motors).toEqual(["AX9"]);
  expect(servo.brakeRelayCoils).toEqual(["CRMBR1"]);
  expect(new Set(servo.brakeRelayContacts)).toEqual(new Set(["CRMBR1"]));
  expect(servo.signalLabels).toContain("AX9エンコーダ");
  expect(servo.signalLabels).not.toContain("AX10エンコーダ");
  await page.locator("#auditBtn").click();
  await expect(page.locator("#dialogBody")).not.toContainText("CRMBR2");
  await expect(page.locator("#dialogBody tr").filter({ hasText: "同一部品種別で部品タグが重複" }).filter({ hasText: "CRMBR1" })).toHaveCount(0);

  await page.goto(appUrl, { waitUntil: "load" });
  await page.locator("#templateMenu").selectOption("acMotor");
  await page.locator("#acDrive").selectOption("inverter");
  await page.locator("#acMotorBuildBtn").click();
  const inverter = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    return {
      rails: current.elements.filter(element => element.type === "wire" && element.ladderRail).map(element => element.ladderRail).sort(),
      motors: current.elements.filter(element => element.type === "motor").map(element => element.tag),
      contactTags: [...new Set(current.elements.filter(element => element.type === "contactNO").map(element => element.tag).filter(Boolean))],
      mechanicalLink: current.elements.find(element => element.type === "mechanicalLink")?.points
    };
  });
  expect(inverter.rails).toEqual(["G", "R01", "S01", "T01"]);
  expect(inverter.motors).toEqual(["M1"]);
  expect(inverter.contactTags).toContain("MC2M1");
  expect(inverter.mechanicalLink).toEqual([[59.75, 90.25], [59.75, 100.25]]);
});

test("全テンプレートの接続点・配線・主要枠は2.5mmグリッド上にありIDも重複しない", async ({ page }) => {
  test.setTimeout(60_000);
  const cases = [
    { name: "facility", option: "facilityLadder", button: "#ladBuildBtn", setup: [], expected: { wire: 2 } },
    { name: "ac200", option: "acPower", button: "#acBuildBtn", setup: [], expected: { breaker: 19, transformer: 1 } },
    { name: "ac100", option: "acPower", button: "#acBuildBtn", setup: [["#acVolt", "100"]], expected: { breaker: 18, transformer: 0 } },
    { name: "servo2", option: "acMotor", button: "#acMotorBuildBtn", setup: [], expected: { motor: 2, resistor: 2 } },
    { name: "servo1", option: "acMotor", button: "#acMotorBuildBtn", setup: [["#acAxes", "1"]], expected: { motor: 1, resistor: 1 } },
    { name: "inverter", option: "acMotor", button: "#acMotorBuildBtn", setup: [["#acDrive", "inverter"]], expected: { motor: 1, thermalElement: 2 } },
    { name: "dc", option: "dcPower", button: "#dcBuildBtn", setup: [], expected: { breaker: 4, ground: 2 } },
    { name: "plc", option: "plcPower", button: "#plcpBuildBtn", setup: [], expected: { breaker: 4, contactNO: 4 } },
    { name: "safety", option: "safetyRelay", button: "#sfBuildBtn", setup: [], expected: { pushButton: 2, contactNO: 2, contactNC: 1 } },
    { name: "plc-io", option: "plcInput", button: "#plcInBuildBtn", setup: [], expected: { plcBlock: 1, contactNO: 16 } },
    { name: "terminal", option: "terminalSheet", button: null, setup: [], expected: { terminalStrip: 1 } },
    { name: "interlock", option: "interlock", button: "#ilBuildBtn", setup: [], expected: { terminal: 8 } },
    { name: "ladder", option: "ladder", button: null, setup: [], expected: { wire: 12 } },
    { name: "index", option: "index", button: null, setup: [], expected: { table: 1 } },
    { name: "layout", option: "layout", button: null, setup: [], expected: { installationBox: 1 } }
  ];

  for (const item of cases) {
    await page.goto(appUrl, { waitUntil: "load" });
    await page.locator("#templateMenu").selectOption(item.option);
    for (const [selector, value] of item.setup) await page.locator(selector).selectOption(value);
    if (item.button) await page.locator(item.button).click();
    const result = await page.evaluate(() => {
      const current = window.__edsTest.state.pages.find(entry => entry.id === window.__edsTest.state.activePageId);
      const onGrid = value => Number.isFinite(value) && Math.abs(value / 2.5 - Math.round(value / 2.5)) < 0.001;
      const violations = [];
      const counts = {};
      for (const element of current.elements) {
        counts[element.type] = (counts[element.type] || 0) + 1;
        // mechanicalLinkは操作軸の描画であり、電気接続ピンではない。CP弧頂点の実測位置を優先する。
        const points = element.type === "mechanicalLink" ? [] : element.type === "junction"
          ? [{ x: Number(element.x), y: Number(element.y) }]
          : Array.isArray(element.points)
          ? element.points.map(point => ({ x: Number(point[0]), y: Number(point[1]) }))
          : window.__edsTest.elementConnectionAnchors(element);
        if (element.type !== "mechanicalLink" && Array.isArray(element.gapPoints)) {
          points.push(...element.gapPoints.map(point => ({ x: Number(point[0]), y: Number(point[1]) })));
        }
        if (["rect", "installationBox"].includes(element.type) && !element.gridEdgeException) {
          points.push(
            { x: Number(element.x), y: Number(element.y) },
            { x: Number(element.x) + Number(element.w), y: Number(element.y) + Number(element.h) }
          );
        }
        if ((element.type === "plcBlock" && element.plcStyle === "unit")
          || (element.type === "terminalStrip" && element.stripStyle === "unit")) {
          points.push(
            { x: Number(element.x), y: Number(element.y) },
            { x: Number(element.x) + Number(element.w), y: Number(element.y) + Number(element.h) }
          );
        }
        points.forEach(point => {
          if (!onGrid(point.x) || !onGrid(point.y)) {
            violations.push({ type: element.type, x: point.x, y: point.y });
          }
        });
      }
      const ids = current.elements.map(element => element.id);
      const visibleTexts = [...document.querySelectorAll('#canvas g[data-id] > text')].map(node => {
        const rect = node.getBoundingClientRect();
        return { id: node.parentElement?.dataset.id || "", value: node.textContent || "", left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
      const textOverlaps = [];
      for (let i = 0; i < visibleTexts.length; i += 1) {
        for (let j = i + 1; j < visibleTexts.length; j += 1) {
          const a = visibleTexts[i], b = visibleTexts[j];
          const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (overlapX > 1 && overlapY > 1) textOverlaps.push([a.value, b.value]);
        }
      }
      return { counts, violations, textOverlaps, duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index) };
    });
    expect(result.violations, `${item.name}の接続点`).toEqual([]);
    expect(result.textOverlaps, `${item.name}の文字重なり`).toEqual([]);
    expect(result.duplicateIds, `${item.name}の要素ID`).toEqual([]);
    for (const [type, count] of Object.entries(item.expected)) expect(result.counts[type] || 0, `${item.name}:${type}`).toBe(count);
  }
});

test("CP・切替スイッチ・入切表示は見本PDFの実測形状を共有定義で再現する", async ({ page }) => {
  const geometry = await page.evaluate(() => {
    const cp = window.__edsTest.SYMBOL_GEO.breakerCp;
    const selector = window.__edsTest.SYMBOL_GEO.selectorSwitch;
    const positionBox = window.__edsTest.SYMBOL_GEO.positionMarkBox;
    const cpElement = {
      ...window.__edsTest.defaultElement("breaker", 0, 0),
      symbolVariant: "cp",
      w: 12.5,
      h: 5
    };
    return {
      cp: { w: cp.w, anchors: cp.anchors, prims: cp.prims },
      selector: { anchors: selector.anchors, prims: selector.prims },
      positionBox: positionBox.prims,
      singleCpStemCount: window.__edsTest.geoPrims(cpElement).filter(prim => prim.when === "cpLinked").length,
      linkedCpStemCount: window.__edsTest.geoPrims({ ...cpElement, cpLinked: true }).filter(prim => prim.when === "cpLinked").length
    };
  });

  expect(geometry.cp.w).toBe(12.5);
  expect(geometry.cp.anchors).toEqual([[0, 3], [12.5, 3]]);
  expect(geometry.cp.prims).toEqual(expect.arrayContaining([
    expect.objectContaining({ t: "circle", p: [2.4, 3, 0.6] }),
    expect.objectContaining({ t: "circle", p: [7.1, 3, 0.6] }),
    expect.objectContaining({ t: "arc", p: [4.75, 3, 2.35, 180, 360] }),
    expect.objectContaining({ t: "line", p: [4.75, 0.65, 4.75, 4.2], when: "cpLinked" }),
    expect.objectContaining({ t: "pline", pts: expect.arrayContaining([[8.4, 2.3], [9.7, 3.7], [12.5, 3]]) })
  ]));

  const selectorCircles = geometry.selector.prims.filter(prim => prim.t === "circle").map(prim => prim.p);
  const selectorArms = geometry.selector.prims.filter(prim => prim.t === "pline").map(prim => prim.pts);
  expect(geometry.selector.anchors).toEqual([[0, 3.2], [10, 3.2]]);
  expect(selectorCircles).toEqual([[3, 3.2, 0.6], [6.45, 3.2, 0.6]]);
  expect(selectorArms).toEqual([
    [[3.6, 3.2], [4.2, 3.2], [4.2, 1.95]],
    [[5.15, 1.95], [5.15, 3.2], [5.85, 3.2]]
  ]);
  expect(geometry.positionBox[0]).toEqual({ t: "rect", p: [1, 1.9, 2, 2.2] });
  expect(geometry.positionBox[1]).toEqual({ t: "line", p: [2, 0, 2, 6] });
  expect(geometry.singleCpStemCount).toBe(0);
  expect(geometry.linkedCpStemCount).toBe(1);
});

test("切替スイッチは入・切表示付き見本形を単体で作図できる", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 4,
    activePageId: "p1",
    pages: [{
      id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {},
      elements: [{
        ...window.__edsTest.defaultElement("selectorSwitch", 30, 30),
        id: "selector-onoff",
        symbolVariant: "onOff",
        w: 30,
        h: 8,
        label: "SS1"
      }]
    }]
  }));
  await page.evaluate(() => window.__edsTest.selectElement("selector-onoff"));

  const variantSelect = page.locator('[data-bind="symbolVariant"]');
  await expect(variantSelect.locator('option[value="onOff"]')).toHaveCount(1);
  await expect(page.locator('[data-id="selector-onoff"] text').filter({ hasText: "切" })).toHaveCount(1);
  await expect(page.locator('[data-id="selector-onoff"] text').filter({ hasText: "入" })).toHaveCount(1);

  const result = await page.evaluate(() => {
    const geo = window.__edsTest.SYMBOL_GEO.selectorSwitchOnOff;
    const dxf = window.__edsTest.buildDxf(window.__edsTest.state.pages[0]);
    return {
      size: [geo.w, geo.h],
      anchors: geo.anchors,
      fixedLabels: geo.prims.filter(prim => prim.t === "text" && prim.value).map(prim => prim.value),
      dxfHasOn: dxf.includes("入"),
      dxfHasOff: dxf.includes("切")
    };
  });
  expect(result).toEqual({
    size: [30, 8],
    anchors: [[0, 3.2], [10, 3.2]],
    fixedLabels: ["切", "入"],
    dxfHasOn: true,
    dxfHasOff: true
  });
});

test("遮断器バリエーションは重複を整理し端子円を線より前面に描く", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 4,
    activePageId: "p1",
    pages: [{
      id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {},
      elements: [{ ...window.__edsTest.defaultElement("breaker", 30, 30), id: "breaker1", label: "CB1" }]
    }]
  }));
  await page.evaluate(() => window.__edsTest.selectElement("breaker1"));

  const variantSelect = page.locator('[data-bind="symbolVariant"]');
  await expect(variantSelect.locator('option[value="arc"]')).toHaveCount(1);
  await expect(variantSelect.locator('option[value="mccb"]')).toHaveCount(1);
  await expect(variantSelect.locator('option[value="cp"]')).toHaveCount(0);

  const geometry = await page.evaluate(() => {
    const geo = window.__edsTest.SYMBOL_GEO;
    const shape = key => geo[key].prims.filter(prim => prim.t !== "text");
    return {
      arc: shape("breakerArc"),
      mccb: shape("breakerMccb"),
      cpTypes: shape("breakerCp").map(prim => prim.t),
      standard: JSON.stringify(shape("breaker")),
      arcSignature: JSON.stringify(shape("breakerArc")),
      mccbSignature: JSON.stringify(shape("breakerMccb"))
    };
  });

  expect(new Set([geometry.standard, geometry.arcSignature, geometry.mccbSignature]).size).toBe(3);
  expect(geometry.arc.some(prim => prim.t === "pline")).toBe(false);
  expect(geometry.mccb.some(prim => prim.t === "rect")).toBe(true);
  expect(geometry.cpTypes.indexOf("arc")).toBeLessThan(geometry.cpTypes.indexOf("circle"));
});

test("端子台・PLCユニット列はSVG・吸着点・DXFで同じ端子円中心を使う", async ({ page }) => {
  const result = await page.evaluate(() => {
    const strip = {
      ...window.__edsTest.defaultElement("terminalStrip", 125, 31.75),
      id: "strip-one",
      w: 10,
      h: 19,
      count: 2,
      orientation: "vertical",
      stripStyle: "unit",
      terminalLabels: "1\n2"
    };
    const stripTwo = {
      ...window.__edsTest.defaultElement("terminalStrip", 150, 31.75),
      id: "strip-two",
      w: 20,
      h: 9.5,
      count: 1,
      levels: 2,
      orientation: "vertical",
      stripStyle: "unit",
      terminalLabels: "A\nB"
    };
    const plc = {
      ...window.__edsTest.defaultElement("plcBlock", 175, 31.75),
      id: "plc-unit",
      plcStyle: "unit",
      w: 10,
      h: 19,
      rows: 2,
      pinText: "X0\nX1"
    };
    const plcGrid = {
      ...window.__edsTest.defaultElement("plcBlock", 190, 32.5),
      id: "plc-grid-unit",
      plcStyle: "unit",
      w: 10,
      h: 20,
      rows: 2,
      pitch: 10,
      pinText: "Y0\nY1"
    };
    window.__edsTest.installProjectData({
      schemaVersion: 4,
      activePageId: "p1",
      pages: [{ id: "p1", name: "unit-test", size: "A4", orientation: "portrait", title: {}, elements: [strip, stripTwo, plc, plcGrid] }]
    });
    const current = window.__edsTest.state.pages.find(item => item.id === "p1");
    return {
      stripAnchors: window.__edsTest.elementConnectionAnchors(strip),
      stripTwoAnchors: window.__edsTest.elementConnectionAnchors(stripTwo),
      plcAnchors: window.__edsTest.elementConnectionAnchors(plc),
      plcGridAnchors: window.__edsTest.elementConnectionAnchors(plcGrid),
      dxf: window.__edsTest.buildDxf(current)
    };
  });

  expect(result.stripAnchors).toEqual([{ x: 130, y: 36.5 }, { x: 130, y: 46 }]);
  expect(result.stripTwoAnchors).toEqual([{ x: 155, y: 36.5 }, { x: 165, y: 36.5 }]);
  expect(result.plcAnchors).toEqual([{ x: 180, y: 36.5 }, { x: 180, y: 46 }]);
  expect(result.plcGridAnchors).toEqual([{ x: 195, y: 37.5 }, { x: 195, y: 47.5 }]);
  await expect(page.locator('g[data-id="strip-one"] circle')).toHaveCount(2);
  expect(await page.locator('g[data-id="strip-one"] circle').evaluateAll(nodes => nodes.map(node => [Number(node.getAttribute("cx")), Number(node.getAttribute("cy"))]))).toEqual([[5, 4.75], [5, 14.25]]);
  expect(await page.locator('g[data-id="strip-two"] circle').evaluateAll(nodes => nodes.map(node => [Number(node.getAttribute("cx")), Number(node.getAttribute("cy"))]))).toEqual([[5, 4.75], [15, 4.75]]);
  expect(await page.locator('g[data-id="plc-unit"] circle').evaluateAll(nodes => nodes.map(node => [Number(node.getAttribute("cx")), Number(node.getAttribute("cy"))]))).toEqual([[5, 4.75], [5, 14.25]]);
  expect(await page.locator('g[data-id="plc-grid-unit"] circle').evaluateAll(nodes => nodes.map(node => [Number(node.getAttribute("cx")), Number(node.getAttribute("cy"))]))).toEqual([[5, 5], [5, 15]]);

  const lines = result.dxf.trim().split(/\r?\n/);
  const circles = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    if (lines[i].trim() !== "0" || lines[i + 1].trim() !== "CIRCLE") continue;
    const entity = {};
    for (let j = i + 2; j + 1 < lines.length; j += 2) {
      const code = lines[j].trim();
      if (code === "0") break;
      entity[code] = lines[j + 1].trim();
    }
    if (entity[8] === "SYMBOL" && Number(entity[40]) === 3.2) circles.push([Number(entity[10]), Number(entity[20])]);
  }
  expect(circles).toEqual(expect.arrayContaining([
    [130, 260.5], [130, 251], [155, 260.5], [165, 260.5], [180, 260.5], [180, 251], [195, 259.5], [195, 249.5]
  ]));

  await page.locator('g[data-id="plc-grid-unit"]').click();
  await expect(page.locator('#selectionPanel input[data-bind="rows"]')).toHaveValue("2");
  await page.locator('#selectionPanel input[data-bind="rows"]').fill("3");
  await page.locator('#selectionPanel input[data-bind="rows"]').press("Tab");
  expect(await page.evaluate(() => {
    const unit = window.__edsTest.state.pages[0].elements.find(element => element.id === "plc-grid-unit");
    return {
      h: unit.h,
      pitch: unit.pitch,
      anchors: window.__edsTest.elementConnectionAnchors(unit)
    };
  })).toEqual({
    h: 30,
    pitch: 10,
    anchors: [{ x: 195, y: 37.5 }, { x: 195, y: 47.5 }, { x: 195, y: 57.5 }]
  });
  await page.locator('#selectionPanel input[data-bind="rows"]').fill("20");
  await page.locator('#selectionPanel input[data-bind="rows"]').press("Tab");
  expect(await page.evaluate(() => {
    const unit = window.__edsTest.state.pages[0].elements.find(element => element.id === "plc-grid-unit");
    return { rows: unit.rows, h: unit.h, bottom: unit.y + unit.h };
  })).toEqual({ rows: 19, h: 190, bottom: 222.5 });
});

test("テンプレート形状と非常停止の10mm接点間隔を属性パネルで正しく保持する", async ({ page }) => {
  await page.locator("#templateMenu").selectOption("acPower");
  await page.locator("#acBuildBtn").click();
  const acSymbols = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    return ["Tr1", "SC1", "SC2"].map(tag => {
      const element = current.elements.find(item => item.tag === tag);
      return { id: element.id, variant: element.symbolVariant };
    });
  });
  expect(acSymbols.map(item => item.variant)).toEqual(["grid10", "boxGrid10", "boxGrid10"]);
  for (const symbol of acSymbols) {
    await page.evaluate(id => window.__edsTest.selectElement(id), symbol.id);
    await expect(page.locator('#selectionPanel select[data-bind="symbolVariant"]')).toHaveValue(symbol.variant);
  }
  expect(await page.evaluate(() => {
    const normalized = window.__edsTest.normalizeProjectData(window.__edsTest.state);
    const current = normalized.pages.find(item => item.id === normalized.activePageId);
    return ["Tr1", "SC1", "SC2"].map(tag => current.elements.find(item => item.tag === tag)?.symbolVariant);
  })).toEqual(["grid10", "boxGrid10", "boxGrid10"]);

  await page.goto(appUrl, { waitUntil: "load" });
  await page.locator("#templateMenu").selectOption("safetyRelay");
  await page.locator("#sfBuildBtn").click();
  const pushButtonId = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    return current.elements.find(item => item.type === "pushButton").id;
  });
  await page.evaluate(id => window.__edsTest.selectElement(id), pushButtonId);
  await expect(page.locator('#selectionPanel select[data-bind="symbolVariant"]')).toHaveValue("multi2");
  await expect(page.locator('#selectionPanel input[data-bind="contactGap"]')).toHaveValue("10");
});

test("PLCユニット単体生成は10mmピッチを保ち機器符号表へ侵入しない", async ({ page }) => {
  await page.locator("#actionMenu").selectOption("plcUnit");
  await page.locator("#plcUnitCount").fill("20");
  await page.locator("#plcUnitBuildBtn").click();
  const unit = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    const element = current.elements.find(item => item.type === "plcBlock" && item.plcStyle === "unit");
    return { rows: element.rows, pitch: element.pitch, y: element.y, h: element.h, bottom: element.y + element.h };
  });
  expect(unit).toEqual({ rows: 19, pitch: 10, y: 32.5, h: 190, bottom: 222.5 });
  expect(unit.bottom).toBeLessThan(224);
});

test("端子接続図・PLC入出力・汎用ラダーは端子の重ね順と母線表示を保つ", async ({ page }) => {
  await page.locator("#templateMenu").selectOption("terminalSheet");
  let result = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    const stripIndex = current.elements.findIndex(element => element.type === "terminalStrip" && element.stripStyle === "unit");
    const strip = current.elements[stripIndex];
    return {
      stripIndex,
      lastWireIndex: Math.max(...current.elements.map((element, index) => element.type === "wire" ? index : -1)),
      stripX: strip.x,
      stripW: strip.w,
      firstAnchor: window.__edsTest.elementConnectionAnchors(strip)[0],
      signalXs: current.elements.filter(element => element.type === "text" && /^SIG/.test(element.text || "")).map(element => element.x),
      duplicateSmallTerminals: current.elements.filter(element => element.type === "terminal" && !element.label).length
    };
  });
  expect(result.stripIndex).toBeGreaterThan(result.lastWireIndex);
  expect([result.stripX, result.stripW, result.firstAnchor.x]).toEqual([125, 10, 130]);
  expect(new Set(result.signalXs)).toEqual(new Set([149.5]));
  expect(result.duplicateSmallTerminals).toBe(0);

  await page.goto(appUrl, { waitUntil: "load" });
  await page.locator("#templateMenu").selectOption("plcInput");
  await page.locator("#plcInBuildBtn").click();
  result = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    const unitIndex = current.elements.findIndex(element => element.type === "plcBlock" && element.plcStyle === "unit");
    const unit = current.elements[unitIndex];
    return {
      unitIndex,
      lastWireIndex: Math.max(...current.elements.map((element, index) => element.type === "wire" ? index : -1)),
      unitX: unit.x,
      unitW: unit.w,
      firstAnchor: window.__edsTest.elementConnectionAnchors(unit)[0],
      duplicateSmallTerminals: current.elements.filter(element => element.type === "terminal" && !element.label).length
    };
  });
  expect(result.unitIndex).toBeGreaterThan(result.lastWireIndex);
  expect([result.unitX, result.unitW, result.firstAnchor.x]).toEqual([125, 10, 130]);
  expect(result.duplicateSmallTerminals).toBe(0);

  await page.goto(appUrl, { waitUntil: "load" });
  await page.locator("#templateMenu").selectOption("ladder");
  const rails = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    return current.elements.filter(element => element.type === "wire" && element.ladderRail).map(element => ({ wireNo: element.wireNo, hideWireNo: element.hideWireNo }));
  });
  expect(rails).toEqual([{ wireNo: "", hideWireNo: true }, { wireNo: "", hideWireNo: true }]);
});

test("非常停止チェーン4局とセーフティ回路は重複配線・文字横断・無接続交差を作らない", async ({ page }) => {
  await page.locator("#actionMenu").selectOption("estopChain");
  await page.locator("#esCount").fill("4");
  await page.locator("#esBuildBtn").click();
  const chain = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    const wires = current.elements.filter(element => element.type === "wire" && Array.isArray(element.points));
    const zeroLength = wires.filter(element => element.points.length < 2 || element.points.every(point => Math.abs(point[0] - element.points[0][0]) < .001 && Math.abs(point[1] - element.points[0][1]) < .001));
    const loopWires = wires.filter(element => element.points.length === 5);
    const firstChainButtons = current.elements.filter(element => element.type === "pushButton" && element.label).map(element => element.x);
    const maxArrowX = Math.max(...current.elements.filter(element => element.type === "arrow" && element.signalRole === "source").flatMap(element => element.points.map(point => point[0])));
    return {
      zeroLength: zeroLength.length,
      firstChainButtons,
      maxArrowX,
      rails: current.elements.filter(element => element.type === "wire" && element.ladderRail).map(element => element.ladderRail).sort(),
      loopMidYs: loopWires.map(element => element.points[2][1]),
      lampLineLimits: current.elements.filter(element => element.type === "lamp" && /^PBE/.test(element.label || "")).map(element => Math.floor(((element.y + 2.2) - 6.5) / 2.5) * 2.5)
    };
  });
  expect(chain.zeroLength).toBe(0);
  expect(chain.firstChainButtons).toEqual([37.5, 65, 92.5, 120]);
  expect(chain.maxArrowX).toBeLessThanOrEqual(145);
  expect(chain.rails).toEqual(["N1", "P1"]);
  expect(chain.loopMidYs).toEqual(chain.lampLineLimits);

  await page.goto(appUrl, { waitUntil: "load" });
  await page.locator("#templateMenu").selectOption("safetyRelay");
  await page.locator("#sfBuildBtn").click();
  const safetyGap = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    const wire = current.elements.find(element => element.type === "wire" && element.wireNo === "1N32");
    return wire?.gapPoints || [];
  });
  expect(safetyGap).toEqual([[45, 65]]);
});

test("AC受電テンプレートはSS0・線番円・切→入表示を見本順で接続する", async ({ page }) => {
  await page.locator("#templateMenu").selectOption("acPower");
  await page.locator("#acBuildBtn").click();
  const result = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    const selector = current.elements.find(element => element.type === "selectorSwitch" && element.label === "SS0");
    const marks = current.elements.filter(element => element.type === "positionMark").map(element => ({
      label: element.label,
      style: element.markStyle,
      anchor: window.__edsTest.elementConnectionAnchors(element)[0]
    }));
    const numberedTerminals = current.elements.filter(element => element.type === "terminal" && ["201", "201A", "202"].includes(element.label)).map(element => ({
      label: element.label,
      anchor: window.__edsTest.elementConnectionAnchors(element)[0]
    }));
    const standalonePositionText = current.elements.filter(element => element.type === "text" && ["切", "入"].includes(element.text));
    const cp = current.elements.filter(element => element.type === "breaker" && element.symbolVariant === "cp");
    return {
      selectorAnchors: window.__edsTest.elementConnectionAnchors(selector),
      marks,
      numberedTerminals,
      standalonePositionText: standalonePositionText.length,
      cpWidths: [...new Set(cp.map(element => element.orientation === "vertical" ? element.h : element.w))]
    };
  });

  expect(result.selectorAnchors).toEqual([{ x: 75, y: 85 }, { x: 85, y: 85 }]);
  expect(result.marks).toEqual([
    { label: "切", style: "line", anchor: { x: 92.5, y: 85 } },
    { label: "入", style: "box", anchor: { x: 102.5, y: 85 } }
  ]);
  expect(result.numberedTerminals).toEqual(expect.arrayContaining([
    { label: "201", anchor: { x: 75, y: 85 } },
    { label: "201A", anchor: { x: 85, y: 85 } },
    { label: "202", anchor: { x: 75, y: 95 } }
  ]));
  expect(result.standalonePositionText).toBe(0);
  expect(result.cpWidths).toEqual([12.5]);
});

test("針付き計器は標準計器ではなく目盛弧と針を描画する", async ({ page }) => {
  const anchors = await page.evaluate(() => {
    const standard = { ...window.__edsTest.defaultElement("meter", 30, 40), id: "meter-standard", symbolVariant: "standard" };
    const needle = { ...window.__edsTest.defaultElement("meter", 50, 40), id: "meter-needle", symbolVariant: "needle" };
    window.__edsTest.installProjectData({
      schemaVersion: 3,
      activePageId: "p1",
      pages: [{ id: "p1", title: {}, elements: [standard, needle] }]
    });
    return {
      standard: window.__edsTest.elementConnectionAnchors(standard),
      needle: window.__edsTest.elementConnectionAnchors(needle)
    };
  });
  await expect(page.locator('svg#canvas g[data-id="meter-standard"] path')).toHaveCount(0);
  await expect(page.locator('svg#canvas g[data-id="meter-needle"] path')).toHaveCount(1);
  expect(anchors.needle.map(point => [point.x - 20, point.y])).toEqual(anchors.standard.map(point => [point.x, point.y]));
});

test("既存schema v3の変圧器上タップ配線を新しい行位置へ冪等に追従させる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const source = {
      schemaVersion: 3,
      activePageId: "p1",
      pages: [{
        id: "p1",
        title: {},
        elements: [
          { id: "tr", type: "transformer", x: 100, y: 100, w: 15, h: 17, rotation: 0 },
          { id: "left", type: "wire", points: [[90, 100.5], [105, 100.5]] },
          { id: "right", type: "wire", points: [[110, 100.5], [120, 100.5]] },
          { id: "junction", type: "junction", x: 105, y: 100.5 }
        ]
      }]
    };
    const first = window.__edsTest.migrateProjectData(source);
    const second = window.__edsTest.migrateProjectData(first);
    const byId = Object.fromEntries(second.pages[0].elements.map(element => [element.id, element]));
    return {
      left: byId.left.points,
      right: byId.right.points,
      junction: [byId.junction.x, byId.junction.y],
      anchors: window.__edsTest.elementConnectionAnchors(byId.tr)
    };
  });
  expect(result.left[1]).toEqual([105, 96]);
  expect(result.right[0]).toEqual([110, 96]);
  expect(result.junction).toEqual([105, 96]);
  expect(result.anchors).toEqual(expect.arrayContaining([{ x: 105, y: 96 }, { x: 110, y: 96 }]));
});

test("DC電源のN1・P0・P24・N24・G送り矢印は配線ネットへ接続される", async ({ page }) => {
  await page.locator("#templateMenu").selectOption("dcPower");
  await page.locator("#dcBuildBtn").click();
  const connections = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    const wires = current.elements.filter(element => element.type === "wire");
    const same = (a, b) => Math.abs(a[0] - b[0]) < 0.001 && Math.abs(a[1] - b[1]) < 0.001;
    return Object.fromEntries(["N1", "P0", "P24", "N24", "G"].map(label => {
      const arrow = current.elements.find(element => element.type === "arrow" && element.label === label && element.signalRole === "source");
      const start = arrow?.points?.[0];
      const connected = Boolean(start && wires.some(wire => {
        const points = wire.points || [];
        return points.length > 0 && (same(points[0], start) || same(points[points.length - 1], start));
      }));
      return [label, connected];
    }));
  });
  expect(connections).toEqual({ N1: true, P0: true, P24: true, N24: true, G: true });
  await page.locator("#auditBtn").click();
  const unnumberedComponentRows = page.locator("#dialogBody tr").filter({ hasText: "部品タグが未採番" });
  await expect(unnumberedComponentRows.filter({ hasText: "P24" })).toHaveCount(0);
  await expect(unnumberedComponentRows.filter({ hasText: "N24" })).toHaveCount(0);
  await expect(unnumberedComponentRows.filter({ hasText: "G" })).toHaveCount(0);
});

test("PLC接点タグの空項目は余分な接点として生成しない", async ({ page }) => {
  await page.locator("#templateMenu").selectOption("plcPower");
  await page.locator("#plcpPcr1").fill("PCR1M,");
  await page.locator("#plcpPcr2").fill("");
  await page.locator("#plcpBuildBtn").click();
  const tags = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    return current.elements.filter(element => element.type === "contactNO").map(element => element.tag);
  });
  expect(tags).toEqual(["PCR1M"]);
});

test("PLC電源は7スロットをグリッド分割し過剰な接点列を生成しない", async ({ page }) => {
  await page.locator("#templateMenu").selectOption("plcPower");
  await page.locator("#plcpSlots").fill("S1,S2,S3,S4,S5,S6,S7");
  await page.locator("#plcpBuildBtn").click();
  const layout = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    const boundaries = current.elements
      .filter(element => element.type === "line" && element.points?.length === 2
        && element.points[0][1] === 90 && element.points[1][1] === 140
        && element.points[0][0] === element.points[1][0])
      .map(element => element.points[0][0])
      .sort((a, b) => a - b);
    const slotLabels = current.elements.filter(element => element.type === "text" && /^S[1-7]$/.test(element.text || ""));
    return {
      boundaries,
      rotations: slotLabels.map(element => element.rotation),
      slotXs: slotLabels.map(element => element.x)
    };
  });
  expect(layout.boundaries).toEqual([90, 100, 110, 120, 127.5, 135, 142.5]);
  expect(layout.rotations).toEqual(Array(7).fill(90));
  expect(layout.slotXs.every(value => Math.abs(value / 2.5 - Math.round(value / 2.5)) < 0.001)).toBe(true);

  await page.goto(appUrl, { waitUntil: "load" });
  await page.locator("#templateMenu").selectOption("plcPower");
  const beforePages = await page.evaluate(() => window.__edsTest.state.pages.length);
  await page.locator("#plcpPcr1").fill("C1,C2,C3,C4,C5");
  await page.locator("#plcpBuildBtn").click();
  await expect(page.locator("#status")).toContainText("4件以内");
  expect(await page.evaluate(() => window.__edsTest.state.pages.length)).toBe(beforePages);
});

test("PLC入出力はアドレスを端子円内だけに表示し線番へ重複させない", async ({ page }) => {
  await page.locator("#templateMenu").selectOption("plcInput");
  await page.locator("#plcInCount").fill("2");
  await page.locator("#plcInBuildBtn").click();
  let result = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    return {
      addresses: ["X000", "X001"].map(address => [...document.querySelectorAll("#canvas text")].filter(node => node.textContent === address).length),
      wireNos: current.elements.filter(element => element.type === "wire" && !element.ladderRail).map(element => element.wireNo || "")
    };
  });
  expect(result.addresses).toEqual([1, 1]);
  expect(result.wireNos.every(value => value === "")).toBe(true);

  await page.goto(appUrl, { waitUntil: "load" });
  await page.locator("#templateMenu").selectOption("plcInput");
  await page.locator("#plcInDir").selectOption("output");
  await page.locator("#plcInCount").fill("2");
  await page.locator("#plcInBuildBtn").click();
  result = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    return {
      addresses: ["Y000", "Y001"].map(address => [...document.querySelectorAll("#canvas text")].filter(node => node.textContent === address).length),
      wireNos: current.elements.filter(element => element.type === "wire" && !element.ladderRail).map(element => element.wireNo || "")
    };
  });
  expect(result.addresses).toEqual([1, 1]);
  expect(result.wireNos.every(value => value === "")).toBe(true);
});

test("サーボ入力タップは非接続ギャップを持ちMC接点・線番と重ならない", async ({ page }) => {
  await page.locator("#templateMenu").selectOption("acMotor");
  await page.locator("#acMotorBuildBtn").click();
  const result = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    const phaseContacts = current.elements.filter(element => element.type === "contactNO" && element.tag === "MS1M");
    const tap70 = current.elements.find(element => element.type === "wire" && element.points?.some(point => point[0] === 70 && point[1] === 72.5));
    const tap725 = current.elements.find(element => element.type === "wire" && element.points?.some(point => point[0] === 72.5 && point[1] === 77.5));
    const phaseWires = current.elements.filter(element => element.type === "wire" && ["R2", "S2", "T2"].includes(element.wireNo));
    return {
      contactXs: phaseContacts.map(element => element.x),
      tap70Gaps: tap70?.gapPoints || [],
      tap725Gaps: tap725?.gapPoints || [],
      phaseEnds: phaseWires.map(element => element.points[element.points.length - 1])
    };
  });
  expect(result.contactXs).toEqual([85, 85, 85]);
  expect(result.tap70Gaps).toEqual([[70, 60], [70, 65]]);
  expect(result.tap725Gaps).toEqual([[72.5, 65]]);
  expect(result.phaseEnds).toEqual([[85, 55], [85, 60], [85, 65]]);
});

test("ユニット列の波形破断線はSVGとDXFで共通のサンプリング点を使う", async ({ page }) => {
  const result = await page.evaluate(() => {
    const unit = {
      ...window.__edsTest.defaultElement("plcBlock", 20, 20),
      id: "wave-unit",
      plcStyle: "unit",
      rows: 1,
      w: 10,
      h: 9.5,
      pinText: "X0"
    };
    window.__edsTest.installProjectData({
      schemaVersion: 4,
      activePageId: "wave-page",
      pages: [{ id: "wave-page", size: "A4", orientation: "portrait", title: {}, elements: [unit] }]
    });
    const current = window.__edsTest.state.pages[0];
    return {
      expected: window.__edsTest.unitWavePoints(10, 0),
      path: document.querySelector('g[data-id="wave-unit"] path')?.getAttribute("d") || "",
      dxf: window.__edsTest.buildDxf(current)
    };
  });
  const svgNumbers = (result.path.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  const svgPoints = Array.from({ length: svgNumbers.length / 2 }, (_, index) => [svgNumbers[index * 2], svgNumbers[index * 2 + 1]]);
  expect(svgPoints).toEqual(result.expected);

  const dxfLines = result.dxf.trim().split(/\r?\n/);
  const dxfSegments = [];
  for (let i = 0; i + 1 < dxfLines.length; i += 2) {
    if (dxfLines[i].trim() !== "0" || dxfLines[i + 1].trim() !== "LINE") continue;
    const entity = {};
    for (let j = i + 2; j + 1 < dxfLines.length; j += 2) {
      const code = dxfLines[j].trim();
      if (code === "0") break;
      entity[code] = dxfLines[j + 1].trim();
    }
    if (entity[8] === "SYMBOL") {
      dxfSegments.push([[Number(entity[10]), Number(entity[20])], [Number(entity[11]), Number(entity[21])]]);
    }
  }
  const expectedSegments = result.expected.slice(1).map((point, index) => [
    [20 + result.expected[index][0], 277 - result.expected[index][1]],
    [20 + point[0], 277 - point[1]]
  ]);
  const key = segment => segment.flat().map(value => Number(value).toFixed(3)).join(",");
  const actualKeys = new Set(dxfSegments.map(key));
  expect(expectedSegments.every(segment => actualKeys.has(key(segment)))).toBe(true);
});

test("ラング一括生成は空ページへ実母線を補い左右を接続点で結ぶ", async ({ page }) => {
  await page.locator("#actionMenu").selectOption("rungCircuit");
  await page.locator("#rcBuildBtn").click();
  const result = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    const rails = current.elements.filter(element => element.type === "wire" && element.ladderRail);
    const rungY = 36.5;
    return {
      rails: rails.map(element => ({ name: element.ladderRail, x: element.points[0][0] })).sort((a, b) => a.x - b.x),
      leftJunctions: current.elements.filter(element => element.type === "junction" && element.x === 32.5 && element.y === rungY).length,
      rightJunctions: current.elements.filter(element => element.type === "junction" && element.x === 147.5 && element.y === rungY).length,
      rightWire: current.elements.some(element => element.type === "wire" && element.points?.some(point => point[0] === 147.5 && point[1] === rungY))
    };
  });
  expect(result.rails).toEqual([{ name: "P1", x: 32.5 }, { name: "N1", x: 147.5 }]);
  expect(result.leftJunctions).toBe(1);
  expect(result.rightJunctions).toBe(1);
  expect(result.rightWire).toBe(true);
});

test("配線列・配線行は用紙外指定を拒否しツイストペアとモータ分岐をスナップする", async ({ page }) => {
  await page.locator("#actionMenu").selectOption("wireColumn");
  await page.locator("#wireColumnCount").fill("100");
  await page.locator("#applyWireColumnBtn").click();
  await expect(page.locator("#status")).toContainText("作図範囲を越えます");
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.filter(element => element.type === "wire").length)).toBe(0);

  await page.goto(appUrl, { waitUntil: "load" });
  await page.locator("#actionMenu").selectOption("wireRow");
  await page.locator("#wireRowCount").fill("100");
  await page.locator("#applyWireRowBtn").click();
  await expect(page.locator("#status")).toContainText("作図範囲を越えます");

  await page.goto(appUrl, { waitUntil: "load" });
  await page.locator("#actionMenu").selectOption("twistedPair");
  await page.locator("#twPitch").fill("6.1");
  await page.locator("#twX").fill("41.2");
  await page.locator("#twY").fill("81.4");
  await page.locator("#twSpan").fill("61.1");
  await page.locator("#twBuildBtn").click();
  let offGrid = await page.evaluate(() => {
    const onGrid = value => Math.abs(value / 2.5 - Math.round(value / 2.5)) < .001;
    return window.__edsTest.state.pages[0].elements
      .flatMap(element => Array.isArray(element.points) ? element.points : [])
      .filter(point => !onGrid(point[0]) || !onGrid(point[1]));
  });
  expect(offGrid).toEqual([]);

  await page.goto(appUrl, { waitUntil: "load" });
  await page.locator("#actionMenu").selectOption("motorCircuit");
  await page.locator("#mcX").fill("41.2");
  await page.locator("#mcY").fill("66.1");
  await page.locator("#mcSpan").fill("96.2");
  await page.locator("#mcBuildBtn").click();
  offGrid = await page.evaluate(() => {
    const onGrid = value => Math.abs(value / 2.5 - Math.round(value / 2.5)) < .001;
    const current = window.__edsTest.state.pages[0];
    return current.elements.flatMap(element => {
      if (element.type === "mechanicalLink") return [];
      const points = Array.isArray(element.points)
        ? element.points.map(point => ({ x: point[0], y: point[1] }))
        : window.__edsTest.elementConnectionAnchors(element);
      return points.filter(point => !onGrid(point.x) || !onGrid(point.y));
    });
  });
  expect(offGrid).toEqual([]);
});

test("インターロックは送り・受け合計10信号を越える入力を拒否する", async ({ page }) => {
  await page.locator("#templateMenu").selectOption("interlock");
  const beforePages = await page.evaluate(() => window.__edsTest.state.pages.length);
  await page.locator("#ilOutCount").fill("6");
  await page.locator("#ilInCount").fill("5");
  await page.locator("#ilBuildBtn").click();
  await expect(page.locator("#status")).toContainText("合計10本以下");
  expect(await page.evaluate(() => window.__edsTest.state.pages.length)).toBe(beforePages);
});

test("高速作画UIは集中表示・キー設定・ページナビゲータ・検査表示を利用できる", async ({ page }) => {
  await expect(page.locator("#quickRibbon")).toBeVisible();
  await expect(page.locator("#bottomHud")).toContainText("SNAP");

  await page.locator("#ribbonPanels").click();
  await expect(page.locator(".app")).toHaveClass(/left-collapsed/);
  await expect(page.locator(".app")).toHaveClass(/right-collapsed/);
  await page.keyboard.press("Tab");
  await expect(page.locator(".app")).not.toHaveClass(/left-collapsed/);

  await page.locator("#ribbonShortcuts").click();
  await page.locator('[data-shortcut="wire"]').fill("e");
  await page.locator("#shortcutApply").click();
  await page.keyboard.press("e");
  expect(await page.evaluate(() => document.querySelector('[data-tool="wire"]').classList.contains("active"))).toBe(true);

  await page.locator("#ribbonPages").click();
  await expect(page.locator("#pageNavigatorGrid .page-nav-card")).toHaveCount(1);
  await page.locator("#dialogClose").click();

  await page.locator("#ribbonAudit").click();
  expect(await page.evaluate(() => window.__edsTest.state.settings.auditOverlay)).toBe(true);
  await expect(page.locator("#ribbonAudit")).toHaveClass(/active/);
});

test("追加センサ・電磁弁・電源バリエーションは接続点と線形状を共通定義で保つ", async ({ page }) => {
  const result = await page.evaluate(() => {
    const variants = [
      ["sensor", "inductive"], ["sensor", "photo"], ["sensor", "capacitive"], ["sensor", "magnetic"],
      ["solenoidValve", "double"], ["powerSupply", "acdc"], ["powerSupply", "dcdc"]
    ];
    const elements = variants.map(([type, symbolVariant], index) => ({
      ...window.__edsTest.defaultElement(type, 20, 25 + index * 25),
      id: `variant-${type}-${symbolVariant}`,
      symbolVariant,
      label: type.toUpperCase()
    }));
    window.__edsTest.installProjectData({
      schemaVersion: 4,
      activePageId: "variant-page",
      pages: [{ id: "variant-page", name: "追加記号", size: "A4", orientation: "portrait", title: {}, elements }]
    });
    const current = window.__edsTest.state.pages[0];
    return elements.map(element => {
      const geo = window.__edsTest.SYMBOL_GEO[({
        "sensor:inductive": "sensorInductive", "sensor:photo": "sensorPhoto",
        "sensor:capacitive": "sensorCapacitive", "sensor:magnetic": "sensorMagnetic",
        "solenoidValve:double": "solenoidValveDouble",
        "powerSupply:acdc": "powerSupplyAcDc", "powerSupply:dcdc": "powerSupplyDcDc"
      })[`${element.type}:${element.symbolVariant}`]];
      const prims = window.__edsTest.geoPrims(element);
      const finite = prims.every(prim => {
        const values = prim.p || (prim.pts || []).flat();
        return values.every(Number.isFinite);
      });
      const anchors = window.__edsTest.elementConnectionAnchors(element);
      const group = document.querySelector(`g[data-id="${element.id}"]`);
      return {
        type: element.type,
        variant: element.symbolVariant,
        finite,
        anchorCount: anchors.length,
        pinPitch: Math.hypot(anchors[1].x - anchors[0].x, anchors[1].y - anchors[0].y),
        lineCount: group?.querySelectorAll("line,path,rect,circle").length || 0,
        geoWidth: geo.w,
        dxfHasSymbol: window.__edsTest.buildDxf(current).includes("\nSYMBOL\n")
      };
    });
  });
  for (const item of result) {
    expect(item.finite, `${item.type}:${item.variant}の座標`).toBe(true);
    expect(item.anchorCount, `${item.type}:${item.variant}の接続点`).toBe(2);
    expect(item.pinPitch, `${item.type}:${item.variant}のピン間隔`).toBe(item.geoWidth);
    expect(item.lineCount, `${item.type}:${item.variant}のSVG形状`).toBeGreaterThan(3);
    expect(item.dxfHasSymbol, `${item.type}:${item.variant}のDXF形状`).toBe(true);
  }
});

test("全固定シンボル定義に非数値・ゼロ長線・重複点・不正寸法がない", async ({ page }) => {
  const errors = await page.evaluate(() => {
    const issues = [];
    Object.entries(window.__edsTest.SYMBOL_GEO).forEach(([key, geo]) => {
      if (!Number.isFinite(geo.w) || !Number.isFinite(geo.h) || geo.w <= 0 || geo.h <= 0) issues.push(`${key}:body`);
      (geo.anchors || []).forEach((anchor, index) => {
        if (anchor.length !== 2 || !anchor.every(Number.isFinite)) issues.push(`${key}:anchor:${index}`);
      });
      (geo.prims || []).forEach((prim, index) => {
        const values = prim.p || (prim.pts || []).flat();
        if (!values.every(Number.isFinite)) issues.push(`${key}:finite:${index}`);
        if (prim.t === "line" && Math.hypot(prim.p[2] - prim.p[0], prim.p[3] - prim.p[1]) < .001) issues.push(`${key}:zero-line:${index}`);
        if (prim.t === "rect" && (prim.p[2] <= 0 || prim.p[3] <= 0)) issues.push(`${key}:rect-size:${index}`);
        if (["circle", "arc"].includes(prim.t) && prim.p[2] <= 0) issues.push(`${key}:radius:${index}`);
        if (prim.t === "pline") {
          if (!Array.isArray(prim.pts) || prim.pts.length < 2) issues.push(`${key}:pline-count:${index}`);
          (prim.pts || []).slice(1).forEach((point, pointIndex) => {
            const previous = prim.pts[pointIndex];
            if (Math.hypot(point[0] - previous[0], point[1] - previous[1]) < .001) issues.push(`${key}:duplicate-point:${index}:${pointIndex}`);
          });
        }
      });
    });
    return issues;
  });
  expect(errors).toEqual([]);
});

test("選択ツールは端子クリックで配線を作らず、軸別スナップと端子外周表示を保つ", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 4,
    activePageId: "p1",
    settings: { grid: 0.5, snap: true },
    pages: [{
      id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {},
      elements: [
        { id: "t1", type: "terminal", x: 20, y: 30, w: 10, h: 6, terminalShape: "circle", layer: "symbols" },
        { id: "w1", type: "wire", points: [[25, 33], [50, 33]], layer: "wires" }
      ]
    }]
  }));

  await page.locator('[data-id="t1"]').click({ position: { x: 5, y: 3 } });
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.filter(item => item.type === "wire").length)).toBe(1);
  expect(await page.evaluate(() => window.__edsTest.axisAwareDrawingPoint([10.31, 120.42], { x: 40.18, y: 120.7 }))).toEqual({ x: 40, y: 120.42 });
  expect(await page.evaluate(() => window.__edsTest.axisAwareDrawingPoint([80.31, 20.42], { x: 80.55, y: 60.22 }))).toEqual({ x: 80.31, y: 60 });
  const visible = await page.evaluate(() => window.__edsTest.visibleWirePoints(
    window.__edsTest.state.pages[0].elements.find(item => item.id === "w1")
  ));
  expect(visible[0][0]).toBe(25);
  expect(visible[0][1]).toBe(33);
  const order = await page.evaluate(() => [...document.querySelectorAll("svg#canvas > g[data-id]")].map(node => node.dataset.id));
  expect(order.indexOf("w1")).toBeLessThan(order.indexOf("t1"));
});

test("詳細表題欄の日付と改訂履歴は別の欄に収まる", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 4,
    activePageId: "p1",
    pages: [{
      id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "detailed",
      title: { date: "2026/07/20", page: "1", total: "1" }, elements: []
    }]
  }));
  await expect(page.locator("svg#canvas").getByText("2026/07/20")).toHaveCount(1);
  await expect(page.locator("svg#canvas").getByText("改訂履歴")).toHaveCount(1);
  const x = await page.locator("svg#canvas").getByText("2026/07/20").getAttribute("x");
  expect(Number(x)).toBeLessThan(180);
});

test("設備標準表題欄の日付は罫線内に収まり、他の図枠線も用紙内にある", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 4,
    activePageId: "p1",
    pages: [{
      id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "ladder",
      title: { date: "2026/07/20", page: "1", total: "1", drawingNo: "EL-001" }, elements: []
    }]
  }));
  const result = await page.evaluate(() => {
    const svg = document.querySelector("svg#canvas");
    const date = [...svg.querySelectorAll(".frame text")].find(node => node.textContent === "2026/07/20");
    const box = date.getBBox();
    const invalidLines = [...svg.querySelectorAll(".frame line,.frame rect")].filter(node =>
      [...node.attributes].filter(attr => ["x", "y", "x1", "y1", "x2", "y2", "width", "height"].includes(attr.name))
        .some(attr => !Number.isFinite(Number(attr.value))));
    return { box: { x: box.x, y: box.y, w: box.width, h: box.height }, invalidCount: invalidLines.length };
  });
  expect(result.invalidCount).toBe(0);
  expect(result.box.x).toBeGreaterThanOrEqual(165);
  expect(result.box.x + result.box.w).toBeLessThanOrEqual(191);
  expect(result.box.y).toBeGreaterThan(267);
  expect(result.box.y + result.box.h).toBeLessThanOrEqual(273);
});

test("L字配線はドラッグ開始方向に従い、確定後は選択ツールへ戻る", async ({ page }) => {
  const routes = await page.evaluate(() => {
    const horizontal = { points: [[20, 30], [20, 30]] };
    const vertical = { points: [[20, 30], [20, 30]] };
    window.__edsTest.rebuildDrawingWire(horizontal, { lastPoint: [60, 70], initialAxis: "horizontal" }, false);
    window.__edsTest.rebuildDrawingWire(vertical, { lastPoint: [60, 70], initialAxis: "vertical" }, false);
    return { horizontal, vertical };
  });
  expect(routes.horizontal.orthoFlip).toBe(true);
  expect(routes.vertical.orthoFlip).toBe(false);

  await page.evaluate(() => {
    window.__edsTest.installProjectData({
      schemaVersion: 4, activePageId: "p1",
      pages: [{ id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements: [] }]
    });
    window.__edsTest.setActiveTool("wire");
  });
  const box = await page.locator("svg#canvas").boundingBox();
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 40, { steps: 3 });
  await page.mouse.move(box.x + 100, box.y + 100, { steps: 3 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__edsTest.getActiveTool())).toBe("select");
  const actualWire = await page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.type === "wire"));
  expect(actualWire.orthoFlip).toBe(true);
});

test("直線の始点と終点を数値入力で修正できる", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 4, activePageId: "p1",
    pages: [{
      id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {},
      elements: [{ id: "line1", type: "line", points: [[20, 30], [50, 30]], layer: "layout" }]
    }]
  }));
  await page.locator('[data-id="line1"]').click({ force: true });
  await page.locator('[data-bind="p0x"]').fill("25.25");
  await page.locator('[data-bind="p0x"]').press("Enter");
  await page.locator('[data-bind="p1y"]').fill("250.5");
  await page.locator('[data-bind="p1y"]').press("Enter");
  const points = await page.evaluate(() => window.__edsTest.state.pages[0].elements[0].points);
  expect(points[0][0]).toBe(25.25);
  expect(points[1][1]).toBe(46.5);
});

test("新規ページの日付は当日のローカル日付で初期化され、任意値へ変更できる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const created = window.__edsTest.createPage({ name: "DATE" });
    return { date: created.title.date, today: window.__edsTest.formatLocalDate(new Date()) };
  });
  expect(result.date).toBe(result.today);

  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 4, activePageId: "p1",
    pages: [{ id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "ladder", title: { date: "2026/08/01" }, elements: [] }]
  }));
  await page.locator("#drawDate").evaluate(input => { input.closest("details").open = true; });
  await page.locator("#drawDate").fill("2026/08/15");
  await page.locator("#drawDate").press("Enter");
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].title.date)).toBe("2026/08/15");
});

test("端数座標の直線は新規作図と端点移動の両方で水平・垂直を維持する", async ({ page }) => {
  const result = await page.evaluate(() => ({
    horizontal: window.__edsTest.snapEditableLineEndpoint([20.31, 120.42], { x: 80.31, y: 120.6 }),
    vertical: window.__edsTest.snapEditableLineEndpoint([80.31, 20.42], { x: 80.5, y: 120.31 }),
    horizontalFirst: window.__edsTest.dragPreferredAxis([20, 30], [
      { x: 30, y: 30 }, { x: 50, y: 30 }, { x: 50, y: 50 }, { x: 50, y: 70 }
    ]),
    verticalFirst: window.__edsTest.dragPreferredAxis([20, 30], [
      { x: 20, y: 40 }, { x: 20, y: 60 }, { x: 40, y: 60 }, { x: 60, y: 60 }
    ])
  }));
  expect(result.horizontal).toEqual([80, 120.42]);
  expect(result.vertical).toEqual([80.31, 120]);
  expect(result.horizontalFirst).toBe("horizontal");
  expect(result.verticalFirst).toBe("vertical");
});

test("多角形の辺数と半径は入力変更だけで即時再生成される", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 4, activePageId: "p1",
    pages: [{
      id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {},
      elements: [{
        id: "poly1", type: "polygon", sides: 6, radius: 8,
        points: [[48, 40], [44, 46.93], [36, 46.93], [32, 40], [36, 33.07], [44, 33.07]],
        layer: "layout"
      }]
    }]
  }));
  await page.evaluate(() => window.__edsTest.selectElement("poly1"));
  await page.locator("#polySides").fill("5");
  await page.locator("#polySides").press("Enter");
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements[0].points.length)).toBe(5);
  await page.locator("#polyRadius").fill("12");
  await page.locator("#polyRadius").press("Enter");
  const result = await page.evaluate(() => {
    const element = window.__edsTest.state.pages[0].elements[0];
    const cx = element.points.reduce((sum, point) => sum + point[0], 0) / element.points.length;
    const cy = element.points.reduce((sum, point) => sum + point[1], 0) / element.points.length;
    return { radius: element.radius, measured: Math.hypot(element.points[0][0] - cx, element.points[0][1] - cy) };
  });
  expect(result.radius).toBe(12);
  expect(result.measured).toBeCloseTo(12, 1);
  await expect(page.locator("#polyRegenBtn")).toHaveCount(0);
});

test("論理ゲートにNAND・NOR・XORの異表現を追加する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const variants = ["nand", "nor", "xor"];
    return variants.map(symbolVariant => {
      const element = { ...window.__edsTest.defaultElement("logicGate", 20, 20), symbolVariant, label: symbolVariant.toUpperCase() };
      const prims = window.__edsTest.geoPrims(element);
      return {
        symbolVariant,
        anchors: window.__edsTest.elementConnectionAnchors(element).length,
        circles: prims.filter(prim => prim.t === "circle").length,
        marker: prims.find(prim => prim.t === "text" && prim.value)?.value
      };
    });
  });
  expect(result).toEqual([
    { symbolVariant: "nand", anchors: 3, circles: 1, marker: "&" },
    { symbolVariant: "nor", anchors: 3, circles: 1, marker: "≥1" },
    { symbolVariant: "xor", anchors: 3, circles: 0, marker: "=1" }
  ]);
});

test("基本表題欄の日付は独立した罫線セル内に収まる", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 4, activePageId: "p1",
    pages: [{
      id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "compact",
      title: { date: "2026/07/21", page: "1", total: "1" }, elements: []
    }]
  }));
  const result = await page.evaluate(() => {
    const svg = document.querySelector("svg#canvas");
    const date = [...svg.querySelectorAll(".frame text")].find(node => node.textContent === "2026/07/21");
    const box = date.getBBox();
    const lines = [...svg.querySelectorAll(".frame line")].map(line => ({
      x1: Number(line.getAttribute("x1")), y1: Number(line.getAttribute("y1")),
      x2: Number(line.getAttribute("x2")), y2: Number(line.getAttribute("y2"))
    }));
    return { box: { x: box.x, y: box.y, right: box.x + box.width, bottom: box.y + box.height }, lines };
  });
  expect(result.box.x).toBeGreaterThanOrEqual(172);
  expect(result.box.right).toBeLessThanOrEqual(202);
  expect(result.box.y).toBeGreaterThanOrEqual(273);
  expect(result.box.bottom).toBeLessThanOrEqual(281);
  expect(result.lines).toContainEqual({ x1: 172, y1: 273, x2: 172, y2: 281 });
});

test("矢印と連動破線の端点移動は固定軸の端数座標を維持する", async ({ page }) => {
  for (const type of ["arrow"]) {
    await page.evaluate(type => window.__edsTest.installProjectData({
      schemaVersion: 4, activePageId: "p1", settings: { grid: .5, snap: true },
      pages: [{ id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {},
        elements: [{ id: "target", type, points: [[20.31, 120.42], [50.31, 120.42]], layer: "layout" }] }]
    }), type);
    await page.evaluate(() => window.__edsTest.selectElement("target"));
    const handle = page.locator('[data-point-index="1"]');
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 1, { steps: 4 });
    await page.mouse.up();
    const points = await page.evaluate(() => window.__edsTest.state.pages[0].elements[0].points);
    expect(points[1][1], type).toBe(120.42);
    expect(points[1][0], type).toBeGreaterThan(50.31);
  }
  const constrained = await page.evaluate(() => ({
    mechanicalHorizontal: window.__edsTest.snapEditableLineEndpoint([20.31, 120.42], { x: 80.2, y: 120.6 }),
    mechanicalVertical: window.__edsTest.snapEditableLineEndpoint([80.31, 20.42], { x: 80.5, y: 120.2 })
  }));
  expect(constrained.mechanicalHorizontal).toEqual([80, 120.42]);
  expect(constrained.mechanicalVertical).toEqual([80.31, 120]);
});

test("配線ツールで複数接続点から任意の始点を選択できる", async ({ page }) => {
  await page.evaluate(() => {
    window.__edsTest.installProjectData({
      schemaVersion: 4, activePageId: "p1",
      pages: [{ id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {},
        elements: [
          { id: "box1", type: "deviceBox", x: 30, y: 40, w: 30, h: 25, pins: 4, layer: "symbols" },
          { id: "box2", type: "deviceBox", x: 100, y: 40, w: 30, h: 25, pins: 4, layer: "symbols" }
        ] }]
    });
  });
  await page.locator('[data-id="box1"]').click({ force: true });
  await page.locator('#miniToolbar').getByRole('button', { name: '配線' }).click();
  const choices = page.locator(".connection-choice");
  await expect(choices).toHaveCount(8);
  await expect(choices.first()).toHaveAttribute("data-connection-element", "box1");
  await page.locator('[data-id="box1"] rect').first().click({ force: true });
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.filter(item => item.type === "wire").length)).toBe(0);
  const choice = choices.nth(7);
  const expected = await choice.evaluate(node => [Number(node.dataset.connectionX), Number(node.dataset.connectionY)]);
  const box = await choice.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 3 });
  await page.mouse.up();
  const start = await page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.type === "wire").points[0]);
  expect(start).toEqual(expected);
});

test("直線・連動破線・配線で接続点と両向きの矢印を選択できる", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 4, activePageId: "p1",
    pages: [{ id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements: [
      { id: "line1", type: "line", points: [[20, 30], [50, 30]], layer: "layout", showStartConnection: true, showEndConnection: true, endpointArrowMode: "both" },
      { id: "link1", type: "mechanicalLink", points: [[20, 50], [50, 50]], layer: "layout", showStartConnection: true, endpointArrowMode: "reverse" },
      { id: "wire1", type: "wire", points: [[20, 70], [50, 90]], orthoFlip: false, layer: "wires", wireNo: "W1", showEndConnection: true, endpointArrowMode: "forward" },
      { id: "openArrow", type: "arrow", points: [[20, 110], [50, 110]], arrowStyle: "open", layer: "layout" },
      { id: "forkArrow", type: "arrow", points: [[50, 130], [20, 130]], arrowStyle: "fork", layer: "layout" }
    ] }]
  }));
  await expect(page.locator('[data-id="line1"] [data-endpoint-connection]')).toHaveCount(2);
  await expect(page.locator('[data-id="line1"] [data-endpoint-arrow]')).toHaveCount(2);
  await expect(page.locator('[data-id="link1"] [data-endpoint-connection="start"]')).toHaveCount(1);
  await expect(page.locator('[data-id="link1"] [data-endpoint-arrow="start"]')).toHaveCount(1);
  await expect(page.locator('[data-id="wire1"] [data-endpoint-connection="end"]')).toHaveCount(1);
  await expect(page.locator('[data-id="wire1"] [data-endpoint-arrow="end"]')).toHaveCount(1);
  const arrowShapes = await page.evaluate(() => {
    const relative = (selector, tip) => (document.querySelector(selector).getAttribute("d").match(/-?\d+(?:\.\d+)?/g) || [])
      .map((value, index) => Math.round((Number(value) - tip[index % 2]) * 1000) / 1000);
    return {
      endpointForward: relative('[data-id="line1"] [data-endpoint-arrow="end"]', [50, 30]),
      signalForward: relative('[data-id="openArrow"] [data-arrow-head="open"]', [50, 110]),
      endpointReverse: relative('[data-id="line1"] [data-endpoint-arrow="start"]', [20, 30]),
      busFork: relative('[data-id="forkArrow"] [data-arrow-head="fork"]', [20, 130])
    };
  });
  expect(arrowShapes.endpointForward).toEqual(arrowShapes.signalForward);
  expect(arrowShapes.endpointReverse).toEqual(arrowShapes.busFork);

  await page.evaluate(() => window.__edsTest.selectElement("wire1"));
  await expect(page.locator('[data-bind="showStartConnection"]')).toBeVisible();
  await page.locator('[data-bind="showStartConnection"]').check();
  await page.locator('[data-bind="startArrowStyle"][value="forward"]').check();
  await page.locator('[data-bind="endArrowStyle"][value="reverse"]').check();
  await expect(page.locator('[data-id="wire1"] [data-endpoint-connection]')).toHaveCount(2);
  await expect(page.locator('[data-id="wire1"] [data-endpoint-arrow]')).toHaveCount(2);
  await expect(page.locator('[data-id="wire1"] [data-endpoint-arrow="start"]')).toHaveAttribute("data-arrow-head", "open");
  await expect(page.locator('[data-id="wire1"] [data-endpoint-arrow="end"]')).toHaveAttribute("data-arrow-head", "fork");

  const labelYBefore = Number(await page.locator('[data-id="wire1"] text').first().getAttribute("y"));
  await page.locator('[data-bind="wireNoDy"]').fill("5");
  await page.locator('[data-bind="wireNoDy"]').press("Enter");
  const labelYAfter = Number(await page.locator('[data-id="wire1"] text').first().getAttribute("y"));
  expect(labelYAfter).toBeLessThan(labelYBefore);
});

test("機器箱の端子記号を端子文字と連動でき、全要素の文字サイズと太字を変更できる", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 4, activePageId: "p1",
    pages: [{ id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements: [
      { id: "box", type: "deviceBox", x: 30, y: 40, w: 30, h: 25, pins: 4, label: "DEV", pinText: "1\n2\n3\n4", rightPinText: "", layer: "symbols" },
      { id: "wire", type: "wire", points: [[30, 90], [70, 90]], wireNo: "W10", layer: "wires" },
      { id: "text", type: "text", x: 30, y: 110, w: 30, h: 8, text: "NOTE", fontSize: 3.5, layer: "notes" }
    ] }]
  }));
  await expect(page.locator('[data-id="box"] [data-device-terminal]')).toHaveCount(4);
  await expect(page.locator('[data-id="box"] [data-device-terminal]').first()).toHaveAttribute("r", "0.55");
  await expect(page.locator('[data-id="box"] [data-device-terminal]').first()).toHaveClass(/terminal-dot/);
  await page.evaluate(() => window.__edsTest.selectElement("box"));
  await page.locator('[data-bind="pinText"]').fill("1\n2\n\n4");
  await expect(page.locator('[data-id="box"] [data-device-terminal]')).toHaveCount(3);
  await page.locator('[data-bind="deviceTerminalMode"][value="always"]').check();
  await expect(page.locator('[data-id="box"] [data-device-terminal]')).toHaveCount(8);
  await page.locator('[data-bind="deviceTerminalMode"][value="hidden"]').check();
  await expect(page.locator('[data-id="box"] [data-device-terminal]')).toHaveCount(0);
  await page.locator('[data-bind="deviceTerminalMode"][value="auto"]').check();
  await page.locator('[data-bind="deviceTerminalVisibility.left-0"]').uncheck();
  await expect(page.locator('[data-id="box"] [data-device-terminal]')).toHaveCount(2);
  await page.locator('[data-bind="deviceTerminalVisibility.left-0"]').check();
  await page.locator('[data-bind="contentFontSize"]').fill("3.4");
  await page.locator('[data-bind="contentFontSize"]').press("Enter");
  await page.locator('[data-bind="contentFontBold"]').check();
  await expect(page.locator('[data-id="box"] text').first()).toHaveAttribute("font-size", "3.4");
  await expect(page.locator('[data-id="box"] text').first()).toHaveAttribute("font-weight", "700");

  await page.evaluate(() => window.__edsTest.selectElement("wire"));
  await page.locator('[data-bind="wireNoFontSize"]').fill("4.2");
  await page.locator('[data-bind="wireNoFontSize"]').press("Enter");
  await page.locator('[data-bind="wireNoBold"]').check();
  await expect(page.locator('[data-id="wire"] text').first()).toHaveAttribute("font-size", "4.2");
  await expect(page.locator('[data-id="wire"] text').first()).toHaveAttribute("font-weight", "700");

  await page.evaluate(() => window.__edsTest.selectElement("text"));
  await page.locator('[data-bind="fontSize"]').fill("5");
  await page.locator('[data-bind="fontSize"]').press("Enter");
  await page.locator('[data-bind="fontBold"]').check();
  await expect(page.locator('[data-id="text"] text')).toHaveAttribute("font-size", "5");
  await expect(page.locator('[data-id="text"] text')).toHaveAttribute("font-weight", "700");
});

test("直線・連動破線・配線の線幅と線色が描画へ反映される", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 4, activePageId: "p1",
    pages: [{ id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements: [
      { id: "line", type: "line", points: [[20, 30], [70, 30]], strokeWidth: .32, stroke: "#111820", layer: "layout" },
      { id: "link", type: "mechanicalLink", points: [[20, 50], [70, 50]], strokeWidth: .26, stroke: "#111820", dash: "1.2 1.4", layer: "symbols" },
      { id: "wireStyle", type: "wire", points: [[20, 70], [70, 70]], stroke: "#111820", layer: "wires" }
    ] }]
  }));
  for (const id of ["line", "link", "wireStyle"]) {
    await page.evaluate(targetId => window.__edsTest.selectElement(targetId), id);
    await page.locator('[data-bind="strokeWidth"]').fill("1.1");
    await page.locator('[data-bind="strokeWidth"]').press("Enter");
    await page.locator('.swatch[data-color="#1f5fbf"]').click();
    const style = await page.evaluate(targetId => {
      const group = document.querySelector(`[data-id="${targetId}"]`);
      const line = group.querySelector(targetId === "wireStyle" ? ".wire-line" : ".symbol-line");
      return { width: getComputedStyle(line).strokeWidth, color: getComputedStyle(line).stroke };
    }, id);
    expect(parseFloat(style.width)).toBeCloseTo(1.1, 3);
    expect(style.color).toBe("rgb(31, 95, 191)");
  }
});

test("b接点スイッチを下側接触バーで描き、連結接点の間隔を数値変更できる", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 4, activePageId: "p1",
    pages: [{ id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements: [
      { id: "emg", type: "pushButton", x: 20, y: 20, pbStyle: "emergency", symbolVariant: "standard", label: "E" },
      { id: "bar", type: "pushButton", x: 40, y: 20, pbStyle: "emergency", symbolVariant: "bar", label: "B" },
      { id: "pbnc", type: "pushButton", x: 60, y: 20, pbStyle: "momentary", symbolVariant: "nc", label: "NC" },
      { id: "thermo", type: "thermoSwitch", x: 80, y: 20, symbolVariant: "nc", label: "T" },
      { id: "flow", type: "flowSwitch", x: 100, y: 20, symbolVariant: "nc", label: "F" },
      { id: "foot", type: "footSwitch", x: 120, y: 20, symbolVariant: "nc", label: "P" },
      { id: "multi2", type: "pushButton", x: 20, y: 50, pbStyle: "emergency", symbolVariant: "multi2", contactGap: 12, label: "M2" },
      { id: "multi3", type: "pushButton", x: 50, y: 50, pbStyle: "emergency", symbolVariant: "jisMulti3", contactGap: 8, label: "M3" },
      { id: "pressure", type: "pressureSwitch", x: 90, y: 50, symbolVariant: "standard", label: "PS" }
    ] }]
  }));
  const result = await page.evaluate(() => {
    const byId = id => window.__edsTest.state.pages[0].elements.find(item => item.id === id);
    const hasBar = (id, y) => window.__edsTest.geoPrims(byId(id)).some(prim => prim.t === "line" && Math.abs(prim.p[1] - y) < .001 && Math.abs(prim.p[3] - y) < .001 && prim.p[0] <= 2.8 && prim.p[2] >= 7.2);
    const gapOf = id => {
      const anchors = window.__edsTest.elementConnectionAnchors(byId(id));
      const ys = [...new Set(anchors.map(point => Math.round(point.y * 100) / 100))].sort((a, b) => a - b);
      return ys.slice(1).map((value, index) => Math.round((value - ys[index]) * 100) / 100);
    };
    const pressure = window.__edsTest.geoPrims(byId("pressure"));
    return {
      bars: { emg: hasBar("emg", 5), bar: hasBar("bar", 5), pbnc: hasBar("pbnc", 4.1), thermo: hasBar("thermo", 2.8), flow: hasBar("flow", 2.8), foot: hasBar("foot", 2.8) },
      gaps2: gapOf("multi2"), gaps3: gapOf("multi3"),
      pressureConnected: pressure.some(prim => prim.t === "line" && Math.abs(prim.p[0] - 4.6) < .001 && Math.abs(prim.p[1] - 2.31) < .01)
    };
  });
  expect(result.bars).toEqual({ emg: true, bar: true, pbnc: true, thermo: true, flow: true, foot: true });
  expect(result.gaps2).toEqual([12]);
  expect(result.gaps3).toEqual([8, 8]);
  expect(result.pressureConnected).toBe(true);

  await page.evaluate(() => window.__edsTest.selectElement("multi2"));
  await page.locator('[data-bind="contactGap"]').fill("7.5");
  await page.locator('[data-bind="contactGap"]').press("Enter");
  expect(await page.evaluate(() => {
    const element = window.__edsTest.state.pages[0].elements.find(item => item.id === "multi2");
    const ys = [...new Set(window.__edsTest.elementConnectionAnchors(element).map(point => point.y))].sort((a, b) => a - b);
    return Math.round((ys[1] - ys[0]) * 10) / 10;
  })).toBe(7.5);
  await expect(page.locator('#selectionPanel select[data-bind="symbolVariant"] option[value="gridMulti2"]')).toHaveCount(0);
});

test("JIS・IEC形b接点の可動線と止め線を接続し、非常停止ではPB形状を固定する", async ({ page }) => {
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 4, activePageId: "p1",
    pages: [{ id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements: [
      { id: "contactJis", type: "contactNC", x: 10, y: 20, symbolVariant: "jis" },
      { id: "pbJisNc", type: "pushButton", x: 20, y: 20, pbStyle: "momentary", symbolVariant: "jisNc" },
      { id: "emgJis", type: "pushButton", x: 40, y: 20, pbStyle: "emergency", symbolVariant: "jis" },
      { id: "emgJis2", type: "pushButton", x: 60, y: 20, pbStyle: "emergency", symbolVariant: "jisMulti2" },
      { id: "emgJis3", type: "pushButton", x: 80, y: 20, pbStyle: "emergency", symbolVariant: "jisMulti3" }
    ] }]
  }));
  const joined = await page.evaluate(() => {
    const elements = window.__edsTest.state.pages[0].elements;
    return Object.fromEntries(elements.filter(element => element.id !== "contactJis").map(element => {
      const lines = window.__edsTest.geoPrims(element).filter(prim => prim.t === "line" && !prim.dash);
      const diagonalEnds = lines.filter(({ p }) => p[0] !== p[2] && p[1] !== p[3]).flatMap(({ p }) => [[p[0], p[1]], [p[2], p[3]]]);
      const stopEnds = lines.filter(({ p }) => p[0] === p[2] && p[1] !== p[3]).flatMap(({ p }) => [[p[0], p[1]], [p[2], p[3]]]);
      return [element.id, diagonalEnds.some(([x, y]) => stopEnds.some(([sx, sy]) => Math.abs(x - sx) < .001 && Math.abs(y - sy) < .001))];
    }));
  });
  expect(joined).toEqual({ pbJisNc: true, emgJis: true, emgJis2: true, emgJis3: true });
  expect(await page.evaluate(() => {
    const element = window.__edsTest.state.pages[0].elements.find(item => item.id === "contactJis");
    return window.__edsTest.geoPrims(element).some(prim => prim.t === "line" && prim.p.join(",") === "3.6,2.8,6.4,2.8");
  })).toBe(true);

  await page.evaluate(() => window.__edsTest.selectElement("emgJis"));
  await expect(page.locator('#selectionPanel [data-bind="pbStyle"]')).toHaveCount(0);
  await expect(page.locator('#selectionPanel [data-bind="symbolVariant"]')).toHaveValue("jis");
});
