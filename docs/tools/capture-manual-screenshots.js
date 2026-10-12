// 取扱説明書（docs/manual.md）の画面写真を、現在の index.html から撮り直すスクリプト。
//
// 使い方（リポジトリのルートで実行）:
//   node docs/tools/capture-manual-screenshots.js            … 全画像を撮り直す
//   node docs/tools/capture-manual-screenshots.js 05 tutorial … ファイル名に「05」「tutorial」を含む画像だけ
//
// 出力先: docs/images/manual/（環境変数 MANUAL_SHOT_DIR で変更可。差分確認用に別フォルダへ出すときに使う）
// 必要環境: npm install 済み（@playwright/test）と、npm run test:install で入る Chromium。
//
// 画面の配置が変わっても撮り直せるよう、座標は固定値ではなく要素の位置（boundingBox）から求める。
// 図面上の位置は mm 指定で、キャンバスの表示倍率から画面座標へ換算する。
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("@playwright/test");

const ROOT = path.resolve(__dirname, "..", "..");
const INDEX_URL = pathToFileURL(path.join(ROOT, "index.html")).href;
const OUT = process.env.MANUAL_SHOT_DIR ? path.resolve(process.env.MANUAL_SHOT_DIR) : path.join(ROOT, "docs", "images", "manual");
const FILTERS = process.argv.slice(2);
const VIEWPORT = { width: 1600, height: 1000 };

fs.mkdirSync(OUT, { recursive: true });

async function settle(page, ms = 260) {
  await page.waitForTimeout(ms);
}

async function freshPage(browser, viewport = VIEWPORT) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: "ja-JP" });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  // 確認ダイアログ（線番採番の開始番号など）は既定値で受け入れる。
  page.on("dialog", dialog => dialog.type() === "prompt" ? dialog.accept(dialog.defaultValue() || "1") : dialog.accept());
  await page.goto(INDEX_URL);
  await page.waitForSelector("#canvas");
  await settle(page, 180);
  return { context, page };
}

async function shot(page, name, options = {}) {
  await page.screenshot({ path: path.join(OUT, name), animations: "disabled", caret: "hide", ...options });
  console.log(name);
}

async function shotDialog(page, name) {
  await page.waitForSelector("#dialogBackdrop:not(.hidden)");
  await settle(page);
  await page.locator(".dialog").screenshot({ path: path.join(OUT, name), animations: "disabled", caret: "hide" });
  console.log(name);
}

async function shotElement(locator, name) {
  await locator.screenshot({ path: path.join(OUT, name), animations: "disabled", caret: "hide" });
  console.log(name);
}

async function closeDialog(page) {
  if (await page.locator("#dialogBackdrop:not(.hidden)").count()) {
    await page.click("#dialogClose");
    await settle(page, 160);
  }
}

async function openAction(page, value) {
  await page.selectOption("#actionMenu", value);
  await page.waitForSelector("#dialogBackdrop:not(.hidden)");
  await settle(page);
}

async function hideCanvasHint(page) {
  await page.locator("#canvasHint").evaluate(element => { element.style.display = "none"; });
}

// 右パネルを「ページ設定」タブへ切り替えてから入力する（部品選択中は選択部品タブが前面になるため）。
async function setPageField(page, selector, value) {
  await page.click("#inspectorTabPage");
  await page.fill(selector, value);
  // 利用者と同じく入力欄から抜けて確定する（change だけ送ると、後のクリックで再確定が走る）。
  await page.locator(selector).evaluate(element => element.blur());
  await settle(page, 80);
  // 複数ページで表題欄を変えると「他のページへ反映しますか？」が出る。説明用の撮影では編集ページだけに残す。
  for (let i = 0; i < 10; i += 1) {
    if (await page.locator("#dialogBackdrop:not(.hidden) #titlePropOnlyBtn").count()) {
      await page.click("#titlePropOnlyBtn");
      await settle(page, 80);
      break;
    }
    await settle(page, 100);
  }
}

// 図面座標(mm) → 画面座標(px)。用紙の幅・高さはキャンバスの viewBox から読む。
async function canvasPoint(page, xMm, yMm) {
  const box = await page.locator("#canvas").boundingBox();
  const viewBox = await page.locator("#canvas").evaluate(svg => {
    const { x, y, width, height } = svg.viewBox.baseVal;
    return { x, y, width, height };
  });
  return {
    x: box.x + (xMm - viewBox.x) * box.width / viewBox.width,
    y: box.y + (yMm - viewBox.y) * box.height / viewBox.height
  };
}

