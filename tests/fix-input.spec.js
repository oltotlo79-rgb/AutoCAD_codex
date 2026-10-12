const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test, expect } = require("@playwright/test");

const appUrl = pathToFileURL(path.resolve(__dirname, "..", "index.html")).href;
const runtimeIssues = new WeakMap();

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

// A4縦・枠線のみのページを並べたテスト用プロジェクト。
function project(pages) {
  return {
    schemaVersion: 4,
    activePageId: pages[0].id,
    pages: pages.map(item => ({ size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, ...item }))
  };
}

async function install(page, data) {
  await page.evaluate(value => window.__edsTest.installProjectData(value), data);
}

function snapshot(page) {
  return page.evaluate(() => {
    const { state } = window.__edsTest;
    const diagnostics = window.__edsTest.historyDiagnostics();
    return {
      tool: window.__edsTest.getActiveTool(),
      historyCount: diagnostics.count,
      historyIndex: diagnostics.index,
      collapsed: !!state.settings.leftPanelCollapsed || !!state.settings.rightPanelCollapsed,
      dirty: window.__edsTest.isProjectDirty(),
      zoom: state.settings.zoom
    };
  });
}

function focusedId(page) {
  return page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName || null);
}

test("ボタン・<summary>を選んでいるときのEnter/Space/Tabはそのボタンの操作とフォーカス移動になり、繰返・集中表示は用紙側だけで働く", async ({ page }) => {
  await install(page, project([{ id: "p1", name: "P1", elements: [] }]));
  // 「繰返」の対象を配線ツールにしてから選択ツールへ戻す。
  await page.evaluate(() => {
    window.__edsTest.setActiveTool("wire");
    window.__edsTest.setActiveTool("select");
  });
  const audit = page.locator("#ribbonAudit");

  // リボンのボタン上のEnter/Spaceはそのボタンを押す。繰返(配線ツール)にはならない。
  await audit.focus();
  await page.keyboard.press("Enter");
  await expect(audit).toHaveClass(/active/);
  expect((await snapshot(page)).tool).toBe("select");
  await page.keyboard.press(" ");
  await expect(audit).not.toHaveClass(/active/);
  expect((await snapshot(page)).tool).toBe("select");

  // Tab/Shift+Tabは次/前のボタンへ移るだけで、集中表示にはならない。
  await page.keyboard.press("Tab");
  expect(await focusedId(page)).toBe("ribbonPages");
  await page.keyboard.press("Shift+Tab");
  expect(await focusedId(page)).toBe("ribbonAudit");
  expect((await snapshot(page)).collapsed).toBe(false);

  // 左パネルの<summary>もEnter/Spaceで開閉し、繰返にならない。
  const summary = page.locator("aside.palette details.attr-panel > summary", { hasText: "採番の書式設定" });
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(summary.locator("xpath=..")).toHaveAttribute("open", "");
  await page.keyboard.press(" ");
  await expect(summary.locator("xpath=..")).not.toHaveAttribute("open", "");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => {
    const active = document.activeElement;
    return active !== document.body && !active.matches("summary") && !!active.closest("aside.palette");
  }), "Tabで左パネルの次の操作部品へ移る").toBe(true);
  expect((await snapshot(page)).tool).toBe("select");
  expect((await snapshot(page)).collapsed).toBe(false);

  // 入力欄の文字入力・Tabはこれまでどおり欄の操作(ツール切替・集中表示にならない)。
  await page.locator("#paletteFilter").focus();
  await page.keyboard.type("wt ");
  await expect(page.locator("#paletteFilter")).toHaveValue("wt ");
  await page.keyboard.press("Tab");
  expect((await snapshot(page)).tool).toBe("select");
  expect((await snapshot(page)).collapsed).toBe(false);
  await page.locator("#paletteFilter").fill("");

  // ボタンを押したあと用紙をクリックすれば、Enter=繰返・Tab=集中表示に戻る。
  await audit.click();
  const area = await page.locator(".workspace").boundingBox();
  await page.mouse.click(area.x + 12, area.y + area.height - 12);
  expect(await focusedId(page)).toBe("BODY");
  await page.keyboard.press("Enter");
  expect((await snapshot(page)).tool).toBe("wire");
  await page.keyboard.press("Escape");
  expect((await snapshot(page)).tool).toBe("select");
  await page.keyboard.press("Tab");
  expect((await snapshot(page)).collapsed).toBe(true);
  await page.keyboard.press("Tab");
  expect((await snapshot(page)).collapsed).toBe(false);
});

