const fs = require("node:fs");
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

// 空のA4縦ページ(スナップON・2.5mmグリッド)へ要素を読み込む。
async function installPage(page, elements = [], settings = {}) {
  await page.evaluate(([elements, settings]) => window.__edsTest.installProjectData({
    schemaVersion: 4,
    activePageId: "p1",
    settings: { snap: true, objectSnap: true, grid: 2.5, ...settings },
    pages: [{ id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements }]
  }), [elements, settings]);
}

// 用紙mm座標→画面座標(canvasPointの逆変換)。
async function screenPoint(page, x, y) {
  return page.evaluate(([x, y]) => {
    const svg = document.querySelector("svg#canvas");
    const point = svg.createSVGPoint();
    point.x = x;
    point.y = y;
    const screen = point.matrixTransform(svg.getScreenCTM());
    return { x: screen.x, y: screen.y };
  }, [x, y]);
}

async function moveMouseTo(page, x, y, steps = 3) {
  const point = await screenPoint(page, x, y);
  await page.mouse.move(point.x, point.y, { steps });
}

// 配線ツールで始点を押し、経由点を順にたどる(離さない)。
async function startWireDrag(page, start, via) {
  await page.evaluate(() => window.__edsTest.setActiveTool("wire"));
  await moveMouseTo(page, start[0], start[1], 1);
  await page.mouse.down();
  for (const point of via) await moveMouseTo(page, point[0], point[1]);
}

async function wires(page) {
  return page.evaluate(() => window.__edsTest.state.pages[0].elements.filter(item => item.type === "wire"));
}

async function onlyWire(page) {
  const list = await wires(page);
  expect(list).toHaveLength(1);
  return list[0];
}

test("配線ドラッグ中のShiftは自動の折れ向きを反転し、押す・離すだけで即座に反映される", async ({ page }) => {
  await installPage(page);
  // 横へ先に動かす → 横→縦(orthoFlip=true)。Shiftを押すと縦→横、離すと横→縦へ戻る(マウスは動かさない)。
  await startWireDrag(page, [50, 50], [[80, 50], [80, 80]]);
  let wire = await onlyWire(page);
  expect(wire.points).toEqual([[50, 50], [80, 80]]);
  expect(wire.orthoFlip).toBe(true);
  await page.keyboard.down("Shift");
  expect((await onlyWire(page)).orthoFlip).toBe(false);
  await page.keyboard.up("Shift");
  expect((await onlyWire(page)).orthoFlip).toBe(true);
  await page.keyboard.down("Shift");
  await page.mouse.up();
  await page.keyboard.up("Shift");
  wire = await onlyWire(page);
  expect(wire.points).toEqual([[50, 50], [80, 80]]);
  expect(wire.orthoFlip).toBe(false);
});

test("縦へ先に動かしながらShiftを押し続けると、横→縦で確定する", async ({ page }) => {
  await installPage(page);
  await page.keyboard.down("Shift");
  await startWireDrag(page, [50, 50], [[50, 80], [80, 80]]);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const wire = await onlyWire(page);
  expect(wire.points).toEqual([[50, 50], [80, 80]]);
  expect(wire.orthoFlip).toBe(true);
});

test("スペース/Tabは表示中の形から L字(縦→横)→L字(横→縦)→コの字(横→縦→横)→コの字(縦→横→縦) の順に毎回形を変える", async ({ page }) => {
  await installPage(page);
  await startWireDrag(page, [50, 50], [[80, 50], [80, 80]]);
  expect((await onlyWire(page)).orthoFlip).toBe(true);

  // 横先行のL字(横→縦)表示中 → 1回目でコの字(横→縦→横)。
  await page.keyboard.press("Space");
  expect((await onlyWire(page)).points).toEqual([[50, 50], [65, 50], [65, 80], [80, 80]]);
  await expect(page.locator("#status")).toContainText("コの字（横→縦→横）");
  await page.keyboard.press("Tab");
  expect((await onlyWire(page)).points).toEqual([[50, 50], [50, 65], [80, 65], [80, 80]]);
  await expect(page.locator("#status")).toContainText("コの字（縦→横→縦）");
  await page.keyboard.press("Space");
  let wire = await onlyWire(page);
  expect(wire.points).toEqual([[50, 50], [80, 80]]);
  expect(wire.orthoFlip).toBe(false);
  await expect(page.locator("#status")).toContainText("L字（縦→横）");
  await page.keyboard.press("Space");
  wire = await onlyWire(page);
  expect(wire.points).toEqual([[50, 50], [80, 80]]);
  expect(wire.orthoFlip).toBe(true);
  // 選んだ形はその後マウスを動かしても保たれる。
  await page.keyboard.press("Space");
  await moveMouseTo(page, 85, 90);
  await page.mouse.up();
  expect((await onlyWire(page)).points).toEqual([[50, 50], [67.5, 50], [67.5, 90], [85, 90]]);
});

