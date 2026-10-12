// §21.4 シンボルデザインの切替: 右パネルのデザイン選択欄と一括変更の画面写真。
//   125-symbol-design-panel.png … 「シンボルデザイン（規格・様式切替）」と「左右反転」（光電スイッチ3線式を左右に並べた例）
//   126-symbol-design-bulk.png  … 「同種をページ内全選択」後の「シンボルデザイン一括変更（同種部品）」
const { job, freshPage, shot, settle, placeComponent, addBadges, boxOf, canvasPoint, hideCanvasHint } = require("../capture-manual-screenshots.js");

// 配置モードを抜けて選択ツールへ戻す(連続配置が既定ONのため)。選択中の部品はそのまま。
async function backToSelect(page) {
  await page.click('.tool-actions [data-tool="select"]');
  await settle(page, 120);
}

// 図面を拡大し、指定した図面座標(mm)がキャンバス表示域の中央付近に来るようスクロールする。
async function zoomTo(page, zoom, xMm, yMm) {
  await page.locator("#zoomRange").fill(String(zoom));
  await page.locator("#zoomRange").dispatchEvent("input");
  await settle(page, 200);
  const point = await canvasPoint(page, xMm, yMm);
  await page.evaluate(({ x, y }) => {
    const svg = document.querySelector("#canvas");
    let scroller = svg.parentElement;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 4 || scroller.scrollWidth > scroller.clientWidth + 4)) scroller = scroller.parentElement;
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    scroller.scrollLeft += x - (rect.left + rect.width / 2);
    scroller.scrollTop += y - (rect.top + rect.height / 2);
  }, point);
  await settle(page, 200);
}

job(["125-symbol-design-panel.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await placeComponent(page, "photoelectricSwitch", 70, 90, { variant: "wired3" });
  await placeComponent(page, "photoelectricSwitch", 115, 90, { variant: "wired3" });
  await backToSelect(page);
  await page.locator('#selectionPanel [data-bind="mirrorX"]').check();
  await settle(page, 200);
  await zoomTo(page, 9, 103, 95);
  await hideCanvasHint(page);
  await page.addStyleTag({ content: "#miniToolbar,.mini-toolbar{display:none!important}" });
  const select = page.locator('#selectionPanel [data-bind="symbolVariant"]');
  await select.scrollIntoViewIfNeeded();
  await page.locator(".inspector").evaluate((panel, top) => { panel.scrollTop += top; }, 0);
  await settle(page, 200);
  const selectBox = await boxOf(page, '#selectionPanel [data-bind="symbolVariant"]');
  const mirrorLabel = page.locator('#selectionPanel label:has([data-bind="mirrorX"])');
  const mirrorBox = await mirrorLabel.boundingBox();
  const labelLeft = await canvasPoint(page, 71, 80);
  const labelRight = await canvasPoint(page, 117, 80);
  await addBadges(page, "manualDesignPanel", [
    { box: { x: selectBox.x - 6, y: selectBox.y - 28, width: selectBox.width + 12, height: selectBox.height + 34 } },
    { box: { x: mirrorBox.x - 6, y: mirrorBox.y - 4, width: mirrorBox.width + 12, height: mirrorBox.height + 8 }, color: "#1f5fbf" },
    { x: selectBox.x - 6, y: selectBox.y - 62, text: "① デザインを選ぶ", solid: true },
    { x: mirrorBox.x - 6, y: mirrorBox.y + mirrorBox.height + 8, text: "② 左右反転（文字は正立のまま）", solid: true, color: "#1f5fbf" },
    { x: labelLeft.x, y: labelLeft.y, text: "左右反転なし", center: true },
    { x: labelRight.x, y: labelRight.y, text: "左右反転あり（選択中）", center: true, color: "#1f5fbf" }
  ]);
  await settle(page, 200);
  await shot(page, "125-symbol-design-panel.png");
  await context.close();
});

job(["126-symbol-design-bulk.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await placeComponent(page, "contactNO", 60, 90);
  await placeComponent(page, "contactNO", 85, 90);
  await placeComponent(page, "contactNO", 110, 90);
  await backToSelect(page);
  await page.click("#selectSameTypeBtn");
  await settle(page, 200);
  await page.locator("#bulkVariantSelect").selectOption("iec");
  await settle(page, 300);
  await zoomTo(page, 11, 90, 92);
  await hideCanvasHint(page);
  await page.addStyleTag({ content: "#miniToolbar,.mini-toolbar{display:none!important}" });
  await page.locator("#bulkVariantSelect").scrollIntoViewIfNeeded();
  await settle(page, 200);
  const bulkBox = await boxOf(page, "#bulkVariantSelect");
  const title = await boxOf(page, "#selectionPanel .panel-title");
  const over = await canvasPoint(page, 85, 84);
  await addBadges(page, "manualDesignBulk", [
    { box: { x: title.x - 6, y: title.y - 4, width: title.width + 12, height: title.height + 8 }, color: "#1f5fbf" },
    { box: { x: bulkBox.x - 6, y: bulkBox.y - 28, width: bulkBox.width + 12, height: bulkBox.height + 34 } },
    { x: title.x - 360, y: title.y - 6, text: "① 「同種をページ内全選択」で3件を選択", solid: true, color: "#1f5fbf" },
    { x: bulkBox.x - 300, y: bulkBox.y + 70, text: "② 一括変更するデザインを選ぶ →", solid: true },
    { x: over.x, y: over.y, text: "3件ともメーク接点（JIS 07-02-01）に変わる", center: true }
  ]);
  await settle(page, 200);
  await shot(page, "126-symbol-design-bulk.png");
  await context.close();
});
