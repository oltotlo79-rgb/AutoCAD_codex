const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test, expect } = require("@playwright/test");

const appUrl = pathToFileURL(path.resolve(__dirname, "..", "index.html")).href;
const runtimeIssues = new WeakMap();

// 1テストで複数の画面幅・入力値・キー操作を順に確かめるため、既定(15秒)より長めにする。
test.describe.configure({ timeout: 45_000 });

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

// 1ページ(A4縦・枠線のみ)のテスト用プロジェクト。追加ページはextraPagesで渡す。
function project(elements, extraPages = []) {
  return {
    schemaVersion: 4,
    activePageId: "p1",
    pages: [
      { id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements },
      ...extraPages
    ]
  };
}

const COIL = { id: "coil", type: "coil", x: 40, y: 100, w: 10, h: 4.4, layer: "symbols" };
const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function install(page, data) {
  await page.evaluate(value => window.__edsTest.installProjectData(value), data);
}

async function select(page, id) {
  await page.evaluate(value => window.__edsTest.selectElement(value), id);
}

function overlaps(a, b) {
  return Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x)
    && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
}

// 図面の状態(ツール・履歴・要素・パネル開閉)を比較用にまとめて取る。
function drawingSnapshot(page) {
  return page.evaluate(() => {
    const { state } = window.__edsTest;
    const diagnostics = window.__edsTest.historyDiagnostics();
    return {
      tool: window.__edsTest.getActiveTool(),
      historyCount: diagnostics.count,
      historyIndex: diagnostics.index,
      elements: JSON.stringify(state.pages.map(item => item.elements)),
      pages: state.pages.length,
      leftCollapsed: !!state.settings.leftPanelCollapsed,
      rightCollapsed: !!state.settings.rightPanelCollapsed,
      zoom: state.settings.zoom
    };
  });
}

test("PDF印刷・A3面付では画面の操作UIを出さず図面シートだけを印刷する", async ({ page }) => {
  await install(page, project([COIL], [
    { id: "p2", name: "P2", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements: [] }
  ]));
  await select(page, "coil");
  for (const id of ["#toggleLeftPanel", "#toggleRightPanel", "#bottomHud", "#miniToolbar"]) {
    await expect(page.locator(id), id).toBeVisible();
  }
  await page.evaluate(() => { window.print = () => {}; });

  for (const button of ["#printBtn", "#printTwoUpBtn"]) {
    await page.locator(button).click();
    await page.emulateMedia({ media: "print" });
    const printed = await page.evaluate(() => ({
      shown: [...document.body.children]
        .filter(node => getComputedStyle(node).display !== "none")
        .map(node => node.id || node.className || node.tagName),
      sheets: document.querySelectorAll("#printSheets .print-sheet > svg").length
    }));
    expect(printed.shown, button).toEqual(["printSheets"]);
    expect(printed.sheets, button).toBeGreaterThan(0);
    const pdf = await page.pdf({ preferCSSPageSize: true });
    expect(pdf.subarray(0, 4).toString(), button).toBe("%PDF");
    await page.emulateMedia({ media: "screen" });
  }
  await expect(page.locator("#bottomHud")).toBeVisible();
});

