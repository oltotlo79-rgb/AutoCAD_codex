// 9章「配線作図」・10章「端子と端子台」・11章「PLC/I-O と機器箱」の撮影ジョブ。
// 撮り直し例: node docs/tools/capture-manual-screenshots.js 95 96 53
const { job, freshPage, shot, settle, canvasPoint, canvasClip, drawWire, clickEmpty, placeComponent,
  addBadges, openAction, shotDialog, hideCanvasHint, deleteFirstPage } = require("../capture-manual-screenshots.js");

// 表示倍率を変え、指定した図面位置(mm)をキャンバスの中央へスクロールする。
async function zoomAt(page, zoom, xMm, yMm) {
  await page.evaluate(value => {
    const range = document.querySelector("#zoomRange");
    range.value = String(value);
    range.dispatchEvent(new Event("input", { bubbles: true }));
  }, zoom);
  await settle(page, 200);
  const point = await canvasPoint(page, xMm, yMm);
  await page.evaluate(([x, y]) => {
    const workspace = document.querySelector("#workspace");
    const rect = workspace.getBoundingClientRect();
    workspace.scrollLeft += x - (rect.left + rect.width / 2);
    workspace.scrollTop += y - (rect.top + rect.height / 2);
  }, [point.x, point.y]);
  await settle(page, 200);
}

// 右パネル(選択部品タブ)の入力欄へ値を入れて確定する。
async function setField(page, bind, value) {
  const input = page.locator(`#selectionPanel [data-bind="${bind}"]`).first();
  await input.scrollIntoViewIfNeeded();
  await input.fill(String(value));
  await input.evaluate(element => element.blur());
  await settle(page, 120);
}

// 右パネルを、指定した欄が上端付近に来る位置までスクロールする。
async function scrollInspectorTo(page, selector, offset = 12) {
  await page.evaluate(([selector, offset]) => {
    const inspector = document.querySelector(".inspector");
    const target = document.querySelector(selector);
    if (!inspector || !target) return;
    const tabs = document.querySelector("#inspectorTabs");
    const tabHeight = tabs ? tabs.getBoundingClientRect().height : 0;
    inspector.scrollTop += target.getBoundingClientRect().top - inspector.getBoundingClientRect().top - tabHeight - offset;
  }, [selector, offset]);
  await settle(page, 160);
}

// パレットから置いた部品(最後に追加された要素)のIDと接続点。
async function lastElement(page) {
  return page.evaluate(() => {
    const T = window.__edsTest;
    const current = T.state.pages.find(item => item.id === T.state.activePageId);
    const element = current.elements[current.elements.length - 1];
    return { id: element.id, anchors: T.elementConnectionAnchors(element) };
  });
}

async function selectById(page, id) {
  await page.evaluate(value => window.__edsTest.selectElement(value), id);
  await settle(page, 160);
}

async function importCsv(page, inputSelector, name, text) {
  const before = await page.locator("#tabbar .page-tab").count();
  await page.setInputFiles(inputSelector, { name, mimeType: "text/csv", buffer: Buffer.from(text, "utf8") });
  await page.waitForFunction(count => document.querySelectorAll("#tabbar .page-tab").length > count, before);
  await settle(page);
}

// 図9-1: 部品を選択してから配線ツールを選ぶと、その部品の接続点だけが緑の小円で出る。
job(["95-wire-from-symbol.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await placeComponent(page, "pushButton", 60, 60, { tag: "PB1" });
  await placeComponent(page, "coil", 120, 60, { tag: "CR1" });
  await clickEmpty(page, 100, 150);
  await zoomAt(page, 9, 90, 80);
  const pb = await page.evaluate(() => {
    const T = window.__edsTest;
    return T.state.pages.find(item => item.id === T.state.activePageId).elements.find(item => item.type === "pushButton").id;
  });
  await selectById(page, pb);
  await page.keyboard.press("w");
  await settle(page);
  const choices = await page.locator("#canvas [data-connection-x]").evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }));
  if (choices.length) {
    const right = choices[choices.length - 1];
    await addBadges(page, "manualWireFromSymbol", [{ x: right.x, y: right.y + 34, text: "緑の小円からドラッグ", color: "#0f8f7c", center: true }]);
  }
  const workspace = await page.locator("#workspace").boundingBox();
  await shot(page, "95-wire-from-symbol.png", { clip: { x: workspace.x, y: workspace.y, width: workspace.width, height: 430 } });
  await context.close();
});