// 図面座標(mm)の矩形 → 画面の clip。
async function canvasClip(page, x1, y1, x2, y2) {
  const a = await canvasPoint(page, x1, y1);
  const b = await canvasPoint(page, x2, y2);
  return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
}

async function drawWire(page, x1, y1, x2, y2, bendCycle = 0) {
  await page.click('.tool-actions [data-tool="wire"]');
  const start = await canvasPoint(page, x1, y1);
  const end = await canvasPoint(page, x2, y2);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 0; i < bendCycle; i += 1) await page.keyboard.press("Space");
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await settle(page, 120);
}

async function clickEmpty(page, xMm, yMm) {
  await page.click('.tool-actions [data-tool="select"]');
  const point = await canvasPoint(page, xMm, yMm);
  await page.mouse.click(point.x, point.y);
  await page.keyboard.press("Escape");
  await settle(page, 120);
}

// パレットから部品を選び、図面上の指定位置(mm)をクリックして置く。ラベル・タグ・デザインも設定する。
async function placeComponent(page, type, xMm, yMm, { label, tag, variant } = {}) {
  await page.fill("#paletteFilter", type);
  const item = page.locator(`#paletteGrid .palette-item[data-type="${type}"]`);
  const count = await item.count();
  if (!count) throw new Error(`palette item is unavailable: ${type}`);
  // 2回目以降は「最近使用」と通常パレットに同じdata-typeが並ぶ。通常パレット側（末尾）を使う。
  await item.nth(count - 1).click();
  const point = await canvasPoint(page, xMm, yMm);
  await page.mouse.click(point.x, point.y);
  await settle(page, 100);
  const setField = async (bind, value) => {
    if (value === undefined) return;
    const input = page.locator(`#selectionPanel [data-bind="${bind}"]`);
    if (!await input.count()) return;
    await input.first().fill(value);
    await input.first().dispatchEvent("change");
    await settle(page, 60);
  };
  await setField("label", label);
  await setField("tag", tag);
  if (variant) {
    const select = page.locator('#selectionPanel [data-bind="symbolVariant"]');
    if (!await select.count()) throw new Error(`symbol variant is unavailable: ${type}/${variant}`);
    await select.selectOption(variant);
    await settle(page, 80);
  }
  await page.fill("#paletteFilter", "");
}

// 画面上へ説明用のバッジ（番号・注記）を重ねる。図だけで操作箇所が分かるようにするための注記。
async function addBadges(page, id, badges) {
  await page.evaluate(({ id, badges }) => {
    document.querySelector(`#${id}`)?.remove();
    const layer = document.createElement("div");
    layer.id = id;
    Object.assign(layer.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "99999", fontFamily: '"Yu Gothic UI", Meiryo, sans-serif' });
    badges.forEach(item => {
      if (item.box) {
        const frame = document.createElement("div");
        Object.assign(frame.style, {
          position: "absolute", left: `${item.box.x}px`, top: `${item.box.y}px`, width: `${item.box.width}px`, height: `${item.box.height}px`,
          border: `3px solid ${item.color || "#d1495b"}`, borderRadius: "6px", boxSizing: "border-box", background: item.fill || "transparent"
        });
        layer.appendChild(frame);
      }
      if (!item.text) return;
      const badge = document.createElement("div");
      badge.textContent = item.text;
      Object.assign(badge.style, {
        position: "absolute", left: `${item.x}px`, top: `${item.y}px`,
        padding: item.padding || "5px 10px", borderRadius: item.round ? "999px" : "7px",
        background: item.solid ? (item.color || "#d1495b") : "rgba(255,255,255,.96)",
        border: `2px solid ${item.color || "#d1495b"}`, color: item.solid ? "white" : "#17252c",
        fontSize: `${item.fontSize || 15}px`, fontWeight: "700", lineHeight: "1.25", whiteSpace: "pre-line",
        boxShadow: "0 2px 6px rgba(0,0,0,.2)", transform: item.center ? "translateX(-50%)" : "none"
      });
      layer.appendChild(badge);
    });
    document.body.appendChild(layer);
  }, { id, badges });
}

async function removeBadges(page, id) {
  await page.evaluate(id => document.querySelector(`#${id}`)?.remove(), id);
}