test("ダイアログ表示中は浮遊UIより前面に出て、ミニツールバーから図面を変更できない", async ({ page }) => {
  await install(page, project([COIL]));
  await select(page, "coil");
  const mini = page.locator("#miniToolbar");
  await expect(mini).toBeVisible();
  const rotate = await mini.getByRole("button", { name: "回転" }).boundingBox();
  const duplicate = await mini.getByRole("button", { name: "複製" }).boundingBox();
  const overlays = {};
  for (const id of ["#toggleLeftPanel", "#toggleRightPanel", "#bottomHud", "#miniToolbar"]) {
    overlays[id] = await page.locator(id).boundingBox();
  }
  const before = await drawingSnapshot(page);

  await page.locator("#helpBtn").click();
  await expect(page.locator("#dialogBackdrop")).toBeVisible();
  await expect(mini).toBeHidden();
  for (const [id, rect] of Object.entries(overlays)) {
    const covered = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest("#dialogBackdrop"),
      [rect.x + rect.width / 2, rect.y + rect.height / 2]);
    expect(covered, `${id}はダイアログの下に隠れる`).toBe(true);
  }
  // 以前ミニツールバーがあった位置を押しても図面は変わらない。
  await page.mouse.click(rotate.x + rotate.width / 2, rotate.y + rotate.height / 2);
  await page.mouse.click(duplicate.x + duplicate.width / 2, duplicate.y + duplicate.height / 2);
  // 隠れたボタンをスクリプトから押しても実行しない(二重の安全策)。
  await page.evaluate(() => document.querySelectorAll("#miniToolbar button").forEach(button => button.click()));
  await expect(page.locator("#dialogBackdrop")).toBeVisible();
  expect(await drawingSnapshot(page)).toEqual(before);

  const zIndex = await page.evaluate(() => ({
    backdrop: Number(getComputedStyle(document.querySelector("#dialogBackdrop")).zIndex),
    toast: Number(getComputedStyle(document.querySelector("#toastStack")).zIndex),
    overlays: ["#toggleLeftPanel", "#bottomHud", "#miniToolbar", "#drawInput", "#contextMenu"]
      .map(id => Number(getComputedStyle(document.querySelector(id)).zIndex))
  }));
  expect(Math.max(...zIndex.overlays)).toBeLessThan(zIndex.backdrop);
  expect(zIndex.toast, "通知はダイアログの上でも読める").toBeGreaterThan(zIndex.backdrop);

  await page.locator("#dialogClose").click();
  await expect(mini).toBeVisible();
});

test("ダイアログ表示中のキー操作は裏の図面へ届かずダイアログ内で働く", async ({ page }) => {
  await install(page, project([COIL]));
  await select(page, "coil");
  const before = await drawingSnapshot(page);
  const backdrop = page.locator("#dialogBackdrop");

  await page.locator("#helpBtn").click();
  await expect(backdrop).toBeVisible();
  const summary = page.locator("#dialogBody details > summary").first();
  await summary.focus();
  // Enter/Spaceは<summary>の開閉として働き、「繰返」コマンドや配線ツールへ切り替わらない。
  await page.keyboard.press("Enter");
  await expect(summary.locator("xpath=..")).toHaveAttribute("open", "");
  await page.keyboard.press(" ");
  await expect(summary.locator("xpath=..")).not.toHaveAttribute("open", "");
  // Tabは集中表示ではなくダイアログ内のフォーカス移動。
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest("#dialogBackdrop"))).toBe(true);
  await expect(page.locator(".app")).not.toHaveClass(/collapsed/);
  for (const key of ["Delete", "Backspace", "w", "t", "l", "r", "c", "q", "s", "=", "-", "0",
    "ArrowLeft", "Shift+ArrowDown", "Control+z", "Control+y", "Control+d", "Control+c", "Control+v", "Control+k"]) {
    await page.keyboard.press(key);
  }
  await expect(backdrop).toBeVisible();
  await expect(page.locator("#dialogTitle")).toHaveText("使い方ガイド");
  expect(await drawingSnapshot(page)).toEqual(before);

  // 端でTab/Shift+Tabを押してもフォーカスはダイアログ内で循環し、裏のツールバーへ出ない。
  await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("#dialogBackdrop .dialog :is(button, input, select, textarea, summary)")]
      .filter(node => node.getClientRects().length > 0);
    nodes[nodes.length - 1].focus();
  });
  await page.keyboard.press("Tab");
  await expect(page.locator("#dialogClose")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest("#dialogBackdrop"))).toBe(true);
  await page.locator("#helpBtn").evaluate(node => node.focus());
  await page.keyboard.press("Tab");
  await expect(page.locator("#dialogClose")).toBeFocused();

  // ダイアログのボタンはEnterで押せる。
  await page.locator("#dialogClose").focus();
  await page.keyboard.press("Enter");
  await expect(backdrop).toBeHidden();
  expect(await drawingSnapshot(page)).toEqual(before);

  // Escでも閉じる。閉じた後はショートカットが元どおり効く。
  await page.locator("#helpBtn").click();
  await expect(backdrop).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(backdrop).toBeHidden();
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("w");
  expect(await page.evaluate(() => window.__edsTest.getActiveTool())).toBe("wire");
});

