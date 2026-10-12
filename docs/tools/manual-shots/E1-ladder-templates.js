// 第19章（よくある操作）と第21章（ラダー図枠）の説明図 105〜109。
// 撮り直し: node docs/tools/capture-manual-screenshots.js 105 106 107 108 109
const { job, freshPage, shot, settle, canvasPoint, canvasClip, placeComponent, addBadges, boxOf, addLadderPage, setPageField }
  = require("../capture-manual-screenshots.js");

// 画面下の状態表示とキャンバスのヒントを隠す（説明用の番号札と重ならないように）。
async function hideOverlays(page) {
  await page.evaluate(() => ["#canvasHint", "#bottomHud", "#miniToolbar"].forEach(selector => {
    const element = document.querySelector(selector);
    if (element) element.style.display = "none";
  }));
}

// 機能メニューの項目を実行する（ダイアログを開かない項目用）。
async function runAction(page, value) {
  await page.selectOption("#actionMenu", value);
  await settle(page, 200);
}

// ズーム倍率を変えて、図面上の点(mm)が作業領域の指定位置(割合)に来るようスクロールする。
async function zoomTo(page, zoom, xMm, yMm, fx = 0.5, fy = 0.5) {
  await page.locator("#zoomRange").fill(String(zoom));
  await page.locator("#zoomRange").dispatchEvent("input");
  await settle(page, 200);
  const point = await canvasPoint(page, xMm, yMm);
  await page.locator(".workspace").evaluate((workspace, { point, fx, fy }) => {
    const area = workspace.getBoundingClientRect();
    workspace.scrollLeft += point.x - (area.left + workspace.clientWidth * fx);
    workspace.scrollTop += point.y - (area.top + workspace.clientHeight * fy);
  }, { point, fx, fy });
  await settle(page, 200);
}

// 図面上の矩形(mm)を画面上の枠にする。
async function mmBox(page, x1, y1, x2, y2) {
  return canvasClip(page, x1, y1, x2, y2);
}

// 現在ページの要素を条件で探してIDを返す。
async function findElementId(page, predicateSource) {
  return page.evaluate(source => {
    const state = window.__edsTest.state;
    const current = state.pages.find(item => item.id === state.activePageId);
    // eslint-disable-next-line no-new-func
    const predicate = new Function("element", `return (${source})(element);`);
    return current.elements.find(element => predicate(element))?.id || null;
  }, predicateSource);
}

// 図19-1: 端子接続図テンプレートの端子台TB1を選び、右パネルで端子数・開始番号を変える。
job(["107-terminal-sheet-strip.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await page.selectOption("#templateMenu", "terminalSheet");
  await settle(page, 300);
  const stripId = await findElementId(page, "element => element.type === 'terminalStrip'");
  await page.evaluate(id => window.__edsTest.selectElement(id), stripId);
  await settle(page, 200);
  await zoomTo(page, 3.2, 95, 100, 0.5, 0.5);
  const count = page.locator('#selectionPanel [data-bind="count"]').first();
  await count.scrollIntoViewIfNeeded();
  await settle(page, 200);
  await hideOverlays(page);
  const countBox = await count.boundingBox();
  const startBox = await page.locator('#selectionPanel [data-bind="start"]').first().boundingBox();
  const fields = {
    x: Math.min(countBox.x, startBox.x) - 8,
    y: countBox.y - 26,
    width: Math.max(countBox.x + countBox.width, startBox.x + startBox.width) - Math.min(countBox.x, startBox.x) + 16,
    height: countBox.height + 34
  };
  const strip = await mmBox(page, 122, 28, 138, 200);
  const rows = await mmBox(page, 35, 33.5, 122, 41.5);
  await addBadges(page, "manualTerminalSheet", [
    { box: rows, color: "#5367d5" },
    { x: rows.x + 10, y: rows.y - 84, text: "1行＝端子小円→配線（線番W01〜）→端子", color: "#5367d5", solid: true, fontSize: 14 },
    { box: strip },
    { x: strip.x + strip.width + 8, y: strip.y + strip.height / 2, text: "① 端子台TB1を選択", solid: true, fontSize: 14 },
    { box: fields },
    { x: fields.x - 250, y: fields.y + 8, text: "② 端子数・開始番号を変更", solid: true, fontSize: 14 }
  ]);
  await shot(page, "107-terminal-sheet-strip.png");
  await context.close();
});

