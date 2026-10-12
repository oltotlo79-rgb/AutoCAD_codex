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

const blankPage = (id, name, elements) => ({ id, name, size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements });
const install = (page, data) => page.evaluate(data => window.__edsTest.installProjectData(data), data);
const element = (page, id) => page.evaluate(id => {
  for (const sheet of window.__edsTest.state.pages) {
    const found = sheet.elements.find(item => item.id === id);
    if (found) return JSON.parse(JSON.stringify(found));
  }
  return null;
}, id);

test("盤レイアウト連携: 挿入→盤→回路図で回路図の属性が消えず、照合先は親部品になる", async ({ page }) => {
  // 画面操作が多く、負荷の高い環境で既定の15秒を超えることがあるため延ばす。
  test.setTimeout(30_000);
  await install(page, {
    schemaVersion: 4, activePageId: "layout", footprintDb: [],
    pages: [
      // 盤図ページを先に置く(旧実装は別の外形矩形を照合先に拾っていた)。
      blankPage("layout", "盤", []),
      blankPage("p1", "回路", [
        { id: "contact", type: "contactNO", x: 20, y: 40, w: 14, h: 10, tag: "CR1", label: "CR1", layer: "symbols" },
        { id: "coil", type: "coil", x: 60, y: 40, w: 10, h: 7, tag: "CR1", label: "CR1", manufacturer: "OMRON", catalog: "MY2N", description: "補助リレー", installation: "盤A", location: "上段", layer: "symbols" }
      ])
    ]
  });

  await page.locator("#actionMenu").selectOption("panelLink");
  await page.locator("#panelInsertBtn").click();
  const footprints = await page.evaluate(() => window.__edsTest.state.pages[0].elements.filter(item => item.panelRef === "CR1"));
  expect(footprints).toHaveLength(2);
  expect(footprints.find(item => item.manufacturer === "OMRON")).toMatchObject({ catalog: "MY2N", description: "補助リレー", installation: "盤A", location: "上段" });

  await page.locator("#actionMenu").selectOption("panelLink");
  await page.locator("#panelPullBtn").click();
  expect(await element(page, "coil")).toMatchObject({ manufacturer: "OMRON", catalog: "MY2N", description: "補助リレー", installation: "盤A", location: "上段" });
  expect((await element(page, "contact")).manufacturer).toBeUndefined();

  // 盤側で品番を変えれば回路図(親のコイル)へ反映される。
  await page.evaluate(() => {
    const foot = window.__edsTest.state.pages[0].elements.find(item => item.panelRef === "CR1" && item.manufacturer === "OMRON");
    foot.catalog = "MY4N";
    window.__edsTest.syncPanelFootprints("toSchematic");
  });
  expect((await element(page, "coil")).catalog).toBe("MY4N");
  expect((await element(page, "contact")).catalog).toBeUndefined();
});

test("表計算データ往復編集: タグ変更は表示ラベルにも反映し、プレビューは部品名と変更前後で読める", async ({ page }) => {
  await install(page, {
    schemaVersion: 4, activePageId: "p1",
    pages: [blankPage("p1", "P1", [
      { id: "c1", type: "coil", x: 30, y: 40, w: 10, h: 7, tag: "CR1", label: "CR1", layer: "symbols" },
      { id: "c2", type: "coil", x: 60, y: 40, w: 10, h: 7, tag: "CR2", label: "運転リレー", layer: "symbols" }
    ])]
  });

  await page.locator("#actionMenu").selectOption("spreadsheetRoundtrip");
  const sheet = page.locator("#spreadsheetData");
  await sheet.fill((await sheet.inputValue()).replace("\tcoil\tCR1\t", "\tcoil\tCR5\t").replace("\tcoil\tCR2\t", "\tcoil\tCR6\t"));
  await page.locator("#spreadsheetPreview").click();
  const preview = page.locator("#dialogBody");
  await expect(preview).toContainText("タグ CR1→CR5");
  await expect(preview).toContainText("コイル CR1");
  await expect(preview).not.toContainText("c1:");
  await page.locator("#spreadsheetApply").click();

  expect(await element(page, "c1")).toMatchObject({ tag: "CR5", label: "CR5" });
  // タグと別の文言にしてあるラベルは残す。
  expect(await element(page, "c2")).toMatchObject({ tag: "CR6", label: "運転リレー" });
  await expect(page.locator('#canvas [data-id="c1"]')).toContainText("CR5");
});