test("縦へ先に動かしたL字(縦→横)でも、スペース1回目で横→縦へ変わる", async ({ page }) => {
  await installPage(page);
  await startWireDrag(page, [50, 50], [[50, 80], [80, 80]]);
  expect((await onlyWire(page)).orthoFlip).toBe(false);
  await page.keyboard.press("Space");
  expect((await onlyWire(page)).orthoFlip).toBe(true);
  await page.mouse.up();
});

test("配線ドラッグ中の数字キーは数値入力に使われ、折れ形状を変えない", async ({ page }) => {
  await installPage(page);
  await startWireDrag(page, [50, 50], [[80, 50], [80, 80]]);
  await page.keyboard.press("2");
  await expect(page.locator("#drawInput")).toBeVisible();
  await expect(page.locator("#drawInput")).toContainText("2");
  const wire = await onlyWire(page);
  expect(wire.points).toEqual([[50, 50], [80, 80]]);
  expect(wire.orthoFlip).toBe(true);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await wires(page)).toHaveLength(0);
});

test("ドラッグ方向のL字が部品本体を横切るときだけ逆向きのL字を自動で選び、Shift・スペースの指定は優先する", async ({ page }) => {
  // 機器箱(x35〜50, y25〜35)を、(20,30)→(60,70)の横先行L字は横切り、縦先行L字は横切らない。
  await installPage(page, [{ id: "box1", type: "deviceBox", x: 35, y: 25, w: 15, h: 10, pins: 2, layer: "symbols" }]);
  const direct = await page.evaluate(() => {
    const route = (initialAxis, extra = {}) => {
      const element = { id: "tmp", points: [[20, 30], [20, 30]] };
      window.__edsTest.rebuildDrawingWire(element, { lastPoint: [60, 70], initialAxis, ...extra }, extra.shift === true);
      return { points: element.points, orthoFlip: element.orthoFlip };
    };
    return {
      horizontal: route("horizontal"),
      vertical: route("vertical"),
      horizontalShift: route("horizontal", { shift: true }),
      chosenByCycle: route("horizontal", { bendCycle: 1 })
    };
  });
  expect(direct.horizontal.orthoFlip).toBe(false);
  expect(direct.vertical.orthoFlip).toBe(false);
  expect(direct.horizontalShift.orthoFlip).toBe(true);
  expect(direct.chosenByCycle.orthoFlip).toBe(true);

  // 実際のドラッグでも横へ先に動かして箱を越えると、箱を通らない縦→横で確定する。
  await startWireDrag(page, [20, 30], [[60, 30], [60, 70]]);
  expect((await onlyWire(page)).orthoFlip).toBe(false);
  await page.mouse.up();
  const wire = await onlyWire(page);
  expect(wire.points).toEqual([[20, 30], [60, 70]]);
  expect(wire.orthoFlip).toBe(false);
});

test("経路上に部品が無ければ、L字は従来どおりドラッグを最初に進めた向き(横→縦)に従う", async ({ page }) => {
  await installPage(page);
  await startWireDrag(page, [20, 30], [[60, 30], [60, 70]]);
  await page.mouse.up();
  expect((await onlyWire(page)).orthoFlip).toBe(true);
});

test("配線のドラッグ中にRやツールキーを押しても配線を壊さず、ツールも切り替わらない", async ({ page }) => {
  await installPage(page);
  await startWireDrag(page, [50, 50], [[80, 50], [80, 80]]);
  await page.keyboard.press("r");
  await page.keyboard.press("t");
  await moveMouseTo(page, 90, 85);
  await page.mouse.up();
  const wire = await onlyWire(page);
  expect(wire.points).toEqual([[50, 50], [90, 85]]);
  expect(await page.evaluate(() => window.__edsTest.getActiveTool())).toBe("select");
});