async function boxOf(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`element is not visible: ${selector}`);
  return box;
}

async function addLadderPage(page, { rails = "P1", right = "N1", note = "(DC24V)" } = {}) {
  await page.selectOption("#templateMenu", "facilityLadder");
  await page.waitForSelector("#ladBuildBtn");
  await settle(page);
  await page.fill("#ladRails", rails);
  await page.fill("#ladRight", right);
  await page.fill("#ladNote", note);
  await page.click("#ladBuildBtn");
  await page.locator("#dialogBackdrop").waitFor({ state: "hidden" });
  await settle(page);
}

// 最初の空ページ(P1)を消して、テンプレートで追加したページだけにする。
async function deleteFirstPage(page) {
  const tabs = page.locator("#tabbar .page-tab");
  if (await tabs.count() < 2) return;
  await tabs.nth(0).click();
  await page.click("#inspectorTabPage");
  await page.click("#deletePageBtn");
  await settle(page);
}

// 自動処理の説明に使う共通サンプル（電源投入回路＋ランプ行）。
async function createSampleCircuit(page) {
  await addLadderPage(page);
  await openAction(page, "powerOn");
  await page.fill("#poRow", "1");
  await page.fill("#poKs", "SS1");
  await page.fill("#poPb", "PB1");
  await page.fill("#poCr", "CR1,CR2");
  await page.click("#poBuildBtn");
  await settle(page);
  await openAction(page, "rungCircuit");
  await page.fill("#rcRow", "7");
  await page.fill("#rcCount", "2");
  await page.fill("#rcContacts", "1");
  await page.selectOption("#rcEnd", "lamp");
  await page.click("#rcBuildBtn");
  await settle(page);
  await page.click("#selectOnlyBtn");
  await page.click("#autoWireBtn");
  await settle(page);
  await setPageField(page, "#pageName", "リレー回路");
  await setPageField(page, "#drawingTitle", "リレー制御回路");
}

// ---------------------------------------------------------------- 撮影ジョブ
// files: このジョブが出力する画像（引数フィルタの照合に使う）
const JOBS = [];
const job = (files, run) => JOBS.push({ files, run });

job(["01-startup.png", "02-palette.png", "03-page-settings.png", "26-screen-layout.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await shot(page, "01-startup.png");
  const palette = await boxOf(page, "aside.palette");
  await shot(page, "02-palette.png", { clip: { x: palette.x, y: palette.y, width: palette.width, height: 760 } });
  // 領域名のバッジは、各領域のボタン・見出しを隠さない空き場所へ置く(place: 領域の箱から位置を決める)。
  const regions = [
    ["header.topbar", "1  上部ツールバー", "#d1495b", box => ({ x: box.x + box.width - 210, y: box.y + 10 })],
    ["#tabbar", "2  ページタブ", "#5367d5", box => ({ x: box.x + box.width / 2, y: box.y + 4 })],
    ["#quickRibbon", "3  クイック作図リボン", "#b45309", box => ({ x: box.x + box.width - 260, y: box.y + 4 })],
    ["aside.palette", "4  左パネル", "#d97706", box => ({ x: box.x + 112, y: box.y + 12 })],
    ["#workspace", "5  中央キャンバス", "#0f8f7c", box => ({ x: box.x + 18, y: box.y + 64 })],
    ["aside.inspector", "6  右パネル", "#7c3aed", box => ({ x: box.x + 150, y: box.y + 56 })]
  ];
  const badges = [];
  for (const [selector, text, color, place] of regions) {
    const box = await boxOf(page, selector);
    const inset = { x: box.x + 2, y: box.y + 2, width: box.width - 4, height: box.height - 4 };
    badges.push({ box: inset, color, fill: `${color}0d` });
    badges.push({ ...place(box), text, color, solid: true, round: true, fontSize: 17, padding: "4px 14px" });
  }
  // 中央キャンバスの中にある操作要素(パネル開閉ボタン・下部HUD)にも小さな注記を付ける。
  const leftToggle = await boxOf(page, "#toggleLeftPanel");
  badges.push({ x: leftToggle.x + leftToggle.width + 8, y: leftToggle.y + 6, text: "‹ › パネルの開閉", color: "#0f8f7c", fontSize: 13, padding: "3px 8px" });
  const hud = await boxOf(page, "#bottomHud");
  badges.push({ x: hud.x - 112, y: hud.y + 1, text: "下部HUD →", color: "#0f8f7c", fontSize: 13, padding: "3px 8px" });
  await addBadges(page, "manualScreenRegions", badges);
  await settle(page);
  await shot(page, "26-screen-layout.png");
  await removeBadges(page, "manualScreenRegions");
  // 右パネルのページ設定タブ全体を、「表題欄の詳細」を開いた状態で撮る。縦に長すぎて印刷で縮むため、
  // 「図名」の手前で上下に分け、左右2列に並べ替えた1枚の画像にする。
  await page.setViewportSize({ width: VIEWPORT.width, height: 1400 });
  await page.locator("#inspectorPageTab summary", { hasText: "表題欄の詳細" }).click();
  await settle(page);
  const tabs = await boxOf(page, "#inspectorTabs");
  const pageTab = await boxOf(page, "#inspectorPageTab");
  const inspector = await boxOf(page, "aside.inspector");
  const split = (await boxOf(page, 'label[for="drawingTitle"]')).y - 4;
  const top = tabs.y - 8;
  const bottom = pageTab.y + pageTab.height + 8;
  const upper = await page.screenshot({ clip: { x: inspector.x, y: top, width: inspector.width, height: split - top }, animations: "disabled", caret: "hide" });
  const lower = await page.screenshot({ clip: { x: inspector.x, y: split, width: inspector.width, height: bottom - split }, animations: "disabled", caret: "hide" });
  const sheet = await context.newPage();
  await sheet.setContent(`<body style="margin:0"><div id="sheet" style="display:inline-flex;gap:14px;align-items:flex-start;padding:6px;background:#e6ebef">
    <img src="data:image/png;base64,${upper.toString("base64")}"><img src="data:image/png;base64,${lower.toString("base64")}"></div></body>`);
  await shotElement(sheet.locator("#sheet"), "03-page-settings.png");
  await context.close();
});