test("属性スポイト: シンボルデザイン・品番は同じ種別にだけ寸法補正つきで貼り、設備/場所は種別をまたいで貼る", async ({ page }) => {
  // 画面操作が多く、負荷の高い環境で既定の15秒を超えることがあるため延ばす。
  test.setTimeout(30_000);
  await page.evaluate(base => {
    const t = window.__edsTest;
    const source = { ...t.defaultElement("coil", 30, 40), id: "src", tag: "CR1", label: "CR1", manufacturer: "OMRON", catalog: "MY2N", description: "補助リレー", installation: "盤A", location: "上段" };
    t.installProjectData({
      schemaVersion: 4, activePageId: "p1",
      pages: [{ ...base, elements: [
        source,
        { ...t.defaultElement("contactNO", 30, 80), id: "contact", tag: "CR1", label: "CR1" },
        { ...t.defaultElement("lamp", 80, 80), id: "lamp", tag: "PL1", label: "PL1" },
        { ...t.defaultElement("coil", 80, 40), id: "coil2", tag: "CR2", label: "CR2" }
      ] }]
    });
  }, blankPage("p1", "P1", []));
  // 元コイルを箱形デザインにする(右パネルと同じ寸法補正の経路)。
  await page.evaluate(() => window.__edsTest.selectElement("src"));
  await page.locator('[data-bind="symbolVariant"]').selectOption("box");
  const source = await element(page, "src");
  expect(source.symbolVariant).toBe("box");

  await page.locator("#actionMenu").selectOption("attributeBrush");
  const contactBefore = await element(page, "contact");
  await page.locator('[data-id="contact"]').click();
  const contact = await element(page, "contact");
  expect(contact.symbolVariant).toBe(contactBefore.symbolVariant);
  expect([contact.w, contact.h]).toEqual([contactBefore.w, contactBefore.h]);
  expect(contact.manufacturer).toBeUndefined();
  expect(contact.description).toBeUndefined();
  expect(contact).toMatchObject({ installation: "盤A", location: "上段" });
  await expect(page.locator("#status")).toContainText("貼っていません");

  await page.locator('[data-id="lamp"]').click();
  const lamp = await element(page, "lamp");
  expect(lamp.symbolVariant).toBeUndefined();
  expect(lamp.catalog).toBeUndefined();
  expect(lamp.installation).toBe("盤A");

  const pinBefore = await page.evaluate(() => window.__edsTest.elementFirstPin(window.__edsTest.state.pages[0].elements.find(item => item.id === "coil2")));
  await page.locator('[data-id="coil2"]').click();
  const coil2 = await element(page, "coil2");
  expect(coil2).toMatchObject({ symbolVariant: "box", manufacturer: "OMRON", catalog: "MY2N", description: "補助リレー", w: source.w, h: source.h });
  const pinAfter = await page.evaluate(() => window.__edsTest.elementFirstPin(window.__edsTest.state.pages[0].elements.find(item => item.id === "coil2")));
  expect(pinAfter).toEqual(pinBefore);
  await page.keyboard.press("Escape");
});