// 図19-2: 設備ラダーへ「ラング追加」で横線を引き、ラング上へ接点とコイルを置いた状態。
job(["108-ladder-rung-parts.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await addLadderPage(page);
  await runAction(page, "addRung");
  await runAction(page, "addRung");
  await placeComponent(page, "contactNO", 62.5, 55, { label: "PB1" });
  await placeComponent(page, "coil", 125, 55, { label: "CR1", tag: "CR1" });
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.__edsTest.setSelectionForTest([]));
  await page.click("#selectOnlyBtn");
  await zoomTo(page, 5, 90, 55, 0.5, 0.42);
  await hideOverlays(page);
  const rung2 = await mmBox(page, 30, 66, 150, 74);
  const parts = await mmBox(page, 58, 48, 140, 60);
  await addBadges(page, "manualRungParts", [
    { box: rung2, color: "#5367d5" },
    { x: rung2.x + 20, y: rung2.y + rung2.height + 8, text: "①「ラング追加」で引いた横線（P1〜N1）", color: "#5367d5", solid: true, fontSize: 14 },
    { box: parts },
    { x: parts.x + 10, y: parts.y - 40, text: "② 横線の上に置いた部品（配線は自動で分割）", solid: true, fontSize: 14 }
  ]);
  const clip = await canvasClip(page, 20, 15, 160, 100);
  await shot(page, "108-ladder-rung-parts.png", { clip });
  await context.close();
});

// 図19-3: 目次テンプレートの目次表を選び、右パネルの「セル文字」に1ページ1行で入力する。
job(["109-index-table-edit.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await page.selectOption("#templateMenu", "index");
  await settle(page, 300);
  const tableId = await findElementId(page, "element => element.type === 'table'");
  await page.evaluate(id => window.__edsTest.selectElement(id), tableId);
  await settle(page, 200);
  const cells = page.locator('#selectionPanel [data-bind="cellText"]').first();
  await cells.scrollIntoViewIfNeeded();
  await cells.fill("No.\t図番\t図名\t備考\n1\tE-001\t表紙\t\n2\tE-002\t図面目次\t\n3\tE-101\tAC電源回路\t\n4\tE-102\tリレー回路\t");
  await cells.dispatchEvent("change");
  await settle(page, 200);
  await zoomTo(page, 3.2, 105, 110, 0.5, 0.5);
  await cells.scrollIntoViewIfNeeded();
  await hideOverlays(page);
  const table = await mmBox(page, 27.5, 40, 177.5, 210);
  const cellBox = await cells.boundingBox();
  await addBadges(page, "manualIndexTable", [
    { box: table },
    { x: table.x + 12, y: table.y + table.height - 44, text: "① 目次表を選択", solid: true, fontSize: 14 },
    { box: { x: cellBox.x - 6, y: cellBox.y - 28, width: cellBox.width + 12, height: cellBox.height + 34 }, color: "#5367d5" },
    { x: cellBox.x - 286, y: cellBox.y + 6, text: "② セル文字に1行ずつ入力\n（列はタブまたはカンマで区切る）", color: "#5367d5", solid: true, fontSize: 14 }
  ]);
  await shot(page, "109-index-table-edit.png");
  await context.close();
});

// 図21-1: ページ設定タブの「図枠/表題欄」でラダー図枠へ切り替える。
job(["105-ladder-frame-switch.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await addLadderPage(page);
  await page.click("#inspectorTabPage");
  await page.selectOption("#frameVariant", "ladder");
  await settle(page, 300);
  await zoomTo(page, 3.2, 105, 120, 0.5, 0.5);
  await hideOverlays(page);
  const select = await boxOf(page, "#frameVariant");
  const frameBox = { x: select.x - 8, y: select.y - 30, width: select.width + 16, height: select.height + 38 };
  const rows = await mmBox(page, 21, 22, 30, 225);
  await addBadges(page, "manualLadderSwitch", [
    { box: frameBox },
    { x: frameBox.x - 330, y: frameBox.y + 10, text: "① ページ設定タブの「図枠/表題欄」で\n「ラダー: 行番号+機器符号表」を選ぶ", solid: true, fontSize: 14 },
    { box: rows, color: "#5367d5" },
    { x: rows.x + rows.width + 10, y: rows.y + 120, text: "② 左端に行番号00〜20が付く", color: "#5367d5", solid: true, fontSize: 14 }
  ]);
  await shot(page, "105-ladder-frame-switch.png");
  await context.close();
});

