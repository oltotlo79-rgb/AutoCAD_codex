// 12〜17章（自動処理・検索・保存）の追加図 100〜104。
//   100-backup-restore.png   … 上部「復元」のダイアログ（最新＋世代1）
//   101-rung-shift-dialog.png … 機能メニュー「行挿入/行削除（行シフト）」のダイアログ
//   102-drawing-diff.png      … 図面差分（旧版JSONと比較）の件数表と「表示」プレビュー
//   103-tag-rules.png         … 機能メニュー「部品タグ規則」のダイアログ（先頭部分）
//   104-replace-preview.png   … 図面検索の一括置換プレビュー
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { job, freshPage, shot, shotDialog, closeDialog, openAction, settle, setPageField, addLadderPage, deleteFirstPage, boxOf } =
  require("../capture-manual-screenshots.js");

// 電源投入回路（SS1・PB1・CR1/CR2）だけの小さなサンプル。線番は全ページ・上書き・開始番号1で採番する。
async function powerOnSample(page) {
  await addLadderPage(page);
  await deleteFirstPage(page);
  await openAction(page, "powerOn");
  await page.fill("#poRow", "1");
  await page.fill("#poKs", "SS1");
  await page.fill("#poPb", "PB1");
  await page.fill("#poCr", "CR1,CR2");
  await page.click("#poBuildBtn");
  await settle(page);
  await page.click("#selectOnlyBtn");
  await page.click("#autoWireBtn");
  await settle(page);
  await setPageField(page, "#pageName", "リレー回路");
}

// 100: 編集 → 再読み込み → もう一度編集 で「最新」と「世代1」の2行がそろった状態の復元ダイアログ。
job(["100-backup-restore.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await powerOnSample(page);
  // 再読み込み時の「このページを離れますか」はfreshPageのダイアログ処理が受け入れる。
  await page.reload();
  await page.waitForSelector("#canvas");
  await settle(page, 300);
  await addLadderPage(page);
  await page.click("#restoreBackupBtn");
  await shotDialog(page, "100-backup-restore.png");
  await closeDialog(page);
  await context.close();
});

// 101: 行挿入/行削除ダイアログ。「行を削除」を選んだ状態で撮る。
job(["101-rung-shift-dialog.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await addLadderPage(page);
  await openAction(page, "rungShift");
  await page.selectOption("#rsMode", "delete");
  await page.fill("#rsRow", "5");
  await page.fill("#rsCount", "1");
  await shotDialog(page, "101-rung-shift-dialog.png");
  await context.close();
});

// 102: 旧版JSONを保存 → 部品の移動・削除・追加 → 図面差分で比較し、「表示」でプレビューを開く。
job(["102-drawing-diff.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await page.setViewportSize({ width: 1600, height: 1400 });
  await powerOnSample(page);
  const oldJson = await page.evaluate(() => JSON.stringify(window.__edsTest.state));
  const oldFile = path.join(os.tmpdir(), "manual-diff-revA.json");
  fs.writeFileSync(oldFile, oldJson);
  await page.evaluate(() => {
    const T = window.__edsTest;
    const p = T.state.pages.find(item => item.id === T.state.activePageId);
    const button = p.elements.find(element => element.type === "pushButton");
    const selector = p.elements.find(element => element.type === "selectorSwitch");
    // 押しボタンのタグを変更（変更）、切替スイッチを削除（削除）、ランプを追加（追加）。
    if (button) { button.tag = "PB5"; button.label = "PB5"; }
    if (selector) p.elements = p.elements.filter(element => element !== selector);
    p.elements.push({ ...T.defaultElement("lamp", 120, 120), tag: "PL1", label: "PL1" });
    T.commitHistory("差分撮影用の変更");
  });
  const chooser = page.waitForEvent("filechooser");
  await page.selectOption("#actionMenu", "diffViewer");
  await (await chooser).setFiles(oldFile);
  await page.waitForSelector("#dialogBackdrop:not(.hidden) [data-diff-page]");
  await page.click("[data-diff-page]");
  await settle(page, 300);
  await page.locator(".dialog").evaluate(element => { element.style.maxHeight = "none"; element.style.overflow = "visible"; });
  await settle(page, 200);
  // プレビューは用紙全体を描くので縦に長い。件数表と、差分枠のある上半分だけを切り出す。
  const dialog = await boxOf(page, ".dialog");
  await shot(page, "102-drawing-diff.png", { clip: { x: dialog.x, y: dialog.y, width: dialog.width, height: Math.min(dialog.height, 900) } });
  fs.rmSync(oldFile, { force: true });
  await context.close();
});

// 103: 部品タグ規則。表の先頭（a接点〜）が見える範囲を撮る。
job(["103-tag-rules.png"], async browser => {
  const { context, page } = await freshPage(browser, { width: 1600, height: 820 });
  await openAction(page, "tagRules");
  await shotDialog(page, "103-tag-rules.png");
  await context.close();
});

// 104: 一括置換プレビュー（CR2 → CR5）。
job(["104-replace-preview.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await powerOnSample(page);
  await page.click("#searchBtn");
  await page.fill("#searchQuery", "cr2");
  await page.fill("#replaceValue", "CR5");
  await page.click("#runReplaceBtn");
  await page.waitForSelector("#replaceApplyBtn");
  await shotDialog(page, "104-replace-preview.png");
  await context.close();
});