test("属性スポイト: 向きは同じ種別へ寸法補正つきで貼る", async ({ page }) => {
  await page.evaluate(base => {
    const t = window.__edsTest;
    t.installProjectData({
      schemaVersion: 4, activePageId: "p1",
      pages: [{ ...base, elements: [
        { ...t.defaultElement("contactNO", 30, 40), id: "v", tag: "CR1", label: "CR1" },
        { ...t.defaultElement("contactNO", 80, 40), id: "h", tag: "CR2", label: "CR2" }
      ] }]
    });
  }, blankPage("p1", "P1", []));
  await page.evaluate(() => window.__edsTest.selectElement("v"));
  await page.locator('[data-bind="orientation"]').selectOption("vertical");
  const source = await element(page, "v");
  const target = await element(page, "h");
  expect(target.orientation).not.toBe("vertical");
  const pinBefore = await page.evaluate(() => window.__edsTest.elementFirstPin(window.__edsTest.state.pages[0].elements.find(item => item.id === "h")));

  await page.locator("#actionMenu").selectOption("attributeBrush");
  await page.locator('[data-id="h"]').click();
  const brushed = await element(page, "h");
  expect(brushed).toMatchObject({ orientation: "vertical", w: source.w, h: source.h });
  const pinAfter = await page.evaluate(() => window.__edsTest.elementFirstPin(window.__edsTest.state.pages[0].elements.find(item => item.id === "h")));
  expect(pinAfter).toEqual(pinBefore);
  await page.keyboard.press("Escape");
});

test("項目番号・バルーン・銘板: 六角形を選べ、対象が無いときは作り方を案内する", async ({ page }) => {
  await install(page, {
    schemaVersion: 4, activePageId: "p1",
    pages: [
      blankPage("p1", "盤", [{ id: "foot", type: "rect", x: 40, y: 40, w: 20, h: 14, label: "CR1", panelRef: "CR1", layer: "layout" }]),
      blankPage("p2", "空", [])
    ]
  });
  await page.locator("#actionMenu").selectOption("panelAnnotation");
  await expect(page.locator("#dialogBody")).toContainText("盤レイアウト連携");
  await page.locator("#panelBalloonShape").selectOption("hex");
  await page.locator("#panelAnnotationApply").click();
  const annotations = await page.evaluate(() => window.__edsTest.state.pages[0].elements.filter(item => item.panelAnnotationFor === "foot"));
  const balloon = annotations.find(item => item.label === "1" && item.type !== "rect");
  expect(balloon.type).toBe("polygon");
  expect(balloon.points).toHaveLength(6);
  expect(annotations.some(item => item.type === "circle")).toBe(false);

  // 丸に戻して再生成すると前回分を置き換える。
  await page.locator("#actionMenu").selectOption("panelAnnotation");
  await page.locator("#panelBalloonShape").selectOption("circle");
  await page.locator("#panelAnnotationApply").click();
  const again = await page.evaluate(() => window.__edsTest.state.pages[0].elements.filter(item => item.panelAnnotationFor === "foot"));
  expect(again.filter(item => item.type === "circle")).toHaveLength(1);
  expect(again.some(item => item.type === "polygon")).toBe(false);

  await page.evaluate(() => { window.__edsTest.state.activePageId = "p2"; window.__edsTest.setSelectionForTest([]); });
  await page.locator("#actionMenu").selectOption("panelAnnotation");
  await expect(page.locator("#status")).toContainText("盤レイアウト連携」の「挿入」");
});

test("DINレール: 取付穴はレールと同じグループで一緒に移動する", async ({ page }) => {
  await install(page, { schemaVersion: 4, activePageId: "p1", pages: [blankPage("p1", "P1", [])] });
  await page.locator("#actionMenu").selectOption("dinRail");
  await page.locator("#dinLength").fill("50");
  await page.locator("#dinBuild").click();
  const created = await page.evaluate(() => window.__edsTest.state.pages[0].elements);
  const rail = created.find(item => item.accessoryType === "rail");
  const holes = created.filter(item => item.type === "circle");
  expect(holes.length).toBeGreaterThan(1);
  expect(rail.group).toBeTruthy();
  expect(holes.every(item => item.group === rail.group)).toBe(true);

  await page.keyboard.press("Escape");
  const box = await page.locator(`[data-id="${rail.id}"]`).boundingBox();
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + box.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  const after = await page.evaluate(() => window.__edsTest.state.pages[0].elements);
  const movedRail = after.find(item => item.id === rail.id);
  const dx = movedRail.x - rail.x, dy = movedRail.y - rail.y;
  expect(Math.abs(dx) + Math.abs(dy)).toBeGreaterThan(0);
  holes.forEach(hole => {
    const moved = after.find(item => item.id === hole.id);
    expect(moved.x - hole.x).toBeCloseTo(dx, 5);
    expect(moved.y - hole.y).toBeCloseTo(dy, 5);
  });
});