// 画面座標の下にある図面上の点(mm)。
function drawingPointAt(page, point) {
  return page.evaluate(([x, y]) => {
    const svg = document.querySelector("svg#canvas");
    const box = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    return { x: (x - box.left) / box.width * viewBox.width, y: (y - box.top) / box.height * viewBox.height };
  }, [point.x, point.y]);
}

// 編集中ページのSVG(指の下の図形があればその図形)へタッチのポインタイベントを送る(2本指のピンチ操作の再現)。
function touch(page, type, pointerId, point) {
  return page.evaluate(([eventType, id, x, y]) => {
    const svg = document.querySelector("svg#canvas");
    const hit = document.elementFromPoint(x, y);
    (hit && svg.contains(hit) ? hit : svg).dispatchEvent(new PointerEvent(eventType, {
      pointerId: id, pointerType: "touch", isPrimary: id === 1, clientX: x, clientY: y,
      bubbles: true, cancelable: true, composed: true
    }));
  }, [type, pointerId, point.x, point.y]);
}

async function pinch(page, startMid, startHalf, steps) {
  await touch(page, "pointerdown", 1, { x: startMid.x - startHalf, y: startMid.y });
  await touch(page, "pointerdown", 2, { x: startMid.x + startHalf, y: startMid.y });
  for (const step of steps) {
    await touch(page, "pointermove", 1, { x: step.mid.x - step.half, y: step.mid.y });
    await touch(page, "pointermove", 2, { x: step.mid.x + step.half, y: step.mid.y });
    if (step.check) await step.check(step.mid);
  }
}

async function expectSamePoint(page, point, anchor, label) {
  const now = await drawingPointAt(page, point);
  expect(Math.abs(now.x - anchor.x), label + " X方向のずれ(mm)").toBeLessThan(.5);
  expect(Math.abs(now.y - anchor.y), label + " Y方向のずれ(mm)").toBeLessThan(.5);
}

test("2本指のピンチズームは指の中点の下の図面位置を保ち、中点の移動でパンし、履歴を増やさない", async ({ page }) => {
  await install(page, project([{ id: "p1", name: "P1", elements: [] }]));
  await page.locator("#zoomRange").fill("4");
  await page.evaluate(() => {
    const workspace = document.querySelector(".workspace");
    workspace.scrollLeft = (workspace.scrollWidth - workspace.clientWidth) / 2;
    workspace.scrollTop = (workspace.scrollHeight - workspace.clientHeight) / 2;
  });
  const area = await page.locator(".workspace").boundingBox();
  const mid = { x: area.x + area.width * .4, y: area.y + area.height * .6 };
  const start = await snapshot(page);
  const anchor = await drawingPointAt(page, mid);

  // 指を開きながら中点を右下へ動かす: 開始時に中点の下にあった点が、常に今の中点の下にある。
  const check = point => expectSamePoint(page, point, anchor, "ピンチ中");
  const moved = { x: mid.x + 30, y: mid.y + 20 };
  await pinch(page, mid, 60, [
    { mid: { x: mid.x + 10, y: mid.y + 5 }, half: 90, check },
    { mid: moved, half: 120, check }
  ]);
  expect((await snapshot(page)).zoom).toBeCloseTo(8, 1);
  await touch(page, "pointerup", 2, { x: moved.x + 120, y: moved.y });
  await touch(page, "pointerup", 1, { x: moved.x - 120, y: moved.y });
  await expectSamePoint(page, moved, anchor, "指を離した後");
  await expect(page.locator("#zoomRange")).toHaveValue("8");

  // 指を閉じる(縮小)方向でも同じ。
  const anchor2 = await drawingPointAt(page, moved);
  await pinch(page, moved, 120, [{ mid: moved, half: 80, check: point => expectSamePoint(page, point, anchor2, "縮小中") }]);
  await touch(page, "pointerup", 1, { x: moved.x - 80, y: moved.y });
  await touch(page, "pointerup", 2, { x: moved.x + 80, y: moved.y });
  expect((await snapshot(page)).zoom).toBeCloseTo(8 * 80 / 120, 1);
  await expectSamePoint(page, moved, anchor2, "縮小後");

  const end = await snapshot(page);
  expect(end.historyCount).toBe(start.historyCount);
  expect(end.historyIndex).toBe(start.historyIndex);
  expect(end.dirty).toBe(start.dirty);
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.length)).toBe(0);
});

