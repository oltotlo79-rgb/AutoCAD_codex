// 22章（クロスリファレンス）と24章（高速作画UI）の撮影ジョブ。
// 撮り直し: node docs/tools/capture-manual-screenshots.js 08-cross 110 111 112 113 114
const { job, freshPage, shot, shotDialog, settle, placeComponent, addLadderPage, deleteFirstPage,
  addBadges, boxOf, canvasPoint, clickEmpty, drawWire, hideCanvasHint, openAction } = require("../capture-manual-screenshots.js");

// 設備ラダーの行Y(mm)。ラダー図枠と同じ 27 + 9.5×行番号 を2.5mmグリッドへ丸めた値。
const rowY = row => Math.round((27 + 9.5 * row) / 2.5) * 2.5;

// クロスリファレンスの説明用サンプル: CR1=コイル+a接点+b接点、CR2=コイル+a接点。
async function crossRefSample(page) {
  await addLadderPage(page);
  await deleteFirstPage(page);
  await placeComponent(page, "contactNO", 45, rowY(2), { label: "CR1", tag: "CR1" });
  await placeComponent(page, "coil", 120, rowY(2), { label: "CR1", tag: "CR1" });
  await placeComponent(page, "contactNO", 45, rowY(5), { label: "CR1", tag: "CR1" });
  await placeComponent(page, "contactNC", 70, rowY(5), { label: "CR1", tag: "CR1" });
  await placeComponent(page, "coil", 120, rowY(5), { label: "CR2", tag: "CR2" });
  await placeComponent(page, "contactNO", 45, rowY(8), { label: "CR2", tag: "CR2" });
  await page.click("#selectOnlyBtn");
  await clickEmpty(page, 100, 200);
}

job(["08-cross-reference.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await crossRefSample(page);
  await openAction(page, "crossRef");
  await shotDialog(page, "08-cross-reference.png");
  await context.close();
});

// コマンドパレット: 「端子」で部品の配置と機能メニュー項目がまとめて見つかる例。
job(["110-command-palette.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await page.keyboard.press("Control+k");
  await page.waitForSelector("#commandSearch");
  await page.fill("#commandSearch", "端子");
  await page.dispatchEvent("#commandSearch", "input");
  await shotDialog(page, "110-command-palette.png");
  await context.close();
});

// ページナビゲータ: テンプレートで作った4ページを縮小表示した状態。
job(["111-page-navigator.png"], async browser => {
  const { context, page } = await freshPage(browser);
  const viaDialog = async (value, button) => {
    await page.selectOption("#templateMenu", value);
    await page.waitForSelector(button);
    await page.click(button);
    await page.locator("#dialogBackdrop").waitFor({ state: "hidden" });
    await settle(page, 250);
  };
  await viaDialog("facilityLadder", "#ladBuildBtn");
  await viaDialog("plcInput", "#plcInBuildBtn");
  await page.selectOption("#templateMenu", "terminalSheet");
  await settle(page, 250);
  await viaDialog("acPower", "#acBuildBtn");
  await deleteFirstPage(page);
  await page.click("#ribbonPages");
  await shotDialog(page, "111-page-navigator.png");
  await context.close();
});

// ショートカット設定: 固定キー「0」を割り当てようとして保存できなかった状態（赤字の理由表示）。
job(["112-shortcut-settings.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await page.click("#ribbonShortcuts");
  await page.waitForSelector('[data-shortcut="wire"]');
  await page.fill('[data-shortcut="wire"]', "0");
  await page.click("#shortcutApply");
  await settle(page, 120);
  await shotDialog(page, "112-shortcut-settings.png");
  await context.close();
});