// 図9-4: コの字配線を選択し、形を整えるボタンが見える位置まで右パネルをスクロールした画面。
job(["58-wire-bend-edit.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await zoomAt(page, 6, 95, 75);
  await drawWire(page, 45, 55, 145, 95, 2);
  await page.click('.tool-actions [data-tool="select"]');
  const wire = await lastElement(page);
  await selectById(page, wire.id);
  await setField(page, "wireNo", "W101");
  await scrollInspectorTo(page, "#addWirePointBtn", 40);
  await shot(page, "58-wire-bend-edit.png");
  await context.close();
});

// 図9-5: T分岐の接続点・接続しない交差・交差ギャップの比較。
job(["96-wire-gap-junction.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await hideCanvasHint(page);
  await zoomAt(page, 5.5, 110, 62);
  // ① T分岐
  await drawWire(page, 25, 60, 75, 60);
  await drawWire(page, 50, 60, 50, 80);
  // ② 接続しない交差
  await drawWire(page, 85, 60, 135, 60);
  await drawWire(page, 110, 40, 110, 80);
  // ③ 交差ギャップ(横の配線へ追加)
  await drawWire(page, 145, 60, 195, 60);
  await drawWire(page, 170, 40, 170, 80);
  await clickEmpty(page, 100, 150);
  const horizontal = await page.evaluate(() => {
    const T = window.__edsTest;
    return T.state.pages.find(item => item.id === T.state.activePageId).elements
      .find(item => item.type === "wire" && item.points[0][0] === 145 && item.points[0][1] === 60).id;
  });
  await selectById(page, horizontal);
  await page.locator("#addIntersectionGapsBtn").scrollIntoViewIfNeeded();
  await page.click("#addIntersectionGapsBtn");
  await settle(page);
  // 「接続点生成」は確認(OK=全ページ)のあとすぐ実行される。
  await page.selectOption("#actionMenu", "autoJunction");
  await settle(page);
  await clickEmpty(page, 100, 150);
  const labels = [
    { x: 50, text: "① T分岐（接続点生成で黒丸）" },
    { x: 110, text: "② 交差（接続しない・黒丸なし）" },
    { x: 170, text: "③ 交差ギャップ（横線だけ途切れる）" }
  ];
  const badges = [];
  for (const item of labels) {
    const point = await canvasPoint(page, item.x, 86);
    badges.push({ x: point.x, y: point.y, text: item.text, color: "#5367d5", center: true, fontSize: 14 });
  }
  await addBadges(page, "manualGapJunction", badges);
  await settle(page);
  await shot(page, "96-wire-gap-junction.png", { clip: await canvasClip(page, 18, 32, 202, 96) });
  await context.close();
});

// 図10-1: パレットから置いた端子台(ユニット列)と右パネル。
job(["97-terminal-strip-panel.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await placeComponent(page, "terminalStrip", 70, 47.5, { label: "TB1" });
  await page.click("#selectOnlyBtn");
  const strip = await lastElement(page);
  await selectById(page, strip.id);
  await zoomAt(page, 6, 80, 165);
  await scrollInspectorTo(page, '#selectionPanel [data-bind="stripStyle"]', 30);
  // 左辺の端子記号(14番)と最下段のCOMポートの記号を注記する。
  const anchors = await page.evaluate(id => {
    const T = window.__edsTest;
    const element = T.state.pages.find(item => item.id === T.state.activePageId).elements.find(item => item.id === id);
    return T.elementConnectionAnchors(element);
  }, strip.id);
  const sorted = anchors.slice().sort((a, b) => a.y - b.y);
  const com = sorted[sorted.length - 1];
  const mark = sorted[sorted.length - 4];
  const markPoint = await canvasPoint(page, mark.x, mark.y);
  const comPoint = await canvasPoint(page, com.x, com.y);
  await addBadges(page, "manualStripMarks", [
    { x: markPoint.x - 250, y: markPoint.y - 16, text: "端子記号（配線の接続点）→", color: "#d1495b" },
    { x: comPoint.x + 24, y: comPoint.y - 16, text: "← COMポートの端子記号（右）", color: "#5367d5" }
  ]);
  await settle(page);
  await shot(page, "97-terminal-strip-panel.png");
  await context.close();
});

