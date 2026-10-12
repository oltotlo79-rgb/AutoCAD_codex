// 1〜5章（はじめに・画面構成・ページ操作・用紙と図枠）の追加撮影ジョブ。
// 撮り直し: node docs/tools/capture-manual-screenshots.js 61 85 86 87
const { job, freshPage, shot, shotDialog, settle, addBadges, boxOf, setPageField, hideCanvasHint } = require("../capture-manual-screenshots.js");

// 図3-2: 上部ツールバーとクイック作図リボンのボタングループ。番号は manual.md の 3.1 / 3.2b の箇条と対応する。
job(["85-toolbar-ribbon.png"], async browser => {
  const { context, page } = await freshPage(browser);
  const groupBox = async (first, last) => {
    const a = await boxOf(page, first);
    const b = await boxOf(page, last);
    return { x: a.x - 4, y: Math.min(a.y, b.y) - 4, width: b.x + b.width - a.x + 8, height: Math.max(a.height, b.height) + 8 };
  };
  const groups = [
    { text: "1", color: "#d1495b", box: await groupBox("#newProjectBtn", "#saveBtn") },
    { text: "2", color: "#5367d5", box: await groupBox("#searchBtn", "#titleBatchBtn") },
    { text: "3", color: "#b45309", box: await groupBox("#printPreviewBtn", "#exportPngBtn") },
    { text: "4", color: "#0f8f7c", box: await groupBox('.tool-actions [data-tool="select"]', "#deleteBtn") },
    { text: "5", color: "#7c3aed", box: await groupBox("#status", "#status") },
    { text: "6", color: "#d1495b", box: await groupBox('#quickRibbon [data-tool="select"]', '#quickRibbon [data-tool="text"]') },
    { text: "7", color: "#5367d5", box: await groupBox("#ribbonRepeat", "#ribbonDelete") },
    { text: "8", color: "#b45309", box: await groupBox("#ribbonAudit", "#ribbonCommand") },
    { text: "9", color: "#0f8f7c", box: await groupBox("#ribbonPanels", "#ribbonShortcuts") }
  ];
  // ステータス表示は2段目いっぱいに伸びるので、文字のある左側だけを囲む。
  groups[4].box.width = 300;
  const badges = [];
  groups.forEach(group => {
    badges.push({ box: group.box, color: group.color });
    // 番号はグループの下辺中央へ重ね、ボタンの文字を隠さないようにする。
    badges.push({ x: group.box.x + group.box.width / 2, y: group.box.y + group.box.height - 12, text: group.text, color: group.color,
      solid: true, round: true, fontSize: 13, padding: "1px 8px", center: true });
  });
  badges[9] = { ...badges[9], x: groups[4].box.x + groups[4].box.width + 6, y: groups[4].box.y + 2, center: false };
  await addBadges(page, "manualToolbarGroups", badges);
  await hideCanvasHint(page);
  await settle(page);
  const ribbon = await boxOf(page, "#quickRibbon");
  const tools = groups[3].box;
  await shot(page, "85-toolbar-ribbon.png", { clip: { x: 0, y: 0, width: tools.x + tools.width + 16, height: ribbon.y + ribbon.height + 14 } });
  await context.close();
});

// 図4-1: ページ複製ダイアログ（X060のページを16ずつずらして2枚作る例）。
job(["86-page-duplicate-dialog.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await setPageField(page, "#pageName", "X060");
  await page.click("#duplicatePageBtn");
  await page.waitForSelector("#dupRunBtn");
  await page.fill("#dupCount", "2");
  await page.fill("#dupOffset", "16");
  await shotDialog(page, "86-page-duplicate-dialog.png");
  await context.close();
});

// 図5-1: 6種類の図枠を並べて表示した比較。ページ名に図枠の名前を入れる。
job(["87-frame-variants.png"], async browser => {
  const { context, page } = await freshPage(browser, { width: 1900, height: 720 });
  const frames = [
    ["compact", "基本: 右下表題欄"], ["detailed", "詳細: 右下+改訂欄"], ["side", "側面表題欄"],
    ["index", "目次/表紙: 大型表欄"], ["ladder", "ラダー: 行番号+機器符号表"], ["blank", "枠線のみ"]
  ];
  await setPageField(page, "#drawingTitle", "制御回路図");
  for (let i = 0; i < frames.length; i += 1) {
    if (i > 0) {
      await page.click("#inspectorTabPage");
      await page.click("#addPageBtn");
      await settle(page);
    }
    await page.selectOption("#frameVariant", frames[i][0]);
    await settle(page, 120);
    await setPageField(page, "#pageName", frames[i][1]);
  }
  await page.locator("#zoomRange").fill("1.1");
  await page.locator("#zoomRange").dispatchEvent("input");
  await page.selectOption("#pageViewMode", "row");
  await page.waitForSelector(".page-slot");
  await page.locator(".page-slot").first().locator(".page-slot-head .slot-label").click();
  // 6ページを1枚に収めるため、集中表示で左右パネルを閉じる。
  await page.click("#ribbonPanels");
  await settle(page, 300);
  await page.locator("#workspace").evaluate(element => { element.scrollLeft = 0; element.scrollTop = 0; });
  await hideCanvasHint(page);
  // 空ページに出る「はじめかた」カード(画面だけの案内)は図枠の比較には不要なので消して撮る。
  await page.evaluate(() => document.querySelectorAll('svg.drawing-page g[pointer-events="none"]').forEach(group => {
    if (group.textContent.includes("はじめかた")) group.remove();
  }));
  await settle(page, 200);
  const first = await boxOf(page, ".page-slot:first-child");
  const last = await boxOf(page, ".page-slot:last-child");
  await shot(page, "87-frame-variants.png", { clip: { x: first.x - 10, y: first.y - 6, width: last.x + last.width - first.x + 20, height: last.y + last.height - first.y + 14 } });
  await context.close();
});

// 図5-2: 表題欄を変更したときの「他のページへ反映しますか？」の確認。
job(["61-title-propagation.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await page.click("#addPageBtn");
  await settle(page);
  await page.locator("#tabbar .page-tab").first().click();
  await page.click("#inspectorTabPage");
  await page.fill("#drawingTitle", "制御回路図");
  await page.locator("#drawingTitle").evaluate(element => element.blur());
  await shotDialog(page, "61-title-propagation.png");
  await context.close();
});