for (const width of [1280, 1366, 1440, 1600]) {
  test(`ステータス表示は省略されずに読める幅を保つ（幅${width}px）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.locator("#paletteFilter").fill("coil");
    await page.locator('#paletteGrid .palette-item[data-type="coil"]').dragTo(page.locator("svg#canvas"), {
      targetPosition: { x: 150, y: 60 }
    });
    await expect(page.locator("#status")).toContainText("シンボルデザイン");

    const status = await page.locator("#status").boundingBox();
    expect(status.width).toBeGreaterThanOrEqual(360);
    const fits = await page.locator("#status").evaluate(node => node.scrollWidth <= node.clientWidth);
    expect(fits, "配置直後の案内文が途中で切れない").toBe(true);
    const buttons = await page.locator(".topbar button").evaluateAll(nodes => nodes.map(node => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { label: node.textContent.trim(), x, y, width, height };
    }));
    const header = await page.locator(".topbar").boundingBox();
    for (const button of buttons) {
      expect(overlaps(button, status), `${button.label}とステータスが重ならない`).toBe(false);
      expect(button.y + button.height, button.label).toBeLessThanOrEqual(header.y + header.height);
    }
    expect(status.y + status.height).toBeLessThanOrEqual(header.y + header.height);
  });
}

for (const width of [1280, 1366, 1440, 1600]) {
  test(`パネル開閉ボタンがパネル見出し・タブ・操作ヒントに重ならない（幅${width}px）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await install(page, project([COIL]));
    await select(page, "coil");
    await expect(page.locator("#inspectorTabComponent")).toHaveClass(/active/);

    const toggles = [await page.locator("#toggleLeftPanel").boundingBox(), await page.locator("#toggleRightPanel").boundingBox()];
    for (const selector of [".palette", ".palette .panel-title", ".inspector", "#inspectorTabPage", "#inspectorTabComponent", "#canvasHint"]) {
      const target = await page.locator(selector).first().boundingBox();
      for (const toggle of toggles) expect(overlaps(toggle, target), `${selector}に重ならない`).toBe(false);
    }
    const workspace = await page.locator(".workspace").boundingBox();
    expect(toggles[0].x).toBeGreaterThanOrEqual(workspace.x);
    expect(toggles[1].x + toggles[1].width).toBeLessThanOrEqual(workspace.x + workspace.width);
    expect(toggles[0].y).toBeGreaterThanOrEqual(workspace.y);

    // 閉じた後も作業領域の端に残り、押せば元へ戻る。
    await page.locator("#toggleLeftPanel").click();
    await page.locator("#toggleRightPanel").click();
    await expect(page.locator(".app")).toHaveClass(/left-collapsed/);
    await expect(page.locator(".app")).toHaveClass(/right-collapsed/);
    const left = await page.locator("#toggleLeftPanel").boundingBox();
    const right = await page.locator("#toggleRightPanel").boundingBox();
    expect(left.x).toBe(0);
    expect(right.x + right.width).toBeLessThanOrEqual(width);
    expect(overlaps(left, await page.locator("#canvasHint").boundingBox())).toBe(false);
    await page.locator("#toggleLeftPanel").click();
    await page.locator("#toggleRightPanel").click();
    await expect(page.locator(".app")).not.toHaveClass(/collapsed/);
  });
}