test("並べて表示でも、ピンチを終えて他ページの大きさが揃ったあとも指の下の図面位置がずれない", async ({ page }) => {
  await install(page, project([
    { id: "p1", name: "P1", elements: [] },
    { id: "p2", name: "P2", elements: [] }
  ]));
  await page.locator("#pageViewMode").selectOption("row");
  await page.locator("#zoomRange").fill("3");
  // 右側(2ページ目)を編集対象にして、その上でピンチする。
  await page.locator('svg.drawing-page[data-page-id="p2"]').evaluate(node => node.scrollIntoView({ block: "center", inline: "center" }));
  await page.locator(".page-slot-head", { hasText: "P2" }).click();
  await expect(page.locator('svg#canvas[data-page-id="p2"]')).toHaveCount(1);
  const box = await page.locator("svg#canvas").boundingBox();
  const area = await page.locator(".workspace").boundingBox();
  const mid = {
    x: Math.max(area.x + 150, Math.min(area.x + area.width - 150, box.x + box.width * .5)),
    y: Math.max(area.y + 150, Math.min(area.y + area.height - 150, box.y + box.height * .4))
  };
  const anchor = await drawingPointAt(page, mid);
  const start = await snapshot(page);

  await pinch(page, mid, 50, [{ mid, half: 75, check: point => expectSamePoint(page, point, anchor, "ピンチ中") }]);
  await touch(page, "pointerup", 1, { x: mid.x - 75, y: mid.y });
  await touch(page, "pointerup", 2, { x: mid.x + 75, y: mid.y });
  expect((await snapshot(page)).zoom).toBeCloseTo(4.5, 1);
  // 1ページ目も新しい倍率で描き直され、編集中ページの指の下の点はそのまま。
  const sizes = await page.evaluate(() => [...document.querySelectorAll("svg.drawing-page")].map(svg => Math.round(svg.getBoundingClientRect().width)));
  expect(sizes[0]).toBe(sizes[1]);
  await expectSamePoint(page, mid, anchor, "指を離した後");
  const end = await snapshot(page);
  expect(end.historyCount).toBe(start.historyCount);
});