job(["04-facility-ladder-dialog.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await page.selectOption("#templateMenu", "facilityLadder");
  await shotDialog(page, "04-facility-ladder-dialog.png");
  await context.close();
});

job(["27-wire-shapes.png"], async browser => {
  const { context, page } = await freshPage(browser);
  const specs = [
    { y: 62, cycle: 0, label: "① L字（縦→横）", color: "#d1495b" },
    { y: 105, cycle: 1, label: "② L字（横→縦）", color: "#5367d5" },
    { y: 148, cycle: 2, label: "③ コの字（横→縦→横）", color: "#d97706" },
    { y: 191, cycle: 3, label: "④ コの字（縦→横→縦）", color: "#0f8f7c" }
  ];
  for (const spec of specs) await drawWire(page, 57.5, spec.y, 137.5, spec.y + 20, spec.cycle);
  await clickEmpty(page, 185, 245);
  await hideCanvasHint(page);
  const badges = [];
  for (const spec of specs) {
    const p = await canvasPoint(page, 145, spec.y - 6);
    badges.push({ x: p.x, y: p.y, text: spec.label, color: spec.color });
  }
  await addBadges(page, "manualWireShapeLabels", badges);
  await settle(page);
  await shot(page, "27-wire-shapes.png", { clip: await canvasClip(page, 0, 35, 210, 240) });
  await context.close();
});

job(["29-page-view-modes.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await setPageField(page, "#pageName", "概要");
  await addLadderPage(page);
  await setPageField(page, "#pageName", "ラダー");
  await page.selectOption("#templateMenu", "terminalSheet");
  await settle(page);
  await setPageField(page, "#pageName", "端子接続");
  await page.locator("#zoomRange").fill("1.2");
  await page.locator("#zoomRange").dispatchEvent("input");
  await page.selectOption("#pageViewMode", "row");
  await page.waitForSelector(".page-slot");
  await page.locator(".page-slot").nth(1).locator(".page-slot-head").click();
  await page.locator("#pageViewMode").scrollIntoViewIfNeeded();
  await settle(page, 300);
  await shot(page, "29-page-view-modes.png");
  await context.close();
});