test("部品を選択しても右パネルの「ページ設定」「選択部品」タブが隠れない", async ({ page }) => {
  await install(page, project([
    COIL,
    { id: "text1", type: "text", x: 100, y: 60, w: 40, h: 8, text: "ABC", fontSize: 3.5, layer: "notes" }
  ]));
  const tabsVisible = async () => {
    const tabs = await page.locator("#inspectorTabs").boundingBox();
    const inspector = await page.locator(".inspector").boundingBox();
    return tabs.y >= inspector.y - 0.5 && tabs.y + tabs.height <= inspector.y + inspector.height;
  };

  await page.locator('[data-id="coil"]').click();
  await expect(page.locator("#inspectorTabComponent")).toHaveClass(/active/);
  await page.waitForTimeout(50);
  expect(await tabsVisible()).toBe(true);
  const tabsBox = await page.locator("#inspectorTabs").boundingBox();
  const titleBox = await page.locator("#selectionPanel .panel-title").first().boundingBox();
  expect(titleBox.y, "選択部品の見出しはタブの下に見える").toBeGreaterThanOrEqual(tabsBox.y + tabsBox.height);

  // 長い編集欄を下までスクロールしてもタブ帯は上端に留まる。
  await page.evaluate(() => { const inspector = document.querySelector(".inspector"); inspector.scrollTop = inspector.scrollHeight; });
  await expect.poll(async () => {
    const tabs = await page.locator("#inspectorTabs").boundingBox();
    const inspector = await page.locator(".inspector").boundingBox();
    return Math.abs(tabs.y - inspector.y);
  }).toBeLessThan(1);
  const hit = await page.evaluate(() => {
    const tab = document.querySelector("#inspectorTabPage").getBoundingClientRect();
    return document.elementFromPoint(tab.left + tab.width / 2, tab.top + tab.height / 2)?.id;
  });
  expect(hit).toBe("inspectorTabPage");

  // 別の要素を選ぶと、その編集欄の先頭がタブの直下へ戻る。
  await page.locator('[data-id="text1"]').click();
  await expect.poll(async () => {
    const tabs = await page.locator("#inspectorTabs").boundingBox();
    const panel = await page.locator("#selectionPanel").boundingBox();
    return panel.y - (tabs.y + tabs.height);
  }).toBeGreaterThanOrEqual(0);
  const tabs = await page.locator("#inspectorTabs").boundingBox();
  const panel = await page.locator("#selectionPanel").boundingBox();
  expect(panel.y - (tabs.y + tabs.height)).toBeLessThanOrEqual(40);
  expect(await tabsVisible()).toBe(true);
});

test("横並び表示や高倍率で横スクロールしても操作ヒントが表示領域の上部中央に残る", async ({ page }) => {
  const blankPage = id => ({ id, name: id.toUpperCase(), size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements: [] });
  await install(page, project([COIL], [blankPage("p2"), blankPage("p3")]));
  const hintPlacement = () => page.evaluate(() => {
    const workspace = document.querySelector(".workspace");
    const area = workspace.getBoundingClientRect();
    const hint = document.querySelector("#canvasHint").getBoundingClientRect();
    return {
      scrolledLeft: workspace.scrollLeft,
      centerOffset: Math.abs((hint.left + hint.right) / 2 - (area.left + workspace.clientWidth / 2)),
      inside: hint.left >= area.left && hint.right <= area.left + workspace.clientWidth,
      top: hint.top - area.top
    };
  });

  await page.locator("#pageViewMode").selectOption("row");
  await page.evaluate(() => { const workspace = document.querySelector(".workspace"); workspace.scrollLeft = workspace.scrollWidth; });
  let placement = await hintPlacement();
  expect(placement.scrolledLeft).toBeGreaterThan(200);
  expect(placement.inside).toBe(true);
  expect(placement.centerOffset).toBeLessThan(8);
  expect(placement.top).toBeGreaterThanOrEqual(0);
  expect(placement.top).toBeLessThan(20);

  await page.locator("#pageViewMode").selectOption("tab");
  await page.locator("#zoomRange").fill("12");
  await page.evaluate(() => {
    const workspace = document.querySelector(".workspace");
    workspace.scrollLeft = workspace.scrollWidth;
    workspace.scrollTop = workspace.scrollHeight;
  });
  placement = await hintPlacement();
  expect(placement.scrolledLeft).toBeGreaterThan(200);
  expect(placement.inside).toBe(true);
  expect(placement.centerOffset).toBeLessThan(8);
  expect(placement.top).toBeLessThan(20);
});

test("下絵の不透明度は0.05〜1へ丸め、1を超える値は百分率として扱う", async ({ page }) => {
  await install(page, project([
    { id: "under", type: "underlayImage", x: 20, y: 20, w: 60, h: 40, imageData: PNG_1PX, opacity: .35, cropPreset: "full", locked: true, layer: "layout" }
  ]));
  await select(page, "under");
  const panel = page.locator("#selectionPanel");
  await expect(panel.locator("label", { hasText: "不透明度" })).toHaveText("不透明度（0.05〜1・小さいほど薄い）");
  const opacity = () => page.evaluate(() => window.__edsTest.state.pages[0].elements[0].opacity);
  const input = () => panel.locator('[data-bind="opacity"]');

  for (const [typed, stored] of [["30", .3], ["0", .05], ["0.6", .6], ["250", 1], ["-1", .05]]) {
    await input().fill(typed);
    await input().blur();
    await expect.poll(opacity, typed).toBe(stored);
    await expect(input(), typed).toHaveValue(String(stored));
    await expect(page.locator('[data-id="under"] image'), typed).toHaveAttribute("opacity", String(stored));
  }
});