test("ケーブル展開: 中央マーカーの「1-N」は芯行として一覧・保存しない(旧図面も含む)", async ({ page }) => {
  await install(page, { schemaVersion: 4, activePageId: "p1", cables: [], pages: [blankPage("p1", "P1", [])] });
  await page.locator("#actionMenu").selectOption("cableFan");
  await page.locator("#fanCableTag").fill("CBL9");
  await page.locator("#fanCoreCount").fill("3");
  await page.locator("#fanApply").click();
  expect(await page.evaluate(() => window.__edsTest.cableCoreRows().map(row => row.core))).toEqual(["1", "2", "3"]);

  await page.locator("#actionMenu").selectOption("cableManager");
  await expect(page.locator("[data-cable-row]")).toHaveCount(3);
  await page.locator("#applyCableBtn").click();
  expect(await page.evaluate(() => window.__edsTest.state.cables.map(row => row.core))).toEqual(["1", "2", "3"]);
  // マーカー表示(1-3)はそのまま残る。
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.type === "cableMarker").coreNo)).toBe("1-3");

  // 印の無い旧図面: マーカー「1-4」と、DBへ保存されてしまった偽の「1-4」行を一覧から外す。
  await install(page, {
    schemaVersion: 4, activePageId: "p1",
    cables: ["1", "2", "3", "4", "1-4"].map(core => ({ tag: "C2", core, color: "", gauge: "", status: "used", from: "", to: "", shielded: false })),
    pages: [blankPage("p1", "P1", [
      { id: "m", type: "cableMarker", x: 60, y: 60, w: 28, h: 12, label: "C2", cableTag: "C2", coreNo: "1-4", layer: "symbols" },
      { id: "single", type: "cableMarker", x: 60, y: 90, w: 28, h: 12, label: "C3", cableTag: "C3", coreNo: "1-2", layer: "symbols" }
    ])]
  });
  const rows = await page.evaluate(() => window.__edsTest.cableCoreRows().map(row => row.tag + ":" + row.core));
  expect(rows).toEqual(["C2:1", "C2:2", "C2:3", "C2:4", "C3:1-2"]);
});

test("設置場所・接続ビューの「表示」は標準ジャンプで移動し、Alt+←で戻れる", async ({ page }) => {
  await install(page, {
    schemaVersion: 4, activePageId: "p1",
    pages: [
      blankPage("p1", "P1", [{ id: "a", type: "coil", x: 30, y: 40, w: 10, h: 7, tag: "CR1", label: "CR1", installation: "盤A", layer: "symbols" }]),
      blankPage("p2", "P2", [{ id: "b", type: "coil", x: 150, y: 260, w: 10, h: 7, tag: "CR2", label: "CR2", installation: "盤B", layer: "symbols" }])
    ]
  });
  await page.evaluate(() => window.__edsTest.selectElement("a"));
  await page.locator("#actionMenu").selectOption("locationView");
  await page.locator("#dialogBody tr", { hasText: "CR2" }).locator("[data-location-jump]").click();
  expect(await page.evaluate(() => window.__edsTest.state.activePageId)).toBe("p2");
  await expect(page.locator('#canvas [data-id="b"]')).toBeVisible();

  await page.keyboard.press("Alt+ArrowLeft");
  expect(await page.evaluate(() => window.__edsTest.state.activePageId)).toBe("p1");
});

test("図面上のエラー表示: 1要素の複数指摘をツールチップにすべて並べる", async ({ page }) => {
  await install(page, {
    schemaVersion: 4, activePageId: "p1", settings: { auditOverlay: true },
    pages: [blankPage("p1", "P1", [{ id: "bare", type: "coil", x: 30, y: 40, w: 10, h: 7, tag: "", label: "", layer: "symbols" }])]
  });
  const titles = await page.evaluate(() => Array.from(document.querySelectorAll('#canvas g[data-id="bare"] > title')).map(item => item.textContent));
  const tooltip = titles.find(text => text.includes("ラベルが未入力です。"));
  expect(tooltip).toContain("部品タグが未採番です。");
  expect(tooltip).toContain("指摘2件");
});