test("直線のドラッグ中にRを押しても矩形ツールへ切り替わらない", async ({ page }) => {
  await installPage(page);
  await page.evaluate(() => window.__edsTest.setActiveTool("line"));
  await moveMouseTo(page, 50, 120, 1);
  await page.mouse.down();
  await moveMouseTo(page, 90, 120);
  await page.keyboard.press("r");
  await moveMouseTo(page, 95, 120);
  await page.mouse.up();
  expect(await page.evaluate(() => window.__edsTest.getActiveTool())).toBe("line");
  const lines = await page.evaluate(() => window.__edsTest.state.pages[0].elements.filter(item => item.type === "line"));
  expect(lines).toHaveLength(1);
  expect(lines[0].points).toEqual([[50, 120], [95, 120]]);
});

test("Aキーは配線を斜めにせず、配線は常に直交のまま", async ({ page }) => {
  await installPage(page);
  await startWireDrag(page, [50, 50], [[80, 50], [80, 80]]);
  await page.keyboard.press("a");
  await moveMouseTo(page, 90, 95);
  await expect(page.locator("#status")).not.toContainText("任意角度");
  await page.mouse.up();
  const wire = await onlyWire(page);
  expect(wire.points).toEqual([[50, 50], [90, 95]]);
  expect(wire.orthoFlip).toBe(true);
  const segments = await page.evaluate(() => {
    const path = document.querySelector('svg#canvas [data-type="wire"] path.wire-line').getAttribute("d");
    return path;
  });
  expect(segments).toBe("M 50 50 L 90 50 L 90 95");
});

test("数値の直接入力: 角度は反時計回りで、配線は終点をグリッドへ乗せ、確定後は選択ツールへ戻る", async ({ page }) => {
  // 30,45: 右上45°へ30mm → (71.21, 28.79) をグリッドへ → (70, 30)。横先行のL字のまま確定する。
  await installPage(page);
  await startWireDrag(page, [50, 50], [[60, 50]]);
  await page.keyboard.type("30,45");
  await expect(page.locator("#drawInput")).toContainText("30,45");
  await page.keyboard.press("Enter");
  let wire = await onlyWire(page);
  expect(wire.points).toEqual([[50, 50], [70, 30]]);
  expect(wire.orthoFlip).toBe(true);
  expect(await page.evaluate(() => window.__edsTest.getActiveTool())).toBe("select");
  await expect(page.locator("#drawInput")).toBeHidden();
  await moveMouseTo(page, 100, 100);
  await page.mouse.up();
  expect(await wires(page)).toHaveLength(1);
  expect((await onlyWire(page)).points).toEqual([[50, 50], [70, 30]]);
});

test("数値の直接入力: 90°は真上、X@YのYは用紙下端から上が＋(右パネルの表示と一致)", async ({ page }) => {
  // 20,90 は真上。
  await installPage(page);
  await startWireDrag(page, [50, 50], [[50, 60]]);
  await page.keyboard.type("20,90");
  await page.keyboard.press("Enter");
  await page.mouse.up();
  expect((await onlyWire(page)).points).toEqual([[50, 50], [50, 30]]);

  // 120@72 は用紙左下原点で上へ72mm → 内部座標 y = 297 - 72 = 225。
  await installPage(page);
  await startWireDrag(page, [50, 50], [[60, 50]]);
  await page.keyboard.type("120@72");
  await page.keyboard.press("Enter");
  await page.mouse.up();
  expect((await onlyWire(page)).points).toEqual([[50, 50], [120, 225]]);
  const panelY = await page.evaluate(() => {
    window.__edsTest.selectElement(window.__edsTest.state.pages[0].elements[0].id);
    return Number(document.querySelector('[data-bind="p1y"]')?.value);
  });
  expect(panelY).toBe(72);
});