test("接続点を持たない要素の座標欄は「位置」、部品は「接続点」と表示する", async ({ page }) => {
  await install(page, project([
    COIL,
    { id: "under", type: "underlayImage", x: 20, y: 20, w: 60, h: 40, imageData: PNG_1PX, opacity: .35, cropPreset: "full", locked: true, layer: "layout" },
    { id: "text1", type: "text", x: 100, y: 60, w: 40, h: 8, text: "ABC", fontSize: 3.5, layer: "notes" },
    { id: "frame", type: "installationBox", x: 30, y: 150, w: 60, h: 40, label: "盤", dash: "4 2", layer: "layout" }
  ]));
  const labels = async id => {
    await select(page, id);
    return page.locator('#selectionPanel [data-bind="x"], #selectionPanel [data-bind="y"]').evaluateAll(nodes =>
      nodes.map(node => node.previousElementSibling?.textContent.trim()));
  };
  expect(await labels("coil")).toEqual(["接続点 X mm", "接続点 Y mm（上が＋）"]);
  for (const id of ["under", "text1", "frame"]) {
    expect(await labels(id), id).toEqual(["位置 X mm", "位置 Y mm（上が＋）"]);
  }
  // 位置欄は外形左上(Y上向き)を示し、入力するとその位置へ動く。
  await select(page, "text1");
  const y = page.locator('#selectionPanel [data-bind="y"]');
  await expect(y).toHaveValue(String(297 - 60));
  await y.fill("200");
  await y.blur();
  await expect.poll(() => page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.id === "text1").y)).toBe(97);
});

test("設備ラダーは1つ目のレールを左端に並べ、電源注記を最後の左レールの右へ置く", async ({ page }) => {
  const build = async rails => {
    await page.locator("#templateMenu").selectOption("facilityLadder");
    await expect(page.locator("#dialogBody label").first()).toHaveText("左レール名（カンマ区切り・1つ目を左端に右へ順に配置）");
    await page.locator("#ladRails").fill(rails);
    await page.locator("#ladBuildBtn").click();
    return page.evaluate(() => {
      const { state } = window.__edsTest;
      const current = state.pages.find(item => item.id === state.activePageId);
      const marks = current.elements.filter(item => item.type === "polarityMark" && item.sign === "+")
        .map(item => ({ label: item.label, left: item.x, right: item.x + item.w, top: item.y, bottom: item.y + item.h }));
      const note = current.elements.find(item => item.type === "text" && item.text === "(DC24V)");
      return { marks, note: { x: note.x, y: note.y, w: note.w } };
    });
  };
  const onGrid = value => Math.abs(value / 2.5 - Math.round(value / 2.5)) < 0.001;

  const single = await build("P1");
  expect(single.note.x).toBe(40);

  const triple = await build("P1,P2,P3");
  expect(triple.marks.map(mark => mark.label)).toEqual(["P1", "P2", "P3"]);
  expect(triple.marks.map(mark => mark.left)).toEqual([...triple.marks.map(mark => mark.left)].sort((a, b) => a - b));
  expect(triple.note.x).toBe(50);
  expect(onGrid(triple.note.x)).toBe(true);
  for (const mark of triple.marks) {
    expect(triple.note.x, `${mark.label}の⊕に重ならない`).toBeGreaterThan(mark.right);
  }
});

