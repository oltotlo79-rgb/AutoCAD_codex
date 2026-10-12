// 第6〜8章（部品配置・選択後の編集・表の編集）の説明図 90〜94。
// 撮り直し: node docs/tools/capture-manual-screenshots.js 90 91 92 93 94
const { job, freshPage, shot, settle, canvasPoint, drawWire, placeComponent, addBadges, boxOf, hideCanvasHint } = require("../capture-manual-screenshots.js");

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

// 右パネルの入力欄へ値を入れて確定する（利用者と同じく change で反映）。
async function setPanel(page, bind, value) {
  const input = page.locator(`#selectionPanel [data-bind="${bind}"]`).first();
  if (await input.getAttribute("type") === "checkbox") {
    if (await input.isChecked() !== Boolean(value)) await input.click();
  } else {
    await input.fill(String(value));
    await input.dispatchEvent("change");
  }
  await settle(page, 80);
}

// 右パネルを、指定した入力欄が上端からtop(px)の位置に来るようスクロールする。
async function scrollInspector(page, selector, top) {
  await page.locator(`#selectionPanel ${selector}`).first().evaluate((element, top) => {
    const inspector = document.querySelector(".inspector");
    const delta = element.getBoundingClientRect().top - inspector.getBoundingClientRect().top;
    inspector.scrollTop += delta - top;
  }, top);
  await settle(page, 200);
}

// 図6-1: パレットの部品をクリックして配置モードにし、用紙（配線上）をクリックして置く。
job(["90-place-component.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await drawWire(page, 60, 60, 140, 60);
  await zoomTo(page, 8, 100, 60, 0.5, 0.42);
  const tile = page.locator('#paletteGrid .palette-item[data-type="contactNO"]').last();
  await tile.scrollIntoViewIfNeeded();
  await tile.click();
  for (const x of [85, 115]) {
    const point = await canvasPoint(page, x, 60);
    await page.mouse.click(point.x, point.y);
    await settle(page, 120);
  }
  await page.mouse.move(5, 995);
  await settle(page, 200);
  const tileBox = await tile.boundingBox();
  const left = await canvasPoint(page, 78, 54);
  const right = await canvasPoint(page, 122, 66);
  const inspector = await boxOf(page, "aside.inspector");
  const hint = await boxOf(page, "#canvasHint");
  await addBadges(page, "manualPlaceSteps", [
    { box: { x: tileBox.x - 3, y: tileBox.y - 3, width: tileBox.width + 6, height: tileBox.height + 6 } },
    { x: tileBox.x + tileBox.width + 10, y: tileBox.y + 12, text: "① パレットの部品をクリック\n（緑枠＝配置モード）", solid: true, round: false },
    { box: { x: left.x, y: left.y, width: right.x - left.x, height: right.y - left.y }, color: "#5367d5" },
    { x: left.x, y: right.y + 12, text: "② 用紙をクリックするたびに配置\n（配線の上なら配線へ割り込む）", color: "#5367d5", solid: true },
    { box: { x: inspector.x + 3, y: inspector.y + 3, width: inspector.width - 6, height: inspector.height - 6 }, color: "#0f8f7c" },
    { x: inspector.x - 236, y: inspector.y + 90, text: "③ 置いた部品は選択され\n右パネルで編集できる", color: "#0f8f7c", solid: true },
    { x: hint.x + hint.width / 2, y: hint.y + hint.height + 8, text: "④ 終わったら Esc（またはパレットの「選択」）", color: "#b45309", solid: true, center: true }
  ]);
  await settle(page);
  await shot(page, "90-place-component.png");
  await context.close();
});