// 図21-2: ラダー図枠の各欄。電源投入回路とランプ行を生成し、表題欄と側注記を入力した状態。
job(["106-ladder-frame-page.png"], async browser => {
  const { context, page } = await freshPage(browser, { width: 1600, height: 1300 });
  await addLadderPage(page);
  await page.click("#inspectorTabPage");
  await page.selectOption("#frameVariant", "ladder");
  await settle(page, 200);
  // 表題欄一括更新（上部「表題欄」）: 装置区分＝設備、組織名＝作成。
  await page.click("#titleBatchBtn");
  await page.waitForSelector("#batchTitle");
  await page.fill("#batchTitle", "リレー回路");
  await page.fill("#batchFacility", "組立ライン1");
  await page.fill("#batchDrawingNo", "E-0102");
  await page.fill("#batchDesigner", "○○電機株式会社");
  await page.click("#applyTitleCurrentBtn");
  await settle(page, 200);
  // 右パネル: 客先機番＝設備コード、側注記。
  await page.click("#inspectorTabPage");
  await page.locator("#pageSideNote").evaluate(element => { element.closest("details").open = true; });
  await setPageField(page, "#pageInstallation", "No.1234");
  await setPageField(page, "#pageSideNote", "組立ライン1 制御盤");
  // 電源投入回路（行01〜04）とランプ行（行06）。
  await page.selectOption("#actionMenu", "powerOn");
  await page.waitForSelector("#poBuildBtn");
  await page.fill("#poRow", "1");
  await page.click("#poBuildBtn");
  await settle(page, 200);
  await page.selectOption("#actionMenu", "rungCircuit");
  await page.waitForSelector("#rcBuildBtn");
  await page.fill("#rcRow", "6");
  await page.fill("#rcCount", "1");
  await page.fill("#rcContacts", "1");
  await page.selectOption("#rcEnd", "lamp");
  await page.click("#rcBuildBtn");
  await settle(page, 200);
  await page.evaluate(() => {
    const test = window.__edsTest;
    const state = test.state;
    const current = state.pages.find(item => item.id === state.activePageId);
    const rowY = 27 + 9.5 * 6;
    current.elements.forEach(element => {
      if (element.type === "contactNO" && !element.label && Math.abs(element.y + 2.2 - rowY) < 0.6) { element.label = "CR2"; element.tag = "CR2"; }
      if (element.type === "lamp" && Math.abs(element.y + 2.2 - rowY) < 0.6) { element.label = "PL1"; element.tag = "PL1"; element.description = "運転準備完了"; }
      if (element.type === "coil" && element.tag === "CR1") element.description = "電源投入";
      if (element.type === "coil" && element.tag === "CR2") element.description = "運転準備";
    });
    test.commitHistory("説明図用のタグを設定しました。");
    test.setSelectionForTest([]);
  });
  await page.click("#selectOnlyBtn");
  await page.click("#autoWireBtn");
  await settle(page, 300);
  await page.evaluate(() => window.__edsTest.setSelectionForTest([]));
  await page.locator(".workspace").evaluate(workspace => { workspace.scrollTop = 0; });
  await hideOverlays(page);
  await settle(page, 200);
  const label = (text, x, y, color, extra = {}) => ({ x, y, text, color, solid: true, fontSize: 13, padding: "3px 8px", ...extra });
  const rows = await mmBox(page, 21, 22, 30, 222);
  const xref = await mmBox(page, 19.5, 224.5, 105.3, 272.5);
  const device = await mmBox(page, 106.3, 224.5, 190.5, 252);
  const title = await mmBox(page, 106.3, 253, 190.5, 272.5);
  const side = await mmBox(page, 13.5, 115, 19, 182);
  const org = await mmBox(page, 152, 274.2, 191.5, 278.6);
  await addBadges(page, "manualLadderFrame", [
    { box: rows, color: "#5367d5" }, label("① 行番号", rows.x + rows.width + 6, rows.y + 330, "#5367d5"),
    { box: xref, color: "#0f8f7c" }, label("② クロスリファレンス表", xref.x + 8, xref.y + 60, "#0f8f7c"),
    { box: device, color: "#b45309" }, label("③ 機器符号表", device.x + 60, device.y + 40, "#b45309"),
    { box: title, color: "#d1495b" }, label("④ 表題欄", title.x + 10, title.y + title.height + 26, "#d1495b"),
    { box: side, color: "#7c3aed" }, label("⑤ 側注記", rows.x + rows.width + 6, side.y + 150, "#7c3aed"),
    { box: org, color: "#d97706" }, label("⑥ 組織名", org.x - 10, org.y + 20, "#d97706")
  ]);
  const canvas = await boxOf(page, "#canvas");
  await shot(page, "106-ladder-frame-page.png", { clip: canvas });
  await context.close();
});