test("端子台エディタは広幅で開き、列が潰れたり見出しが1文字ずつ折り返したりしない", async ({ page }) => {
  await install(page, project([
    { id: "strip1", type: "terminalStrip", x: 50, y: 80, w: 10, h: 30, count: 3, orientation: "vertical", label: "TB1", layer: "symbols" },
    { id: "strip2", type: "terminalStrip", x: 90, y: 80, w: 30, h: 10, count: 3, orientation: "horizontal", label: "TB2", layer: "symbols" },
    { id: "conn", type: "connector", x: 50, y: 150, w: 10, h: 30, count: 3, orientation: "vertical", label: "CN1", layer: "symbols" }
  ]));
  await page.locator("#actionMenu").selectOption("terminalEditor");
  await expect(page.locator("#dialogBackdrop .dialog")).toHaveClass(/wide/);
  const metrics = await page.evaluate(() => {
    const table = document.querySelector("#dialogBody table");
    const width = node => node.getBoundingClientRect().width;
    return {
      headerHeights: [...table.querySelectorAll("thead th")].map(node => node.getBoundingClientRect().height),
      rowHeights: [...table.querySelectorAll("[data-terminal-row]")].map(node => node.getBoundingClientRect().height),
      selectWidths: [...table.querySelectorAll("select")].map(width),
      inputWidths: [...table.querySelectorAll("input")].map(width)
    };
  });
  expect(Math.max(...metrics.headerHeights), "見出しは1行").toBeLessThan(40);
  expect(Math.max(...metrics.rowHeights), "ページ名・種別が縦に折り返さない").toBeLessThan(56);
  expect(Math.min(...metrics.selectWidths), "セレクトが矢印だけに潰れない").toBeGreaterThanOrEqual(60);
  expect(Math.min(...metrics.inputWidths)).toBeGreaterThanOrEqual(48);
});