test("ピンチを始めると1本目の指で始めた作図・移動は取り消され、途中の線や動かしかけた位置が図面に残らない", async ({ page }) => {
  const COIL = { id: "coil", type: "coil", x: 40, y: 100, w: 10, h: 4.4, layer: "symbols" };
  await install(page, project([{ id: "p1", name: "P1", elements: [COIL] }]));
  const start = await snapshot(page);
  const clientAt = mm => page.evaluate(([x, y]) => {
    const svg = document.querySelector("svg#canvas");
    const box = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    return { x: box.left + x / viewBox.width * box.width, y: box.top + y / viewBox.height * box.height };
  }, mm);

  // 配線ツールで1本目の指を置く(作図開始) → 2本目の指でピンチ開始 → 作図中の線は残らない。
  await page.evaluate(() => window.__edsTest.setActiveTool("wire"));
  const a = await clientAt([100, 60]);
  await touch(page, "pointerdown", 1, a);
  await touch(page, "pointermove", 1, { x: a.x + 40, y: a.y });
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.length)).toBe(2);
  await touch(page, "pointerdown", 2, { x: a.x + 120, y: a.y + 60 });
  await touch(page, "pointerup", 2, { x: a.x + 120, y: a.y + 60 });
  await touch(page, "pointerup", 1, { x: a.x + 40, y: a.y });
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.map(item => item.id))).toEqual(["coil"]);

  // 選択ツールで部品を1本指でドラッグ中にピンチを始めると、部品は元の位置へ戻る。
  await page.evaluate(() => window.__edsTest.setActiveTool("select"));
  const c = await clientAt([45, 102.2]);
  await touch(page, "pointerdown", 1, c);
  await touch(page, "pointermove", 1, { x: c.x + 60, y: c.y + 40 });
  expect(await page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.id === "coil").x), "1本指で動かし始めている").not.toBe(40);
  await touch(page, "pointerdown", 2, { x: c.x + 160, y: c.y + 100 });
  await touch(page, "pointerup", 2, { x: c.x + 160, y: c.y + 100 });
  await touch(page, "pointerup", 1, { x: c.x + 60, y: c.y + 40 });
  const coil = await page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.id === "coil"));
  expect({ x: coil.x, y: coil.y }).toEqual({ x: 40, y: 100 });
  expect((await snapshot(page)).historyCount).toBe(start.historyCount);
});

const TABLE = {
  id: "tbl", type: "table", x: 30, y: 40, w: 86, h: 48, rows: 6, cols: 4, label: "表",
  colWidths: "", rowHeights: "", tableFontSize: 2.2, cellText: "", layer: "notes"
};

test("表の「セル文字（タブ/カンマ区切り）」ではTabでタブ文字が入り、欄から抜けずツール切替キーにもならない", async ({ page }) => {
  await install(page, project([{ id: "p1", name: "P1", elements: [TABLE] }]));
  await page.evaluate(() => window.__edsTest.selectElement("tbl"));
  const cells = page.locator('#selectionPanel textarea[data-bind="cellText"]');
  const cellText = () => page.evaluate(() => window.__edsTest.state.pages[0].elements[0].cellText);
  const start = await snapshot(page);

  await cells.click();
  // w/t/l は欄の外ならツール切替キー。Tabのあとも欄の中で文字として入る。
  await page.keyboard.type("No.");
  await page.keyboard.press("Tab");
  await page.keyboard.type("wtl");
  await page.keyboard.press("Tab");
  await page.keyboard.type("c");
  await expect(cells).toBeFocused();
  await expect(cells).toHaveValue("No.\twtl\tc");
  expect((await snapshot(page)).tool).toBe("select");
  expect((await snapshot(page)).collapsed).toBe(false);
  // 入力中も図面へはそのまま反映される(タブ区切りで別のセル)。
  expect(await cellText()).toBe("No.\twtl\tc");
  await expect(page.locator('[data-id="tbl"] text', { hasText: "wtl" })).toHaveCount(1);

  // 欄の中のCtrl+Zは文字入力の取り消し(タブも1文字の入力として戻る)。図面の履歴には触れない。
  await page.keyboard.press("Control+z");
  await expect(cells).not.toHaveValue("No.\twtl\tc");
  await page.keyboard.press("Control+y");
  await expect(cells).toHaveValue("No.\twtl\tc");
  expect((await snapshot(page)).historyCount).toBe(start.historyCount);

  // Shift+Tabは前の欄へ移る(タブ文字は入らない)。欄を離れた時点で履歴が1件だけ増える。
  await page.keyboard.press("Shift+Tab");
  await expect(cells).not.toBeFocused();
  expect(await cellText()).toBe("No.\twtl\tc");
  const edited = await snapshot(page);
  expect(edited.historyCount).toBe(start.historyCount + 1);

  // 図面のUndo 1回で編集前へ戻り、Redoで編集後へ。
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Control+z");
  await expect.poll(cellText).toBe("");
  await page.keyboard.press("Control+y");
  await expect.poll(cellText).toBe("No.\twtl\tc");
});