// テンプレートの設定ダイアログと生成ページ。
const templateShots = [
  { template: "acPower", button: "#acBuildBtn", dialog: "33-ac-power-dialog.png", page: "34-ac-power-page.png" },
  { template: "acPower", button: "#acBuildBtn", page: "40-ac-power-100v-page.png", before: async page => page.selectOption("#acVolt", "100") },
  { template: "acMotor", button: "#acMotorBuildBtn", dialog: "41-ac-motor-dialog.png", page: "42-ac-motor-servo-2axis-page.png", tall: true },
  { template: "acMotor", button: "#acMotorBuildBtn", page: "43-ac-motor-servo-1axis-page.png", before: async page => page.selectOption("#acAxes", "1") },
  { template: "acMotor", button: "#acMotorBuildBtn", page: "44-ac-motor-inverter-page.png", before: async page => page.selectOption("#acDrive", "inverter") },
  { template: "dcPower", button: "#dcBuildBtn", dialog: "45-dc-power-dialog.png", page: "46-dc-power-page.png" },
  { template: "plcPower", button: "#plcpBuildBtn", dialog: "47-plc-power-dialog.png", page: "48-plc-power-page.png" },
  { template: "safetyRelay", button: "#sfBuildBtn", dialog: "49-safety-relay-dialog.png", page: "50-safety-relay-page.png" }
];
// 生成ページ全体(A4縦・標準倍率)を写す。画面下の状態表示やヒントが用紙に重ならないよう隠し、
// 用紙の下端まで入るよう縦長の画面にしてからキャンバスだけを撮る。
async function shotWholePage(page, name) {
  await page.setViewportSize({ width: 1600, height: 1300 });
  await page.evaluate(() => {
    ["#canvasHint", "#bottomHud"].forEach(selector => { const element = document.querySelector(selector); if (element) element.style.display = "none"; });
    window.__edsTest?.setSelectionForTest?.([]);
  });
  await settle(page, 200);
  await shotElement(page.locator("#canvas"), name);
}

templateShots.forEach(spec => job([spec.dialog, spec.page].filter(Boolean), async browser => {
  const { context, page } = await freshPage(browser);
  if (spec.tall) await page.setViewportSize({ width: 1600, height: 1300 });
  await page.selectOption("#templateMenu", spec.template);
  await page.waitForSelector(spec.button);
  if (spec.before) await spec.before(page);
  if (spec.dialog) {
    if (spec.tall) await page.locator(".dialog").evaluate(element => { element.style.maxHeight = "none"; element.style.overflow = "visible"; });
    await shotDialog(page, spec.dialog);
  }
  if (spec.tall) await page.setViewportSize(VIEWPORT);
  await page.click(spec.button);
  await page.locator("#dialogBackdrop").waitFor({ state: "hidden" });
  await settle(page, 400);
  await shotWholePage(page, spec.page);
  await context.close();
}));

job(["35-estop-chain-dialog.png", "36-estop-chain-page.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await addLadderPage(page);
  await openAction(page, "estopChain");
  await shotDialog(page, "35-estop-chain-dialog.png");
  await page.click("#esBuildBtn");
  await page.locator("#dialogBackdrop").waitFor({ state: "hidden" });
  await settle(page, 300);
  await clickEmpty(page, 195, 267.5);
  await shotWholePage(page, "36-estop-chain-page.png");
  await context.close();
});

// テンプレートを並べて表示した一覧（2枚）。
async function templateGallery(browser, name, steps) {
  const { context, page } = await freshPage(browser);
  for (const step of steps) await step(page);
  await deleteFirstPage(page);
  await page.locator("#zoomRange").fill("0.8");
  await page.locator("#zoomRange").dispatchEvent("input");
  await page.selectOption("#pageViewMode", "row");
  await page.waitForSelector(".page-slot");
  // 並べた用紙だけを見せる(ヒント・状態表示・パネル開閉ボタンは用紙に重なるため隠す)。
  await page.evaluate(() => ["#canvasHint", "#bottomHud", "#toggleLeftPanel", "#toggleRightPanel"].forEach(selector => {
    const element = document.querySelector(selector);
    if (element) element.style.display = "none";
  }));
  await settle(page, 350);
  const workspace = await boxOf(page, "#workspace");
  await shot(page, name, { clip: { x: workspace.x, y: workspace.y, width: workspace.width, height: 340 } });
  await context.close();
}
const simpleTemplate = value => async page => { await page.selectOption("#templateMenu", value); await settle(page); };
const dialogTemplate = (value, button) => async page => {
  await page.selectOption("#templateMenu", value);
  await page.waitForSelector(button);
  await page.click(button);
  await page.locator("#dialogBackdrop").waitFor({ state: "hidden" });
  await settle(page, 300);
};
job(["37-template-grid-gallery.png"], browser => templateGallery(browser, "37-template-grid-gallery.png", [
  dialogTemplate("facilityLadder", "#ladBuildBtn"), dialogTemplate("plcInput", "#plcInBuildBtn"),
  simpleTemplate("terminalSheet"), dialogTemplate("acPower", "#acBuildBtn")
]));
job(["38-template-grid-gallery-2.png"], browser => templateGallery(browser, "38-template-grid-gallery-2.png", [
  dialogTemplate("interlock", "#ilBuildBtn"), simpleTemplate("ladder"), simpleTemplate("index"), simpleTemplate("layout")
]));

