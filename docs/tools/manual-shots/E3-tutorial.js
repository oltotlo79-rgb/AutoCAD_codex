// 26章「チュートリアル: はじめてのリレー回路図」の手順図（115〜124）と完成図（05）を撮るジョブ。
// 本文の手順どおりに、パレットからのドラッグ・W キーでの配線・右パネル入力・ボタン操作を実際に行い、
// 各段階の画面へ操作箇所の番号（①②…）を重ねて撮影する。番号は本文の箇条書きの番号と一致させる。
//
// 撮り直し: node docs/tools/capture-manual-screenshots.js tutorial
//   （05-ladder-circuit.png＝図26-1 も同じ操作の結果から撮る。「… 05-ladder」で指定しても同じジョブが動く）
const {
  job, freshPage, shot, settle, addBadges, removeBadges, canvasPoint, canvasClip, boxOf, hideCanvasHint
} = require("../capture-manual-screenshots.js");

const FILES = [
  "05-ladder-circuit.png",
  "115-tutorial-template.png",
  "116-tutorial-delete-p1.png",
  "117-tutorial-ladder-frame.png",
  "118-tutorial-place-parts.png",
  "119-tutorial-wiring.png",
  "120-tutorial-tag-input.png",
  "121-tutorial-cross-reference.png",
  "122-tutorial-wire-numbers.png",
  "123-tutorial-audit.png",
  "124-tutorial-save-print.png"
];

const RED = "#d1495b";
const BLUE = "#5367d5";
const ORANGE = "#d97706";
const GREEN = "#0f8f7c";
const PURPLE = "#7c3aed";

// ラダー図枠の行 n の高さ(mm)。行00 = 27mm、行ピッチ 9.5mm。
const ROW = n => 27 + 9.5 * n;