// 図7-3: ラベル・ラベル位置・文字スタイル（右パネル）と図面上のラベル。
job(["91-label-text-style.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await drawWire(page, 60, 60, 140, 60);
  await placeComponent(page, "contactNO", 100, 60, { tag: "CR1" });
  await setPanel(page, "labelDy", 1);
  await zoomTo(page, 9, 100, 60, 0.5, 0.45);
  await page.click('.tool-actions [data-tool="select"]');
  const contact = await canvasPoint(page, 100, 60);
  await page.mouse.click(contact.x, contact.y);
  await settle(page, 600);
  await page.mouse.move(5, 995);
  await hideCanvasHint(page);
  const label = await boxOf(page, '#selectionPanel [data-bind="label"]');
  const offset = await boxOf(page, '#selectionPanel [data-bind="labelDy"]');
  const style = await boxOf(page, '#selectionPanel [data-bind="contentFontSize"]');
  const inspector = await boxOf(page, "aside.inspector");
  const text = await page.locator('#canvas [data-id] text').filter({ hasText: "CR1" }).first().boundingBox();
  const panelX = inspector.x + 4;
  const panelW = inspector.width - 8;
  await addBadges(page, "manualLabelStyle", [
    { box: { x: panelX, y: label.y - 26, width: panelW, height: offset.y + offset.height - label.y + 32 }, color: "#5367d5" },
    { x: inspector.x - 214, y: label.y + 2, text: "① ラベルとラベル位置X/Y\n（Yは上が＋）", color: "#5367d5", solid: true },
    { box: { x: panelX, y: style.y - 60, width: panelW, height: style.height + 100 }, color: "#d1495b" },
    { x: inspector.x - 214, y: style.y - 8, text: "② 文字スタイル\n（既定2.2mm・太字）", solid: true },
    { box: { x: text.x - 6, y: text.y - 5, width: text.width + 12, height: text.height + 10 }, color: "#5367d5" }
  ]);
  await settle(page);
  await shot(page, "91-label-text-style.png");
  await context.close();
});

// 図7-4: 電気属性の入力と「図面表示」による属性の表示。
job(["92-attribute-display.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await drawWire(page, 60, 60, 140, 60);
  await placeComponent(page, "coil", 100, 60, { tag: "CR1" });
  await setPanel(page, "description", "運転指令");
  await setPanel(page, "manufacturer", "オムロン");
  await setPanel(page, "catalog", "MY2N DC24");
  await setPanel(page, "rating", "DC24V");
  await setPanel(page, "showAttrTag", true);
  await setPanel(page, "showAttrManufacturer", true);
  await setPanel(page, "showAttrRating", true);
  await setPanel(page, "attrX", -4);
  await setPanel(page, "attrY", 10);
  await zoomTo(page, 8, 102, 64, 0.5, 0.45);
  await page.click('.tool-actions [data-tool="select"]');
  const coil = await canvasPoint(page, 100, 60);
  await page.mouse.click(coil.x, coil.y);
  await settle(page, 600);
  await page.locator('#selectionPanel [data-bind="attrFontSize"]').scrollIntoViewIfNeeded();
  await settle(page, 200);
  await page.mouse.move(5, 995);
  await hideCanvasHint(page);
  const inspector = await boxOf(page, "aside.inspector");
  const checks = await boxOf(page, '#selectionPanel [data-bind="showAttrTag"]');
  const size = await boxOf(page, '#selectionPanel [data-bind="attrFontSize"]');
  const attrText = await page.locator("#canvas text").filter({ hasText: "RATE" }).first().boundingBox();
  const tagText = await page.locator("#canvas text").filter({ hasText: "TAG" }).first().boundingBox();
  const top = Math.min(attrText.y, tagText.y);
  const bottom = Math.max(attrText.y + attrText.height, tagText.y + tagText.height) + 30;
  await addBadges(page, "manualAttrDisplay", [
    { box: { x: inspector.x + 4, y: checks.y - 30, width: inspector.width - 8, height: size.y + size.height - checks.y + 36 }, color: "#d1495b" },
    { x: inspector.x - 250, y: checks.y, text: "① 「図面表示」で表示する属性に\nチェックし、表示X/Y・文字サイズを調整", solid: true },
    { box: { x: Math.min(attrText.x, tagText.x) - 8, y: top - 6, width: Math.max(attrText.width, tagText.width, 150) + 16, height: bottom - top - 18 }, color: "#5367d5" },
    { x: Math.min(attrText.x, tagText.x) - 8, y: bottom + 4, text: "② 図面上に「TAG: CR1」などの形で表示", color: "#5367d5", solid: true }
  ]);
  await settle(page);
  await shot(page, "92-attribute-display.png");
  await context.close();
});