test("数値の直接入力: 直線は角度どおりの正確な値で確定し、ツールも直線のまま", async ({ page }) => {
  // 直線は角度どおりの正確な値を保つ(グリッドへ丸めない)。
  await installPage(page);
  await page.evaluate(() => window.__edsTest.setActiveTool("line"));
  await moveMouseTo(page, 50, 50, 1);
  await page.mouse.down();
  await moveMouseTo(page, 60, 50);
  await page.keyboard.type("25,30");
  await page.keyboard.press("Enter");
  await page.mouse.up();
  const line = await page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.type === "line"));
  expect(line.points).toEqual([[50, 50], [71.65, 37.5]]);
  expect(await page.evaluate(() => window.__edsTest.getActiveTool())).toBe("line");
});

test("接続した部品を動かしても、コの字配線の中間の折れ点を保ち端の線分だけ追従する", async ({ page }) => {
  await installPage(page, [{ id: "t1", type: "terminal", x: 115, y: 87, w: 10, h: 6, terminalShape: "circle", layer: "symbols" }]);
  const anchor = await page.evaluate(() => window.__edsTest.elementConnectionAnchors(window.__edsTest.state.pages[0].elements[0])[0]);
  const end = [anchor.x, anchor.y];
  const route = [[55, 50], [85, 50], [85, end[1]], end];
  await installPage(page, [
    { id: "t1", type: "terminal", x: 115, y: 87, w: 10, h: 6, terminalShape: "circle", layer: "symbols" },
    { id: "w1", type: "wire", points: route, layer: "wires" }
  ]);
  const box = await page.locator('[data-id="t1"]').boundingBox();
  const scale = await page.evaluate(() => {
    const svg = document.querySelector("svg#canvas");
    return svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
  });
  const grab = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x, grab.y + 5 * scale, { steps: 5 });
  await page.mouse.up();
  const moved = await page.evaluate(() => window.__edsTest.elementConnectionAnchors(window.__edsTest.state.pages[0].elements.find(item => item.id === "t1"))[0]);
  expect(moved.y).toBeCloseTo(end[1] + 5, 5);
  const wire = await page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.id === "w1"));
  expect(wire.points).toEqual([[55, 50], [85, 50], [85, moved.y], [moved.x, moved.y]]);
});

test("線番採番は今回付けた配線だけ表示を決め、利用者が隠した線番を再表示しない", async ({ page }) => {
  const net = (prefix, y, extra = {}) => [
    { id: prefix + "long", type: "wire", points: [[20, y], [80, y]], layer: "wires", ...(extra.long || {}) },
    { id: prefix + "short", type: "wire", points: [[80, y], [80, y + 20]], layer: "wires", ...(extra.short || {}) }
  ];
  await installPage(page, [
    // 採番済みネット: 長い方の線番を利用者が非表示にし、短い方で見せている。
    ...net("a", 40, { long: { wireNo: "1-01", hideWireNo: true }, short: { wireNo: "1-01", hideWireNo: false } }),
    // 未採番ネット。
    ...net("b", 100)
  ]);
  const runNumbering = async (overwrite, start) => {
    const answers = [true, overwrite, start];
    const handler = dialog => {
      const answer = answers.shift();
      if (answer === false) dialog.dismiss();
      else dialog.accept(answer === true ? undefined : answer);
    };
    page.on("dialog", handler);
    await page.locator("#autoWireBtn").evaluate(button => button.click());
    page.off("dialog", handler);
  };
  const snapshot = () => page.evaluate(() => Object.fromEntries(window.__edsTest.state.pages[0].elements
    .map(item => [item.id, { wireNo: item.wireNo, hide: item.hideWireNo === true, auto: item.wireNoAutoHidden === true }])));

  // 未採番のみ: 採番済みネットの表示は一切変えず、新しいネットは最長1本だけ表示。
  await runNumbering(false, "2");
  let result = await snapshot();
  expect(result.along).toEqual({ wireNo: "1-01", hide: true, auto: false });
  expect(result.ashort).toEqual({ wireNo: "1-01", hide: false, auto: false });
  expect(result.blong).toEqual({ wireNo: "1-02", hide: false, auto: false });
  expect(result.bshort).toEqual({ wireNo: "1-02", hide: true, auto: true });

  // 新ネットの代表線番を右パネルで非表示にする → 利用者の指定になる。
  await page.evaluate(() => window.__edsTest.selectElement("blong"));
  await page.locator('[data-bind="hideWireNo"]').check();
  result = await snapshot();
  expect(result.blong).toEqual({ wireNo: "1-02", hide: true, auto: false });

  // 上書き採番: 利用者が隠した線番は隠したまま、自動で隠していた線番が代表になる。
  await runNumbering(true, "5");
  result = await snapshot();
  expect(result.along).toEqual({ wireNo: "1-05", hide: true, auto: false });
  expect(result.ashort).toEqual({ wireNo: "1-05", hide: false, auto: false });
  expect(result.blong).toEqual({ wireNo: "1-06", hide: true, auto: false });
  expect(result.bshort).toEqual({ wireNo: "1-06", hide: false, auto: false });
});