job(FILES, async browser => {
  const { context, page } = await freshPage(browser);

  // ---- 共通の小道具 -------------------------------------------------------------
  const pad = (box, d = 4) => ({ x: box.x - d, y: box.y - d, width: box.width + d * 2, height: box.height + d * 2 });
  const mmBox = async (x1, y1, x2, y2) => canvasClip(page, x1, y1, x2, y2);
  const pins = type => page.evaluate(t => {
    const s = window.__edsTest.state;
    const p = s.pages.find(item => item.id === s.activePageId);
    const element = p.elements.find(item => item.type === t);
    return window.__edsTest.elementConnectionAnchors(element).map(a => [a.x, a.y]);
  }, type);
  const tile = (group, label) => page.locator("#paletteGrid details.palette-group")
    .filter({ has: page.locator("summary", { hasText: group }) })
    .locator(".palette-item")
    .filter({ has: page.locator(".palette-label", { hasText: new RegExp(`^${label}$`) }) });
  // パレットのカテゴリを開いて部品をドラッグし、用紙上の (x, y) mm で離す。
  const dragPart = async (group, label, xMm, yMm) => {
    const details = page.locator("#paletteGrid details.palette-group").filter({ has: page.locator("summary", { hasText: group }) });
    if (!await details.evaluate(element => element.open)) await details.locator("summary").click();
    const target = await canvasPoint(page, xMm, yMm);
    const canvas = await boxOf(page, "#canvas");
    await tile(group, label).dragTo(page.locator("#canvas"), { targetPosition: { x: target.x - canvas.x, y: target.y - canvas.y } });
    await settle(page, 200);
  };
  // 本文どおり「W を押してからドラッグ」で1本引く（1本引くと選択ツールへ戻る）。
  const wire = async (from, to) => {
    await page.keyboard.press("w");
    const a = await canvasPoint(page, from[0], from[1]);
    const b = await canvasPoint(page, to[0], to[1]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.mouse.up();
    await settle(page, 160);
  };
  const clickAt = async (xMm, yMm) => {
    const point = await canvasPoint(page, xMm, yMm);
    await page.mouse.click(point.x, point.y);
    await settle(page, 200);
  };
  const setTag = async (type, tag) => {
    const [a, b] = await pins(type);
    await clickAt((a[0] + b[0]) / 2, a[1]);
    const input = page.locator('#selectionPanel [data-bind="tag"]');
    await input.scrollIntoViewIfNeeded();
    await input.fill(tag);
    await input.press("Enter");
    await settle(page, 160);
  };
  const deselect = async () => {
    await page.click("#selectOnlyBtn");
    await clickAt(100, 160);
    await page.keyboard.press("Escape");
    await settle(page, 120);
  };
  // 図面の一部を拡大して撮るときの表示倍率とスクロール。撮影後は元の倍率へ戻す。
  const withZoom = async (zoom, x1, y1, fn) => {
    const before = await page.locator("#zoomRange").inputValue();
    await page.locator("#zoomRange").fill(String(zoom));
    await page.locator("#zoomRange").dispatchEvent("input");
    await settle(page, 200);
    const corner = await canvasPoint(page, x1, y1);
    const workspace = await boxOf(page, "#workspace");
    await page.locator("#workspace").evaluate((element, d) => { element.scrollLeft += d.dx; element.scrollTop += d.dy; },
      { dx: corner.x - workspace.x - 40, dy: corner.y - workspace.y - 60 });
    await settle(page, 200);
    await hideCanvasHint(page);
    await page.locator("#bottomHud").evaluate(element => { element.style.visibility = "hidden"; });
    await fn();
    await page.locator("#bottomHud").evaluate(element => { element.style.visibility = ""; });
    await page.locator("#canvasHint").evaluate(element => { element.style.display = ""; });
    await page.locator("#zoomRange").fill(before);
    await page.locator("#zoomRange").dispatchEvent("input");
    await page.locator("#workspace").evaluate(element => { element.scrollLeft = 0; element.scrollTop = 0; });
    await settle(page, 200);
  };
  const label = (box, text, color, where = "below", extra = {}) => {
    const x = where === "left" ? box.x - 12 : where === "right" ? box.x + box.width + 12 : box.x;
    const y = where === "above" ? box.y - 36 : where === "below" ? box.y + box.height + 6 : box.y;
    return { x, y, text, color, solid: true, fontSize: 15, ...extra };
  };

  // ---- 手順1: テンプレートからラダーページを作る ------------------------------------
  await page.locator("#templateMenu").scrollIntoViewIfNeeded();
  await page.selectOption("#templateMenu", { label: "設備ラダー" });
  await page.waitForSelector("#ladBuildBtn");
  await settle(page, 400);
  {
    const select = await boxOf(page, "#templateMenu");
    const caption = await boxOf(page, 'label[for="templateMenu"]');
    const menu = pad({ x: select.x, y: caption.y, width: select.width, height: select.y + select.height - caption.y });
    const build = pad(await boxOf(page, "#ladBuildBtn"));
    await addBadges(page, "tutorialStep1", [
      { box: menu, color: RED },
      { x: menu.x - 238, y: menu.y + menu.height / 2 - 14, text: "① ここで「設備ラダー」", color: RED, solid: true, fontSize: 16 },
      { box: build, color: BLUE },
      label(build, "② 既定値のまま押す", BLUE, "below", { fontSize: 16 })
    ]);
    await settle(page);
    await shot(page, "115-tutorial-template.png");
    await removeBadges(page, "tutorialStep1");
  }
  await page.click("#ladBuildBtn");
  await page.locator("#dialogBackdrop").waitFor({ state: "hidden" });
  await settle(page, 300);

  // 最初からある空ページ P1 を消す（タブで P1 を選び、右パネルの「削除」）。
  await page.locator("#tabbar").getByText("P1", { exact: true }).click();
  await settle(page, 300);
  {
    const tab = pad(await boxOf(page, '#tabbar .page-tab:has-text("P1")'));
    const del = pad(await boxOf(page, "#deletePageBtn"));
    await addBadges(page, "tutorialStep1b", [
      { box: tab, color: ORANGE },
      label(tab, "③ 「P1」タブをクリック", ORANGE, "below", { fontSize: 16 }),
      { box: del, color: GREEN },
      { x: del.x - 200, y: del.y + del.height + 8, text: "④ 「削除」を押す", color: GREEN, solid: true, fontSize: 16 }
    ]);
    await settle(page);
    await shot(page, "116-tutorial-delete-p1.png");
    await removeBadges(page, "tutorialStep1b");
  }
  await page.click("#deletePageBtn");
  await settle(page, 300);
  await page.selectOption("#frameVariant", { label: "ラダー: 行番号+機器符号表" });
  await settle(page, 400);
  {
    const frame = pad(await boxOf(page, "#frameVariant"));
    const rows = await mmBox(17.5, ROW(0) - 4, 29, ROW(20) + 4);
    const rowsNote = await canvasPoint(page, 36, ROW(8));
    const left = await mmBox(28, 18, 37, 40);
    const right = await mmBox(143, 18, 152, 40);
    await addBadges(page, "tutorialStep1c", [
      { box: frame, color: PURPLE },
      { x: frame.x - 300, y: frame.y + 4, text: "⑤「ラダー: 行番号+機器符号表」", color: PURPLE, solid: true, fontSize: 16 },
      { box: rows, color: RED },
      { x: rowsNote.x, y: rowsNote.y - 12, text: "← 行番号 00〜20（行ピッチ 9.5mm）", color: RED, fontSize: 14 },
      { box: left, color: BLUE },
      label(left, "左レール P1", BLUE, "right", { solid: false, fontSize: 14 }),
      { box: right, color: BLUE },
      { x: right.x - 112, y: right.y + 4, text: "右レール N1", color: BLUE, fontSize: 14 }
    ]);
    await settle(page);
    await shot(page, "117-tutorial-ladder-frame.png");
    await removeBadges(page, "tutorialStep1c");
  }

  // ---- 手順2: 押しボタンとコイルを行02へ置く -------------------------------------
  await dragPart("接点・スイッチ", "押しボタン", 45, ROW(2));
  await dragPart("コイル・表示", "コイル", 135, ROW(2));
  {
    await tile("コイル・表示", "コイル").scrollIntoViewIfNeeded();
    await settle(page, 200);
    const coilTile = pad(await tile("コイル・表示", "コイル").boundingBox(), 2);
    const pb = await mmBox(36, ROW(2) - 6, 54, ROW(2) + 4);
    const coil = await mmBox(126, ROW(2) - 6, 144, ROW(2) + 4);
    await addBadges(page, "tutorialStep2", [
      { box: pb, color: RED },
      { x: pb.x, y: pb.y + pb.height + 8, text: "① 押しボタンを行02の左寄りへ", color: RED, solid: true, fontSize: 15 },
      { box: coilTile, color: BLUE },
      label(coilTile, "② ここから", BLUE, "below", { fontSize: 15 }),
      { box: coil, color: BLUE },
      { x: coil.x - 140, y: coil.y + coil.height + 48, text: "② コイルを行02の右寄りへ", color: BLUE, solid: true, fontSize: 15 }
    ]);
    await settle(page);
    await shot(page, "118-tutorial-place-parts.png");
    await removeBadges(page, "tutorialStep2");
  }

  // ---- 手順3: 1行目を配線（1本ごとに W） -----------------------------------------
  // 直前に置いたコイルは選択されたまま。本文どおり、そのまま W を押してレールから引く。
  let [pbL, pbR] = await pins("pushButton");
  let [coL, coR] = await pins("coil");
  await wire([32.5, pbL[1]], pbL);
  await wire(pbR, coL);
  await wire(coR, [147.5, coR[1]]);

  // 確認: 押しボタンを少し動かすと配線がついてくる → Ctrl+Z で戻す（撮影はしない）。
  {
    const grab = await canvasPoint(page, (pbL[0] + pbR[0]) / 2, pbL[1]);
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x, grab.y + 25, { steps: 8 });
    await page.mouse.up();
    await settle(page, 160);
    await page.keyboard.press("Control+z");
    await settle(page, 200);
  }
  await deselect();
  await withZoom(6, 20, ROW(0) - 12, async () => {
    const mid1 = await canvasPoint(page, (32.5 + pbL[0]) / 2, pbL[1]);
    const mid2 = await canvasPoint(page, (pbR[0] + coL[0]) / 2, pbR[1]);
    const mid3 = await canvasPoint(page, (coR[0] + 147.5) / 2, coR[1]);
    const note = await canvasPoint(page, 60, ROW(3) + 2);
    await addBadges(page, "tutorialStep3", [
      { x: mid1.x - 16, y: mid1.y + 10, text: "1", color: RED, solid: true, round: true, fontSize: 16, padding: "3px 10px" },
      { x: mid2.x - 16, y: mid2.y + 10, text: "2", color: BLUE, solid: true, round: true, fontSize: 16, padding: "3px 10px" },
      { x: mid3.x - 16, y: mid3.y + 10, text: "3", color: ORANGE, solid: true, round: true, fontSize: 16, padding: "3px 10px" },
      { x: note.x, y: note.y, text: "1本引くたびに W を押してから、次の1本をドラッグします\n1 左レール → 押しボタン左端子\n2 押しボタン右端子 → コイル左端子\n3 コイル右端子 → 右レール", color: GREEN, fontSize: 15 }
    ]);
    await settle(page);
    await shot(page, "119-tutorial-wiring.png", { clip: await mmBox(20, ROW(0) - 12, 160, ROW(4) + 10) });
    await removeBadges(page, "tutorialStep3");
  });

  // ---- 手順4: 2行目（a接点とランプ）を置いて配線 -----------------------------------
  await dragPart("接点・スイッチ", "a接点", 45, ROW(4));
  await dragPart("コイル・表示", "ランプ", 135, ROW(4));
  const [caL, caR] = await pins("contactNO");
  const [plL, plR] = await pins("lamp");
  await wire([32.5, caL[1]], caL);
  await wire(caR, plL);
  await wire(plR, [147.5, plR[1]]);

  // ---- 手順5: タグ入力 ----------------------------------------------------------
  await setTag("pushButton", "PB1");
  {
    // 押しボタンを選択してタグを入れた直後の画面。
    const [a, b] = await pins("pushButton");
    const part = await mmBox(a[0] - 3, a[1] - 7, b[0] + 3, a[1] + 4);
    const tab = pad(await boxOf(page, "#inspectorTabComponent"), 2);
    const tagInput = pad(await boxOf(page, '#selectionPanel [data-bind="tag"]'));
    await addBadges(page, "tutorialStep5", [
      { box: part, color: RED },
      label(part, "① 部品をクリック", RED, "below", { fontSize: 15 }),
      { box: tab, color: BLUE },
      { x: tab.x - 30, y: tab.y + tab.height + 8, text: "② 選択部品タブ", color: BLUE, solid: true, fontSize: 15 },
      { box: tagInput, color: ORANGE },
      { x: tagInput.x - 300, y: tagInput.y + 4, text: "③ 電気属性の「タグ」に入力", color: ORANGE, solid: true, fontSize: 15 }
    ]);
    await settle(page);
    await shot(page, "120-tutorial-tag-input.png");
    await removeBadges(page, "tutorialStep5");
  }
  await setTag("coil", "CR1");
  await setTag("contactNO", "CR1");
  await setTag("lamp", "PL1");
  await deselect();
  await withZoom(6, 20, ROW(0) - 12, async () => {
    const [a] = await pins("contactNO");
    const [c1, c2] = await pins("coil");
    const ref = await mmBox(a[0] + 0.5, a[1] + 2, a[0] + 9.5, a[1] + 6.5);
    const coil = await mmBox(c1[0] - 1, c1[1] - 7, c2[0] + 1, c1[1] + 4);
    const refNote = await canvasPoint(page, a[0] + 12, a[1] + 2);
    await addBadges(page, "tutorialStep5b", [
      { box: coil, color: BLUE },
      { x: coil.x - 236, y: coil.y - 4, text: "親コイル CR1（1頁 行02）", color: BLUE, solid: true, fontSize: 15 },
      { box: ref, color: RED },
      { x: refNote.x, y: refNote.y, text: "102 = 親コイル CR1 の位置（1頁の行02）", color: RED, solid: true, fontSize: 15 }
    ]);
    await settle(page);
    await shot(page, "121-tutorial-cross-reference.png", { clip: await mmBox(20, ROW(0) - 12, 160, ROW(5) + 5) });
    await removeBadges(page, "tutorialStep5b");
  });

  // ---- 手順6: 線番採番（確認3回は既定どおり OK / 開始番号 1） ------------------------
  await page.locator("#autoWireBtn").scrollIntoViewIfNeeded();
  await page.click("#autoWireBtn");
  await settle(page, 300);
  {
    const button = pad(await boxOf(page, "#autoWireBtn"));
    const area = await mmBox(30, ROW(2) - 7, 150, ROW(4) + 4);
    await addBadges(page, "tutorialStep6", [
      { box: button, color: RED },
      label(button, "① 「線番採番」を押す\n（確認3回はすべて OK）", RED, "below", { fontSize: 15 }),
      { box: area, color: BLUE },
      label(area, "② 各配線に 1-01、1-02… が付く", BLUE, "below", { fontSize: 15 })
    ]);
    await settle(page);
    await shot(page, "122-tutorial-wire-numbers.png");
    await removeBadges(page, "tutorialStep6");
  }

  // 完成図（図26-1）。手順どおりに作った結果を拡大して撮る。
  await withZoom(6, 20, ROW(0) - 12, async () => {
    await shot(page, "05-ladder-circuit.png", { clip: await mmBox(20, ROW(0) - 12, 160, ROW(5) + 5) });
  });

  // ---- 手順7: 監査 --------------------------------------------------------------
  await page.locator("#auditBtn").scrollIntoViewIfNeeded();
  await page.click("#auditBtn");
  await page.waitForSelector("#dialogBackdrop:not(.hidden)");
  await settle(page, 400);
  {
    const button = pad(await boxOf(page, "#auditBtn"));
    const result = pad(await page.locator("#dialogBody p", { hasText: "検出された問題はありません" }).boundingBox());
    await addBadges(page, "tutorialStep7", [
      { box: button, color: RED },
      label(button, "① 「監査」を押す", RED, "below", { fontSize: 15 }),
      { box: result, color: GREEN },
      label(result, "② この表示なら合格", GREEN, "below", { fontSize: 15 })
    ]);
    await settle(page);
    await shot(page, "123-tutorial-audit.png");
    await removeBadges(page, "tutorialStep7");
  }
  await page.click("#dialogClose");
  await settle(page, 200);

  // ---- 手順8: 保存と PDF 印刷（上部ツールバー） --------------------------------------
  {
    const header = await boxOf(page, "header.topbar");
    const save = pad(await boxOf(page, "#saveBtn"), 3);
    const print = pad(await boxOf(page, "#printBtn"), 3);
    await addBadges(page, "tutorialStep8", [
      { box: save, color: RED },
      { x: save.x - 6, y: save.y + save.height + 6, text: "① 保存（JSON）", color: RED, solid: true, fontSize: 15 },
      { box: print, color: BLUE },
      { x: print.x - 6, y: print.y + print.height + 6, text: "② PDF印刷", color: BLUE, solid: true, fontSize: 15 }
    ]);
    await settle(page);
    await shot(page, "124-tutorial-save-print.png", { clip: { x: header.x, y: header.y, width: Math.min(header.width, 1000), height: header.height + 44 } });
    await removeBadges(page, "tutorialStep8");
  }
  await context.close();
});