job(["39-palette-estop-placement.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await page.fill("#paletteFilter", "非常停止");
  const item = page.locator('#paletteGrid .palette-item[data-type="pushButtonEmergency"]');
  await item.last().click();
  const point = await canvasPoint(page, 105, 70);
  await page.mouse.click(point.x, point.y);
  await settle(page);
  const labelInput = page.locator('#selectionPanel [data-bind="label"]');
  await labelInput.fill("PBE1");
  await labelInput.dispatchEvent("change");
  await page.locator('#selectionPanel [data-bind="symbolVariant"]').selectOption("standard");
  // 連続配置モードを抜け(選択は保持)、置いた記号が読める倍率で画面中央へ寄せる。
  await page.click('.tool-actions [data-tool="select"]');
  await page.locator("#zoomRange").fill("10");
  await page.locator("#zoomRange").dispatchEvent("input");
  await settle(page, 200);
  await page.locator('#canvas g[data-type="pushButton"]').first().evaluate(element => element.scrollIntoView({ block: "center", inline: "center" }));
  await page.locator('#selectionPanel [data-bind="symbolVariant"]').scrollIntoViewIfNeeded();
  await page.addStyleTag({ content: ".selection-box,.selection-handle,.point-handle{display:none!important}" });
  await settle(page, 300);
  await shot(page, "39-palette-estop-placement.png");
  await context.close();
});

// 共通サンプル回路を使う主要画面群。
job(["06-component-selection.png", "07-wire-editing.png", "08-cross-reference.png", "09-drawing-audit.png", "10-search-results.png",
  "11-title-batch.png", "12-bom.png", "13-report-table.png", "14-project-manager.png", "15-print-preview.png", "16-layer-manager.png",
  "17-wire-type-manager.png", "18-symbol-builder.png", "19-history-timeline.png", "20-context-menu.png", "25-underlay.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await createSampleCircuit(page);
  await deleteFirstPage(page);
  await clickEmpty(page, 195, 280);
  const underlaySource = path.join(OUT, ".underlay-source.png");
  await hideCanvasHint(page);
  await page.locator("#canvas").screenshot({ path: underlaySource });
  await page.locator("#canvasHint").evaluate(element => { element.style.display = ""; });

  const coil = page.locator('#canvas [data-type="coil"]').first();
  await coil.click({ force: true });
  await settle(page);
  await shot(page, "06-component-selection.png");

  await page.click('.tool-actions [data-tool="wire"]');
  const start = await canvasPoint(page, 60, 170);
  const end = await canvasPoint(page, 140, 185);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.click('.tool-actions [data-tool="select"]');
  await page.locator(".inspector").evaluate(element => { element.scrollTop = element.scrollHeight; });
  await settle(page);
  await shot(page, "07-wire-editing.png");
  await page.keyboard.press("Control+z");
  await clickEmpty(page, 195, 280);

  await openAction(page, "crossRef");
  await shotDialog(page, "08-cross-reference.png");
  await closeDialog(page);
  await page.click("#auditBtn");
  await shotDialog(page, "09-drawing-audit.png");
  await closeDialog(page);
  await page.click("#searchBtn");
  await page.fill("#searchQuery", "CR2");
  await page.click("#runSearchBtn");
  await settle(page);
  await shotDialog(page, "10-search-results.png");
  await closeDialog(page);
  await page.click("#titleBatchBtn");
  await shotDialog(page, "11-title-batch.png");
  await closeDialog(page);
  await openAction(page, "bom");
  await shotDialog(page, "12-bom.png");
  await closeDialog(page);
  await openAction(page, "insertReport");
  await shotDialog(page, "13-report-table.png");
  await closeDialog(page);
  await openAction(page, "projects");
  await page.fill("#projSaveName", "リレー回路サンプル");
  await page.click("#projSaveBtn");
  await settle(page);
  await shotDialog(page, "14-project-manager.png");
  await closeDialog(page);
  await page.click("#printPreviewBtn");
  await settle(page, 400);
  await shot(page, "15-print-preview.png");
  await closeDialog(page);
  await openAction(page, "layerManager");
  await shotDialog(page, "16-layer-manager.png");
  await closeDialog(page);
  await openAction(page, "wireTypeManager");
  await shotDialog(page, "17-wire-type-manager.png");
  await closeDialog(page);
  await openAction(page, "symbolBuilder");
  await shotDialog(page, "18-symbol-builder.png");
  await closeDialog(page);
  await openAction(page, "historyTimeline");
  await shotDialog(page, "19-history-timeline.png");
  await closeDialog(page);
  await coil.click({ button: "right", force: true });
  await page.waitForSelector("#contextMenu:not(.hidden)");
  await settle(page, 120);
  await shot(page, "20-context-menu.png");
  await page.keyboard.press("Escape");
  await context.close();

  // 権利問題のない自作回路画像を下絵にした例。
  const second = await freshPage(browser);
  await second.page.setInputFiles("#underlayInput", underlaySource);
  await second.page.waitForSelector('#canvas [data-type="underlayImage"]');
  // 挿入直後の選択を外し、利用者と同じく「下絵を選択（ロック中も可）」で選び直す(右パネルは選択部品タブになる)。
  await second.page.keyboard.press("Escape");
  await second.page.click("#inspectorTabPage");
  await second.page.selectOption("#underlayMenu", "select");
  await settle(second.page);
  await shot(second.page, "25-underlay.png");
  await second.context.close();
  fs.rmSync(underlaySource, { force: true });
});