// 図面上のエラー表示: 「検査表示」をONにして、指摘のある要素の右上へ赤い「!」が付いた状態。
job(["113-audit-overlay.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await addLadderPage(page);
  await deleteFirstPage(page);
  // 線番のない配線(途中で止まった未接続端つき)、接点のないコイル、タグが重複したコイル。
  await placeComponent(page, "coil", 120, rowY(2), { label: "CR1", tag: "CR1" });
  await placeComponent(page, "coil", 120, rowY(4), { label: "CR1", tag: "CR1" });
  await drawWire(page, 32.5, rowY(6), 90, rowY(6));
  await page.click("#selectOnlyBtn");
  await clickEmpty(page, 100, 200);
  await page.click("#ribbonAudit");
  await settle(page, 250);
  await hideCanvasHint(page);
  // 「!」のツールチップ(ブラウザ標準の吹き出し)は画面写真に写らないため、同じ文面を注記として重ねる。
  const markers = await page.evaluate(() => [...document.querySelectorAll("#canvas g[cursor=pointer]")]
    .filter(group => group.querySelector("title") && group.querySelector("circle"))
    .map(group => { const r = group.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, text: group.querySelector("title").textContent }; }));
  if (markers.length < 2) throw new Error("audit markers are not shown");
  const wireMarker = markers.reduce((a, b) => (b.y > a.y ? b : a));
  const ribbon = await boxOf(page, "#ribbonAudit");
  const workspace = await boxOf(page, "#workspace");
  await addBadges(page, "e2-audit", [
    { box: { x: ribbon.x - 4, y: ribbon.y - 4, width: ribbon.width + 8, height: ribbon.height + 8 } },
    { text: "① 検査表示", x: ribbon.x, y: ribbon.y + ribbon.height + 10, solid: true },
    ...markers.map(m => ({ box: { x: m.x - 6, y: m.y - 6, width: m.w + 12, height: m.h + 12 }, color: "#1f6feb" })),
    { text: "② 指摘のある要素に「!」", x: wireMarker.x + 26, y: wireMarker.y - 46, color: "#1f6feb", solid: true },
    { text: "マウスを置いたときの表示:\n" + wireMarker.text, x: wireMarker.x + 26, y: wireMarker.y - 8, color: "#1f6feb", fontSize: 13 }
  ]);
  const bottom = await canvasPoint(page, 0, rowY(9));
  await shot(page, "113-audit-overlay.png", { clip: { x: workspace.x, y: ribbon.y - 8, width: workspace.width, height: Math.round(bottom.y - ribbon.y + 8) } });
  await context.close();
});

// クイックリボン・ミニツールバー・パネル開閉ボタン・下部HUDの位置。
job(["114-quick-ribbon-mini-toolbar.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await addLadderPage(page);
  await deleteFirstPage(page);
  await placeComponent(page, "pushButton", 45, rowY(4), { label: "PB1" });
  await placeComponent(page, "coil", 120, rowY(4), { label: "CR1", tag: "CR1" });
  await placeComponent(page, "contactNO", 45, rowY(7), { label: "CR1", tag: "CR1" });
  await page.click("#selectOnlyBtn");
  await page.locator('#canvas [data-type="coil"]').first().click({ force: true });
  await settle(page, 250);
  const ribbon = await boxOf(page, "#quickRibbon");
  const mini = await boxOf(page, "#miniToolbar");
  const left = await boxOf(page, "#toggleLeftPanel");
  const right = await boxOf(page, "#toggleRightPanel");
  const hud = await boxOf(page, "#bottomHud");
  const frame = (b, pad = 4) => ({ x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 });
  await addBadges(page, "e2-ui", [
    { box: frame(ribbon, 2) },
    { text: "① クイックリボン", x: 1110, y: ribbon.y + 6, solid: true },
    { box: frame(mini) , color: "#1f6feb" },
    { text: "② ミニツールバー", x: mini.x + mini.width + 14, y: mini.y + 4, color: "#1f6feb", solid: true },
    { box: frame(left), color: "#2a9d8f" },
    { box: frame(right), color: "#2a9d8f" },
    { text: "③ パネル開閉", x: left.x + left.width + 12, y: left.y + 4, color: "#2a9d8f", solid: true },
    { text: "③", x: right.x - 44, y: right.y + 4, color: "#2a9d8f", solid: true },
    { box: frame(hud), color: "#e76f51" },
    { text: "④ 下部HUD", x: hud.x + hud.width + 14, y: hud.y - 2, color: "#e76f51", solid: true }
  ]);
  await shot(page, "114-quick-ribbon-mini-toolbar.png");
  await context.close();
});