// 図7-5: 複数選択と整列・均等配置ボタン。
job(["93-multi-select-align.png"], async browser => {
  const { context, page } = await freshPage(browser);
  const spots = [[70, 62.5], [100, 57.5], [135, 65]];
  for (const [x, y] of spots) await placeComponent(page, "contactNO", x, y);
  await page.click('.tool-actions [data-tool="select"]');
  await zoomTo(page, 6, 102, 62, 0.5, 0.42);
  for (const [index, [x, y]] of spots.entries()) {
    const point = await canvasPoint(page, x, y);
    if (index) await page.keyboard.down("Shift");
    await page.mouse.click(point.x, point.y);
    if (index) await page.keyboard.up("Shift");
    await settle(page, 600);
  }
  await page.locator('#selectionPanel [data-distribute="y"]').scrollIntoViewIfNeeded();
  await settle(page, 200);
  await page.mouse.move(5, 995);
  // ミニツールバーが選択部品に重なるため、この図では隠す（主題は右パネルの整列ボタン）。
  await page.addStyleTag({ content: "#miniToolbar{display:none!important}" });
  const inspector = await boxOf(page, "aside.inspector");
  const alignTop = await boxOf(page, '#selectionPanel [data-align="left"]');
  const distribute = await boxOf(page, '#selectionPanel [data-distribute="y"]');
  const left = await canvasPoint(page, 62, 52);
  const right = await canvasPoint(page, 143, 70);
  await addBadges(page, "manualAlign", [
    { box: { x: left.x, y: left.y, width: right.x - left.x, height: right.y - left.y }, color: "#5367d5" },
    { x: left.x, y: right.y + 12, text: "① Shift＋クリックで3個を選択", color: "#5367d5", solid: true },
    { box: { x: inspector.x + 4, y: alignTop.y - 6, width: inspector.width - 8, height: distribute.y + distribute.height - alignTop.y + 12 }, color: "#d1495b" },
    { x: inspector.x - 236, y: alignTop.y, text: "② 整列（左・中・右／上・中央・下）\nと横均等・縦均等", solid: true }
  ]);
  await settle(page);
  await shot(page, "93-multi-select-align.png");
  await context.close();
});

// 図8-1: 表部品の編集（行・列・列幅・セル文字）。
job(["94-table-editing.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await placeComponent(page, "table", 30, 40);
  await setPanel(page, "label", "");
  await setPanel(page, "rows", 3);
  await setPanel(page, "cols", 4);
  await setPanel(page, "h", 24);
  await setPanel(page, "colWidths", "1,2,3,2");
  await setPanel(page, "cellText", "No.,図番,図名,備考\n1,EL-001,電源回路,\n2,EL-002,端子接続図,");
  await zoomTo(page, 6, 73, 52, 0.5, 0.45);
  await page.click('.tool-actions [data-tool="select"]');
  const cell = await canvasPoint(page, 31, 41);
  await page.mouse.click(cell.x, cell.y);
  await settle(page, 600);
  await scrollInspector(page, '[data-bind="rows"]', 330);
  await page.mouse.move(5, 995);
  await hideCanvasHint(page);
  const inspector = await boxOf(page, "aside.inspector");
  const rows = await boxOf(page, '#selectionPanel [data-bind="rows"]');
  const widths = await boxOf(page, '#selectionPanel [data-bind="colWidths"]');
  const cellText = await boxOf(page, '#selectionPanel [data-bind="cellText"]');
  await addBadges(page, "manualTable", [
    { box: { x: inspector.x + 4, y: rows.y - 28, width: inspector.width - 8, height: widths.y + widths.height - rows.y + 34 }, color: "#5367d5" },
    { x: inspector.x - 250, y: rows.y - 6, text: "① 行数・列数と列幅の比率\n（1,2,3,2 → 1:2:3:2）", color: "#5367d5", solid: true },
    { box: { x: inspector.x + 4, y: cellText.y - 28, width: inspector.width - 8, height: cellText.height + 34 }, color: "#d1495b" },
    { x: inspector.x - 250, y: cellText.y, text: "② セル文字: 1行＝表の1行、\n列はカンマで区切る", solid: true }
  ]);
  await settle(page);
  await shot(page, "94-table-editing.png");
  await context.close();
});