job(["21-plc-dialog.png", "22-plc-page.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await page.selectOption("#templateMenu", "plcInput");
  await page.waitForSelector("#plcInBuildBtn");
  await page.selectOption("#plcPreset", "0");
  await settle(page);
  await shotDialog(page, "21-plc-dialog.png");
  await page.click("#plcInBuildBtn");
  await settle(page);
  await page.click("#selectOnlyBtn");
  await shot(page, "22-plc-page.png");
  await context.close();
});

job(["23-terminal-page.png", "24-terminal-editor.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await page.selectOption("#templateMenu", "terminalSheet");
  await settle(page);
  await page.click("#selectOnlyBtn");
  await shot(page, "23-terminal-page.png");
  await openAction(page, "terminalEditor");
  await shotDialog(page, "24-terminal-editor.png");
  await context.close();
});

module.exports = { JOBS, job, freshPage, shot, shotDialog, shotElement, closeDialog, openAction, settle, hideCanvasHint,
  setPageField, canvasPoint, canvasClip, drawWire, clickEmpty, placeComponent, addBadges, removeBadges, boxOf, addLadderPage, deleteFirstPage };

// 章ごとの追加撮影ジョブ(docs/tools/manual-shots/*.js)。各ファイルは上の関数を require して job() で登録する。
// 1ファイルに全章を書くと並行編集でぶつかるため、章単位のファイルに分けている。
const EXTRA_JOB_DIR = path.join(__dirname, "manual-shots");
if (fs.existsSync(EXTRA_JOB_DIR)) {
  fs.readdirSync(EXTRA_JOB_DIR).filter(name => name.endsWith(".js")).sort()
    .forEach(name => require(path.join(EXTRA_JOB_DIR, name)));
}

if (require.main === module) {
  (async () => {
    const selected = JOBS.filter(item => !FILTERS.length || item.files.some(file => FILTERS.some(filter => file.includes(filter))));
    if (!selected.length) throw new Error(`no screenshot matches: ${FILTERS.join(", ")}`);
    const browser = await chromium.launch({ headless: true });
    let failed = 0;
    try {
      for (const item of selected) {
        try {
          await item.run(browser);
        } catch (error) {
          failed += 1;
          console.error(`FAILED ${item.files.join(", ")}\n${error.stack || error}`);
        }
      }
    } finally {
      await browser.close();
    }
    if (failed) process.exitCode = 1;
  })();
}