test("線番固定の「FIX」は画面だけに表示し、SVG出力と印刷プレビューには出さない", async ({ page }) => {
  await installPage(page, [{ id: "w1", type: "wire", points: [[20, 40], [80, 40]], wireNo: "1-01", fixedWireNo: true, layer: "wires" }]);
  await expect(page.locator('svg#canvas [data-id="w1"] text').filter({ hasText: "FIX" })).toHaveCount(1);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#exportSvgBtn").evaluate(button => button.click());
  const download = await downloadPromise;
  const svg = fs.readFileSync(await download.path(), "utf8");
  expect(svg).toContain("1-01");
  expect(svg).not.toContain("FIX");

  await page.locator("#printPreviewBtn").evaluate(button => button.click());
  const dialog = page.locator("#dialogBody");
  await expect(dialog.locator("svg").first()).toBeVisible();
  await expect(dialog.locator("text").filter({ hasText: "1-01" })).not.toHaveCount(0);
  await expect(dialog.locator("text").filter({ hasText: "FIX" })).toHaveCount(0);
  // 出力後も画面側の目印は残る。
  await page.keyboard.press("Escape");
  await expect(page.locator('svg#canvas [data-id="w1"] text').filter({ hasText: "FIX" })).toHaveCount(1);
});

test("交差ギャップはギャップ側の配線だけを切り、交差する相手の配線は途切れない", async ({ page }) => {
  await installPage(page, [
    { id: "h", type: "wire", points: [[20, 50], [80, 50]], gapPoints: [[50, 50]], layer: "wires" },
    { id: "v", type: "wire", points: [[50, 30], [50, 70]], layer: "wires" }
  ]);
  const drawn = await page.evaluate(() => ({
    h: document.querySelector('svg#canvas [data-id="h"] path.wire-line').getAttribute("d"),
    v: document.querySelector('svg#canvas [data-id="v"] path.wire-line').getAttribute("d"),
    whiteRects: document.querySelectorAll('svg#canvas [data-type="wire"] rect[fill="#fff"]').length
  }));
  expect(drawn.whiteRects).toBe(0);
  expect(drawn.h).toBe("M 20 50 L 46.8 50 M 53.2 50 L 80 50");
  expect(drawn.v).toBe("M 50 30 L 50 70");

  // 交点の画素は相手側(縦)配線の色で塗られている(白で覆われていない)。
  const center = await screenPoint(page, 50, 51);
  const hit = await page.evaluate(([x, y]) => {
    const node = document.elementFromPoint(x, y);
    return node?.closest("[data-id]")?.dataset.id || null;
  }, [center.x, center.y]);
  expect(hit).toBe("v");

  // DXFも同じ位置で切れている(DXFはY上向き: y=50 → 297-50=247)。
  const dxf = await page.evaluate(() => window.__edsTest.buildDxf(window.__edsTest.state.pages[0]));
  const codes = dxf.split("\n").map(value => value.trim());
  const wireLines = [];
  for (let i = 0; i < codes.length - 1; i += 2) {
    if (codes[i] !== "0" || codes[i + 1] !== "LINE") continue;
    const entity = {};
    for (let j = i + 2; j < codes.length - 1 && codes[j] !== "0"; j += 2) entity[codes[j]] = codes[j + 1];
    if (String(entity["8"]).startsWith("WIRE")) wireLines.push([entity["10"], entity["20"], entity["11"], entity["21"]].map(Number));
  }
  expect(wireLines).toEqual(expect.arrayContaining([[20, 247, 46.8, 247], [53.2, 247, 80, 247], [50, 267, 50, 227]]));
  expect(wireLines).toHaveLength(3);
});