// 図10-2: 端子箱の寸法・箱内文字・引き出し線。
job(["53-terminal-box-settings.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await placeComponent(page, "terminalBox", 75, 60);
  await page.click("#selectOnlyBtn");
  const box = await lastElement(page);
  await selectById(page, box.id);
  await setField(page, "rows", 3);
  await setField(page, "boxCellHeight", 8);
  await setField(page, "w", 30);
  await setField(page, "boxStubLength", 4);
  await setField(page, "boxLabels", "R\nS\nT");
  await zoomAt(page, 9, 80, 66);
  await scrollInspectorTo(page, '#selectionPanel [data-bind="rows"]', 40);
  await shot(page, "53-terminal-box-settings.png");
  await context.close();
});

// 図10-5: 端子台プラン表。押しボタン2個を端子台の端子記号へ配線し、線番とジャンパを入れる。
job(["98-terminal-plan.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await placeComponent(page, "terminalStrip", 100, 50, { label: "TB1" });
  await page.click("#selectOnlyBtn");
  const strip = await lastElement(page);
  await selectById(page, strip.id);
  await setField(page, "count", 4);
  await setField(page, "jumpers", "3-4");
  const marks = await page.evaluate(id => {
    const T = window.__edsTest;
    const element = T.state.pages.find(item => item.id === T.state.activePageId).elements.find(item => item.id === id);
    return T.elementConnectionAnchors(element);
  }, strip.id);
  const rows = [["PB1", "101"], ["PB2", "102"]];
  for (let i = 0; i < rows.length; i += 1) {
    const [tag, wireNo] = rows[i];
    await placeComponent(page, "pushButton", 50, marks[i].y, { tag });
    await page.click("#selectOnlyBtn");
    const button = await lastElement(page);
    const right = button.anchors[button.anchors.length - 1];
    await drawWire(page, right.x, right.y, marks[i].x, marks[i].y);
    const wire = await lastElement(page);
    await selectById(page, wire.id);
    await setField(page, "wireNo", wireNo);
  }
  await clickEmpty(page, 150, 200);
  await openAction(page, "terminalPlan");
  await shotDialog(page, "98-terminal-plan.png");
  await context.close();
});

// 図11-1: 機器箱の端子ピッチと上下マージン。
job(["54-device-box-settings.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await placeComponent(page, "deviceBox", 85, 60);
  await page.click("#selectOnlyBtn");
  const box = await lastElement(page);
  await selectById(page, box.id);
  await setField(page, "label", "制御ユニット");
  await setField(page, "pins", 4);
  await setField(page, "pinText", "IN1\nIN2\nIN3\nIN4");
  await setField(page, "rightPinText", "OUT1\nOUT2\nOUT3\nOUT4");
  await setField(page, "pinPitch", 7.5);
  await setField(page, "pinMargin", 7.5);
  await zoomAt(page, 8, 100, 72);
  await scrollInspectorTo(page, '#selectionPanel [data-bind="pins"]', 40);
  await shot(page, "54-device-box-settings.png");
  await context.close();
});

const PLC_SAMPLE_CSV = [
  "アドレス,入出力,信号,線番,接続先,備考",
  "X000,入力,起動,101,PB1,",
  "X001,入力,停止,,PB2,",
  "Y000,出力,運転,201,MC1,",
  "Y001,出力,警報,,BZ1,"
].join("\r\n");

// 図11-2: PLC CSV取込の結果。
job(["99-plc-csv-page.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await importCsv(page, "#plcCsvInput", "plc-io.csv", PLC_SAMPLE_CSV);
  await deleteFirstPage(page);
  await page.click("#selectOnlyBtn");
  await hideCanvasHint(page);
  await zoomAt(page, 5.5, 106, 52);
  await shot(page, "99-plc-csv-page.png", { clip: await canvasClip(page, 24, 18, 190, 84) });
  await context.close();
});

// 図11-5: PLC出力8点ページ。
job(["57-plc-output-page.png"], async browser => {
  const { context, page } = await freshPage(browser);
  await page.selectOption("#templateMenu", "plcInput");
  await page.waitForSelector("#plcInBuildBtn");
  await page.selectOption("#plcPreset", "3");
  await settle(page);
  await page.click("#plcInBuildBtn");
  await settle(page);
  await deleteFirstPage(page);
  await page.click("#selectOnlyBtn");
  await shot(page, "57-plc-output-page.png");
  await context.close();
});