test("ページナビゲータのカードはページ名まで表示する", async ({ page }) => {
  await install(page, project([COIL], [
    { id: "p2", name: "制御回路", size: "A3", orientation: "landscape", frameVariant: "blank", title: {}, elements: [] }
  ]));
  await page.locator("#actionMenu").selectOption("pageNavigator");
  const cards = page.locator("#pageNavigatorGrid .page-nav-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("1. P1");
  await expect(cards.nth(1)).toContainText("2. 制御回路");
  const layout = await cards.evaluateAll(nodes => nodes.map(card => {
    const box = card.getBoundingClientRect();
    const svg = card.querySelector("svg").getBoundingClientRect();
    const label = card.lastElementChild.getBoundingClientRect();
    const hit = document.elementFromPoint(label.left + 4, label.top + label.height / 2);
    return { svgHeight: Math.round(svg.height), labelInside: label.bottom <= box.bottom + .5, labelHit: hit === card.lastElementChild };
  }));
  for (const card of layout) expect(card).toEqual({ svgHeight: 105, labelInside: true, labelHit: true });
});

test("作業領域をスクロールするとミニツールバーが選択要素に追従し、見えなくなれば隠れる", async ({ page }) => {
  await install(page, project([COIL]));
  await select(page, "coil");
  const mini = page.locator("#miniToolbar");
  await expect(mini).toBeVisible();
  const positions = async () => ({
    toolbar: (await mini.boundingBox()).y,
    element: (await page.locator('[data-id="coil"]').boundingBox()).y
  });
  const before = await positions();
  await page.evaluate(() => { document.querySelector(".workspace").scrollTop += 60; });
  await expect.poll(async () => {
    const after = await positions();
    return Math.round((after.toolbar - before.toolbar) - (after.element - before.element));
  }).toBe(0);
  const after = await positions();
  expect(after.element).toBeLessThan(before.element - 30);

  await page.locator("#zoomRange").fill("12");
  await page.evaluate(() => {
    const workspace = document.querySelector(".workspace");
    workspace.scrollLeft = workspace.scrollWidth;
    workspace.scrollTop = workspace.scrollHeight;
  });
  await expect(mini).toBeHidden();
  await page.locator('[data-id="coil"]').evaluate(node => node.scrollIntoView({ block: "center", inline: "center" }));
  await expect(mini).toBeVisible();
});

test("Ctrl+ホイールのズームはカーソル下の図面位置を保ち、履歴を増やさない", async ({ page }) => {
  await page.locator("#zoomRange").fill("6");
  await page.evaluate(() => {
    const workspace = document.querySelector(".workspace");
    workspace.scrollLeft = (workspace.scrollWidth - workspace.clientWidth) / 2;
    workspace.scrollTop = (workspace.scrollHeight - workspace.clientHeight) / 2;
  });
  const area = await page.locator(".workspace").boundingBox();
  const cursor = { x: area.x + area.width * .4, y: area.y + area.height * .6 };
  const drawingPointAt = () => page.evaluate(([x, y]) => {
    const svg = document.querySelector("svg#canvas");
    const box = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    return { x: (x - box.left) / box.width * viewBox.width, y: (y - box.top) / box.height * viewBox.height };
  }, [cursor.x, cursor.y]);
  const start = await drawingSnapshot(page);
  const anchor = await drawingPointAt();

  await page.mouse.move(cursor.x, cursor.y);
  await page.keyboard.down("Control");
  for (const deltaY of [-100, -100, -100, 100]) await page.mouse.wheel(0, deltaY);
  await page.keyboard.up("Control");
  await expect.poll(() => page.evaluate(() => window.__edsTest.state.settings.zoom)).toBeGreaterThan(6.5);
  const after = await drawingPointAt();
  expect(Math.abs(after.x - anchor.x), "X方向のずれ(mm)").toBeLessThan(.5);
  expect(Math.abs(after.y - anchor.y), "Y方向のずれ(mm)").toBeLessThan(.5);
  const end = await drawingSnapshot(page);
  expect(end.historyCount).toBe(start.historyCount);
  expect(await page.evaluate(() => window.__edsTest.isProjectDirty())).toBe(false);
});

test("ズーム操作はどの経路でも履歴を積まず未保存にもせず、Undoでも表示倍率は戻らない", async ({ page }) => {
  const start = await drawingSnapshot(page);
  expect(await page.evaluate(() => window.__edsTest.isProjectDirty())).toBe(false);
  await page.locator("#zoomInBtn").click();
  await page.locator("#zoomOutBtn").click();
  await page.locator("#actualSizeBtn").click();
  await page.locator("#fitPageBtn").click();
  await page.locator("#zoomRange").fill("5");
  await page.locator("#zoomRange").dispatchEvent("change");
  await page.locator("#zoomRange").blur();
  await page.keyboard.press("=");
  await page.keyboard.press("-");
  await page.keyboard.press("=");
  const zoomed = await drawingSnapshot(page);
  expect(zoomed.zoom).toBeCloseTo(6.25, 2);
  expect(zoomed.historyCount).toBe(start.historyCount);
  expect(zoomed.historyIndex).toBe(start.historyIndex);
  expect(await page.evaluate(() => window.__edsTest.isProjectDirty())).toBe(false);
  await expect(page.locator("#bottomHud")).toContainText("保存済み");
  await page.keyboard.press("0");
  expect((await drawingSnapshot(page)).historyCount).toBe(start.historyCount);

  // 編集→ズーム→Undo: 編集だけが戻り、表示倍率はそのまま。
  await install(page, project([COIL]));
  await select(page, "coil");
  const coilX = () => page.evaluate(() => window.__edsTest.state.pages[0].elements[0].x);
  const originalX = await coilX();
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("ArrowRight");
  await expect.poll(coilX).not.toBe(originalX);
  await page.locator("#zoomInBtn").click();
  const zoom = await page.evaluate(() => window.__edsTest.state.settings.zoom);
  const history = await drawingSnapshot(page);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Control+z");
  await expect.poll(coilX).toBe(originalX);
  expect(await page.evaluate(() => window.__edsTest.state.settings.zoom)).toBe(zoom);
  expect((await drawingSnapshot(page)).historyIndex).toBe(history.historyIndex - 1);
});

test("右パネルの2列入力は見出しが2行でも入力欄の高さがそろう", async ({ page }) => {
  for (const type of ["terminalBox", "deviceBox", "arc"]) {
    await page.evaluate(type => {
      const element = { ...window.__edsTest.defaultElementAtPlacement(type, 50, 50), id: "target" };
      window.__edsTest.installProjectData({
        schemaVersion: 4, activePageId: "p1",
        pages: [{ id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements: [element] }]
      });
      window.__edsTest.selectElement("target");
    }, type);
    const misaligned = await page.evaluate(() => {
      document.querySelectorAll("#selectionPanel details").forEach(node => { node.open = true; });
      return [...document.querySelectorAll("#selectionPanel .row")].flatMap(row => {
        const cells = [...row.children].filter(cell => cell.matches("div") && cell.querySelector(":scope > label + :is(input, select, textarea)"));
        if (cells.length < 2) return [];
        const tops = cells.map(cell => Math.round(cell.querySelector(":scope > :is(input, select, textarea)").getBoundingClientRect().top));
        return Math.max(...tops) - Math.min(...tops) > 1 ? [cells.map(cell => cell.querySelector("label").textContent.trim())] : [];
      });
    });
    expect(misaligned, type).toEqual([]);
  }
});