test("最後の曲がり角を消して2点へ戻っても、消した角と同じ側に折れる", async ({ page }) => {
  for (const [corner, expectedFlip] of [[[60, 30], true], [[20, 70], false]]) {
    await installPage(page, [{ id: "w1", type: "wire", points: [[20, 30], corner, [60, 70]], orthoFlip: !expectedFlip, layer: "wires" }]);
    await page.evaluate(() => window.__edsTest.selectElement("w1"));
    await page.locator("#removeWirePointBtn").click();
    const wire = await onlyWire(page);
    expect(wire.points).toEqual([[20, 30], [60, 70]]);
    expect(wire.orthoFlip).toBe(expectedFlip);
    const d = await page.locator('svg#canvas [data-id="w1"] path.wire-line').getAttribute("d");
    expect(d).toBe(`M 20 30 L ${corner[0]} ${corner[1]} L 60 70`);
  }
});

test("コの字の折り返し位置はスナップON時にグリッドへ乗る", async ({ page }) => {
  await installPage(page);
  const routes = await page.evaluate(() => {
    const build = bendCycle => {
      const element = { id: "tmp", points: [[50, 50], [50, 50]] };
      window.__edsTest.rebuildDrawingWire(element, { lastPoint: [82.5, 80], bendCycle }, false);
      return element.points;
    };
    const snapped = { z: build(2), z2: build(3) };
    window.__edsTest.state.settings.snap = false;
    const free = build(2);
    window.__edsTest.state.settings.snap = true;
    return { ...snapped, free };
  });
  expect(routes.z).toEqual([[50, 50], [67.5, 50], [67.5, 80], [82.5, 80]]);
  expect(routes.z2).toEqual([[50, 50], [50, 65], [82.5, 65], [82.5, 80]]);
  expect(routes.free).toEqual([[50, 50], [66.25, 50], [66.25, 80], [82.5, 80]]);
});

test("部品を選んでWを押しても、部品の外からドラッグすれば普通に配線できる", async ({ page }) => {
  await installPage(page, [{ id: "box1", type: "deviceBox", x: 30, y: 40, w: 30, h: 25, pins: 4, layer: "symbols" }]);
  await page.evaluate(() => window.__edsTest.selectElement("box1"));
  await page.keyboard.press("w");
  expect(await page.evaluate(() => window.__edsTest.getActiveTool())).toBe("wire");
  await expect(page.locator("#canvasHint")).toContainText("緑の小円");
  await expect(page.locator("svg#canvas .connection-choice")).toHaveCount(8);

  // 部品の上(接続点以外)を押した場合は従来どおり配線を始めない。
  const body = await screenPoint(page, 45, 52.5);
  await page.mouse.move(body.x, body.y);
  await page.mouse.down();
  await page.mouse.up();
  expect(await wires(page)).toHaveLength(0);
  expect(await page.evaluate(() => window.__edsTest.getActiveTool())).toBe("wire");

  // 部品の外(左の母線位置など)からは普通に配線できる。
  await moveMouseTo(page, 15, 100, 1);
  await page.mouse.down();
  await moveMouseTo(page, 15, 120);
  await page.mouse.up();
  const wire = await onlyWire(page);
  expect(wire.points).toEqual([[15, 100], [15, 120]]);
});

test("短い配線の線番は線端を越えるとき線分の中央へ寄せる", async ({ page }) => {
  await installPage(page, [
    { id: "short", type: "wire", points: [[20, 40], [27.5, 40]], wireNo: "1-101", layer: "wires" },
    { id: "long", type: "wire", points: [[20, 60], [80, 60]], wireNo: "1-102", layer: "wires" },
    { id: "moved", type: "wire", points: [[20, 80], [27.5, 80]], wireNo: "1-103", wireNoDx: 2, layer: "wires" }
  ]);
  const label = id => page.locator(`svg#canvas [data-id="${id}"] text`).first()
    .evaluate(node => ({ x: Number(node.getAttribute("x")), anchor: node.getAttribute("text-anchor") }));
  expect(await label("short")).toEqual({ x: 23.75, anchor: "middle" });
  expect(await label("long")).toEqual({ x: 51.6, anchor: "start" });
  // 手で位置を調整した線番は動かさない。
  expect(await label("moved")).toEqual({ x: 27.35, anchor: "start" });
});