test("ショートカット設定: 矩形表記・初期値は保存まで反映しない・固定キーを拒否・リボン表示を更新", async ({ page }) => {
  // 画面操作が多く、負荷の高い環境で既定の15秒を超えることがあるため延ばす。
  test.setTimeout(30_000);
  await page.locator("#ribbonShortcuts").click();
  await expect(page.locator("#dialogBody")).toContainText("矩形");
  await expect(page.locator("#dialogBody")).not.toContainText("四角形");

  // 固定キー(0)と重複は保存できず、ダイアログ内に理由を出す。
  await page.locator('[data-shortcut="wire"]').fill("0");
  await page.locator("#shortcutApply").click();
  await expect(page.locator("#shortcutMessage")).toContainText("固定キー");
  await page.locator('[data-shortcut="wire"]').fill("t");
  await page.locator("#shortcutApply").click();
  await expect(page.locator("#shortcutMessage")).toContainText("重複");
  expect(await page.evaluate(() => window.__edsTest.state.settings.shortcutMap)).toEqual({});

  await page.locator('[data-shortcut="wire"]').fill("e");
  await page.locator("#shortcutApply").click();
  expect(await page.evaluate(() => window.__edsTest.state.settings.shortcutMap.wire)).toBe("e");
  await expect(page.locator('#quickRibbon [data-tool="wire"]')).toHaveText("配線 E");
  await expect(page.locator('.tool-actions [data-tool="wire"]')).toHaveAttribute("title", /ショートカット: E/);

  // 「初期値」は入力欄を戻すだけ。閉じれば設定はそのまま。
  await page.locator("#ribbonShortcuts").click();
  await page.locator("#shortcutReset").click();
  await expect(page.locator('[data-shortcut="wire"]')).toHaveValue("W");
  expect(await page.evaluate(() => window.__edsTest.state.settings.shortcutMap.wire)).toBe("e");
  await page.locator("#dialogClose").click();
  await expect(page.locator('#quickRibbon [data-tool="wire"]')).toHaveText("配線 E");

  await page.locator("#ribbonShortcuts").click();
  await page.locator("#shortcutReset").click();
  await page.locator("#shortcutApply").click();
  expect(await page.evaluate(() => window.__edsTest.state.settings.shortcutMap.wire)).toBe("w");
  await expect(page.locator('#quickRibbon [data-tool="wire"]')).toHaveText("配線 W");
});

test("コマンドパレット: 機能メニュー全項目・ツールバー操作・部品の別名で検索でき、リボン名は「コマンド」", async ({ page }) => {
  // 画面操作が多く、負荷の高い環境で既定の15秒を超えることがあるため延ばす。
  test.setTimeout(30_000);
  await expect(page.locator("#ribbonCommand")).toHaveText("コマンド Ctrl+K");
  await page.locator("#ribbonCommand").click();
  const search = page.locator("#commandSearch");
  const results = page.locator("#commandResults");
  await search.fill("BOM");
  await expect(results).toContainText("部品集計表(BOM)");
  await search.fill("一括更新");
  await expect(results).toContainText("プロジェクト一括更新");
  await search.fill("MC");
  await expect(results).toContainText("配置: 電磁接触器");
  await search.fill("PDF印刷");
  await expect(results).toContainText("ツールバー: PDF印刷");
  await search.fill("線番採番");
  await expect(results).toContainText("自動処理: 線番採番");
  await expect(results).not.toContainText("コマンドパレット");

  await search.fill("ケーブル・芯線エディタ");
  await search.press("Enter");
  await expect(page.locator("#dialogTitle")).toHaveText("ケーブル・芯線エディタ");
  await page.locator("#dialogClose").click();

  await page.keyboard.press("Control+k");
  await search.fill("部品集計表");
  await search.press("Enter");
  await expect(page.locator("#dialogTitle")).toHaveText("部品集計表(BOM)");
});
