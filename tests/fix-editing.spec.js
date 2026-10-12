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

// 1ページだけの図面を読み込む(frameVariant既定は白紙)。
async function installPage(page, elements, options = {}) {
  await page.evaluate(([items, opts]) => {
    const api = window.__edsTest;
    api.installProjectData({
      schemaVersion: 10,
      activePageId: "p",
      ...(opts.project ? { project: { ...api.state.project, ...opts.project } } : {}),
      pages: [{
        id: "p", name: "P1", size: opts.size || "A3", orientation: opts.orientation || "landscape",
        frameVariant: opts.frameVariant || "blank", title: opts.title || {}, elements: items
      }]
    });
  }, [elements, options]);
}

// mm座標をクライアント座標へ変換する(ズーム・スクロールに依存しない)。
async function canvasClientPoint(page, x, y) {
  return page.evaluate(([px, py]) => {
    const svg = document.querySelector("svg#canvas");
    const point = svg.createSVGPoint();
    point.x = px;
    point.y = py;
    const moved = point.matrixTransform(svg.getScreenCTM());
    return { x: moved.x, y: moved.y };
  }, [x, y]);
}

test("90度単位の回転で全パレット部品の接続ピンがグリッドに残り、往復回転で元の位置へ戻る", async ({ page }) => {
  test.setTimeout(120_000);
  await installPage(page, []);
  const result = await page.evaluate(() => {
    const api = window.__edsTest;
    const onGrid = value => Math.abs(value - Math.round(value / 2.5) * 2.5) < 0.011;
    const pointOnGrid = point => onGrid(point[0]) && onGrid(point[1]);
    const types = [...new Set(Array.from(document.querySelectorAll("#paletteGrid [data-type]")).map(node => node.dataset.type))]
      .filter(type => !type.includes(":"));
    const drawingPage = api.state.pages[0];
    const failures = [];
    let checked = 0;
    types.forEach(type => {
      const placed = api.defaultElementAtPlacement(type, 100, 85);
      if (placed.points || !api.elementConnectionAnchors(placed).length) return;
      checked += 1;
      const reset = () => {
        drawingPage.elements = [JSON.parse(JSON.stringify(placed))];
        api.setSelectionForTest([placed.id]);
        return drawingPage.elements[0];
      };
      const anchorsOf = element => api.elementConnectionAnchors(element).map(anchor => [anchor.x, anchor.y]);
      const base = anchorsOf(reset());
      const gridIndexes = base.map((point, index) => (pointOnGrid(point) ? index : -1)).filter(index => index >= 0);
      const firstPinOnGrid = (() => {
        const pin = api.elementFirstPin(reset());
        return pointOnGrid([pin.x, pin.y]);
      })();
      const checkGrid = (element, label) => {
        const after = anchorsOf(element);
        const off = gridIndexes.filter(index => !pointOnGrid(after[index]));
        if (off.length) failures.push(type + " " + label + " ピンがグリッド外: " + JSON.stringify(off.map(index => after[index])));
        const pin = api.elementFirstPin(element);
        if (!pointOnGrid([pin.x, pin.y])) failures.push(type + " " + label + " 第1ピンがグリッド外: " + JSON.stringify(pin));
      };
      const checkReturned = (element, label) => {
        // 配置直後に第1ピンがグリッド上の部品は、逆回転・一周回転で元の位置へ戻る(半グリッドずつ流れない)。
        if (!firstPinOnGrid) return;
        const after = anchorsOf(element);
        const same = after.every((point, index) => Math.abs(point[0] - base[index][0]) < 0.011 && Math.abs(point[1] - base[index][1]) < 0.011);
        if (!same) failures.push(type + " " + label + " 元へ戻らない: " + JSON.stringify(after.slice(0, 2)) + " / " + JSON.stringify(base.slice(0, 2)));
      };
      // 右90°を4回: 90/180/270°の各段階でグリッド上、4回目で元の位置
      let element = reset();
      [90, 180, 270].forEach(total => {
        api.rotateSelected(90);
        checkGrid(element, "右90°×" + total / 90);
      });
      api.rotateSelected(90);
      checkReturned(element, "右90°×4");
      // 180°・270°(=左90°)を一度に回す場合
      [180, 270].forEach(degrees => {
        element = reset();
        api.rotateSelected(degrees);
        checkGrid(element, degrees + "°");
      });
      // 右90°→左90°で元へ戻る
      element = reset();
      api.rotateSelected(90);
      api.rotateSelected(-90);
      checkReturned(element, "右90°→左90°");
    });
    return { failures, checked };
  });
  expect(result.checked).toBeGreaterThan(55);
  expect(result.failures).toEqual([]);
});

test("押しボタンを右90°回転しても接続ピンがグリッドに乗る(複数選択では配線端点も一緒に乗る)", async ({ page }) => {
  await installPage(page, []);
  const result = await page.evaluate(() => {
    const api = window.__edsTest;
    const pb = { ...api.defaultElementAtPlacement("pushButton", 100, 85), id: "pb" };
    const contact = { ...api.defaultElementAtPlacement("contactNO", 130, 85), id: "k1" };
    const wire = { ...api.defaultElement("wire", 105, 85), id: "w1", points: [[105, 85], [125, 85]] };
    const drawingPage = api.state.pages[0];
    drawingPage.elements = [pb, contact, wire];
    api.setSelectionForTest(["pb"]);
    const before = api.elementConnectionAnchors(drawingPage.elements[0]).map(anchor => [anchor.x, anchor.y]);
    api.rotateSelected(90);
    const single = api.elementConnectionAnchors(drawingPage.elements[0]).map(anchor => [anchor.x, anchor.y]);
    api.rotateSelected(-90);
    const back = api.elementConnectionAnchors(drawingPage.elements[0]).map(anchor => [anchor.x, anchor.y]);
    api.setSelectionForTest(["pb", "k1", "w1"]);
    api.rotateSelected(90);
    const pins = drawingPage.elements.filter(item => !item.points)
      .flatMap(item => api.elementConnectionAnchors(item).map(anchor => [anchor.x, anchor.y]));
    return { before, single, back, pins, wirePoints: drawingPage.elements[2].points };
  });
  const onGrid = value => Math.abs(value - Math.round(value / 2.5) * 2.5) < 0.011;
  expect(result.before).toEqual([[95, 85], [105, 85]]);
  // 旧実装は(99,79)/(99,89)へ回り、グリッドから外れていた
  result.single.forEach(([x, y]) => {
    expect(onGrid(x)).toBe(true);
    expect(onGrid(y)).toBe(true);
  });
  expect(result.single[0][0]).toBeCloseTo(result.single[1][0], 6);
  expect(result.back).toEqual(result.before);
  [...result.pins, ...result.wirePoints].forEach(([x, y]) => {
    expect(onGrid(x)).toBe(true);
    expect(onGrid(y)).toBe(true);
  });
  // 配線の端点は回転後も部品のピンに刺さったまま
  const hasPin = ([x, y]) => result.pins.some(([px, py]) => Math.abs(px - x) < 0.011 && Math.abs(py - y) < 0.011);
  expect(hasPin(result.wirePoints[0])).toBe(true);
  expect(hasPin(result.wirePoints[1])).toBe(true);
});

test("ラダー枠の行に載った接点は右90°→左90°で同じ行へ戻る", async ({ page }) => {
  await installPage(page, [], { frameVariant: "ladder" });
  const result = await page.evaluate(() => {
    const api = window.__edsTest;
    const contact = { ...api.defaultElementAtPlacement("contactNO", 100, 36.5), id: "k1" };
    api.state.pages[0].elements = [contact];
    api.setSelectionForTest(["k1"]);
    const read = () => api.elementConnectionAnchors(api.state.pages[0].elements[0]).map(anchor => [anchor.x, anchor.y]);
    const before = read();
    api.rotateSelected(90);
    const vertical = read();
    api.rotateSelected(-90);
    return { before, vertical, after: read() };
  });
  const onGrid = value => Math.abs(value - Math.round(value / 2.5) * 2.5) < 0.011;
  expect(result.before).toEqual([[95, 36.5], [105, 36.5]]);
  result.vertical.forEach(([x, y]) => {
    expect(onGrid(x)).toBe(true);
    expect(onGrid(y)).toBe(true);
  });
  expect(result.after).toEqual(result.before);
});

test("指定回転の中心Yは右パネルと同じ「上が＋」で表示・入力できる", async ({ page }) => {
  await installPage(page, [], { size: "A4", orientation: "portrait" });
  const setup = await page.evaluate(() => {
    const api = window.__edsTest;
    const pb = { ...api.defaultElementAtPlacement("pushButton", 100, 85), id: "pb" };
    api.state.pages[0].elements = [pb];
    api.selectElement("pb");
    const box = api.elementBounds(api.state.pages[0].elements[0]);
    return {
      panelY: document.querySelector('#selectionPanel [data-bind="y"]').value,
      panelX: document.querySelector('#selectionPanel [data-bind="x"]').value,
      centerY: box.y + box.h / 2
    };
  });
  // 第1ピン(95,85)は右パネルで X=95・Y=297-85=212(上が＋)と表示される
  expect(setup).toMatchObject({ panelX: "95", panelY: "212" });

  await page.locator("#actionMenu").selectOption("rotateAbout");
  await expect(page.locator("#dialogBackdrop")).toBeVisible();
  await expect(page.locator("#dialogBackdrop label", { hasText: "中心Y mm（上が＋）" })).toHaveCount(1);
  const defaultCy = Number(await page.locator("#rotCy").inputValue());
  expect(defaultCy).toBeCloseTo(297 - setup.centerY, 1);

  // パネルに表示された第1ピンの座標をそのまま中心に入れると、そのピンを軸に回る
  await page.locator("#rotCenter").selectOption("point");
  await page.locator("#rotCx").fill(setup.panelX);
  await page.locator("#rotCy").fill(setup.panelY);
  await page.locator("#rotApplyBtn").click();
  const after = await page.evaluate(() => {
    const api = window.__edsTest;
    const element = api.state.pages[0].elements[0];
    return { rotation: element.rotation, anchors: api.elementConnectionAnchors(element).map(anchor => [anchor.x, anchor.y]) };
  });
  expect(after.rotation).toBe(90);
  expect(after.anchors[0][0]).toBeCloseTo(95, 6);
  expect(after.anchors[0][1]).toBeCloseTo(85, 6);
  expect(after.anchors[1][0]).toBeCloseTo(95, 6);
  expect(after.anchors[1][1]).toBeCloseTo(95, 6);
});

test("近接スイッチ・熱電対は第1ピンがグリッドへ置かれ、近接スイッチは配線上で配線を分割する", async ({ page }) => {
  const placements = await page.evaluate(() => {
    const api = window.__edsTest;
    return ["proximitySwitch", "thermocouple"].map(type =>
      api.elementConnectionAnchors(api.defaultElementAtPlacement(type, 100, 85)).map(anchor => [anchor.x, anchor.y]));
  });
  // 旧実装は(100,87.2)/(100,86.5)と行・グリッドから外れていた
  expect(placements[0]).toEqual([[95, 85], [105, 85]]);
  expect(placements[1]).toEqual([[95, 85], [95, 90]]);

  for (const [type, expectSplit] of [["proximitySwitch", true], ["thermocouple", false]]) {
    await installPage(page, [
      { id: "w1", type: "wire", points: [[60, 100], [160, 100]], wireNo: "", layer: "wires" }
    ]);
    await page.evaluate(tool => window.__edsTest.setActiveTool(tool), type);
    const point = await canvasClientPoint(page, 110, 100);
    await page.mouse.click(point.x, point.y);
    const state = await page.evaluate(placedType => {
      const api = window.__edsTest;
      const elements = api.state.pages[0].elements;
      const symbol = elements.find(item => item.type === placedType);
      return {
        anchors: symbol ? api.elementConnectionAnchors(symbol).map(anchor => [anchor.x, anchor.y]) : null,
        wires: elements.filter(item => item.type === "wire").map(item => item.points)
      };
    }, type);
    if (expectSplit) {
      expect(state.anchors).toEqual([[105, 100], [115, 100]]);
      expect(state.wires).toEqual([[[60, 100], [105, 100]], [[115, 100], [160, 100]]]);
    } else {
      // 熱電対は2本の脚が同じ側に出るセンサなので、配線上に置いても配線を切らない
      expect(state.anchors).toEqual([[105, 100], [105, 105]]);
      expect(state.wires).toEqual([[[60, 100], [160, 100]]]);
    }
  }
});

test("矢印キーと右パネルの←↑→↓で部品を動かすと、刺さっている配線の端点も追従する", async ({ page }) => {
  await installPage(page, []);
  await page.evaluate(() => {
    const api = window.__edsTest;
    const contact = { ...api.defaultElementAtPlacement("contactNO", 100, 85), id: "k1" };
    api.state.pages[0].elements = [
      contact,
      { ...api.defaultElement("wire", 70, 85), id: "wl", points: [[70, 85], [95, 85]] },
      { ...api.defaultElement("wire", 105, 85), id: "wr", points: [[105, 85], [130, 85]] },
      { ...api.defaultElement("wire", 70, 120), id: "free", points: [[70, 120], [130, 120]] }
    ];
    api.selectElement("k1");
    document.activeElement?.blur?.();
  });
  const read = () => page.evaluate(() => {
    const api = window.__edsTest;
    const elements = api.state.pages[0].elements;
    const byId = id => elements.find(item => item.id === id);
    return {
      pins: api.elementConnectionAnchors(byId("k1")).map(anchor => [anchor.x, anchor.y]),
      leftEnd: byId("wl").points[byId("wl").points.length - 1],
      leftStart: byId("wl").points[0],
      rightStart: byId("wr").points[0],
      rightEnd: byId("wr").points[byId("wr").points.length - 1],
      free: byId("free").points
    };
  });

  await page.keyboard.press("ArrowRight");
  let state = await read();
  expect(state.pins).toEqual([[96, 85], [106, 85]]);
  expect(state.leftEnd).toEqual([96, 85]);
  expect(state.rightStart).toEqual([106, 85]);
  // 反対側の端点と、接続していない配線は動かない
  expect(state.leftStart).toEqual([70, 85]);
  expect(state.rightEnd).toEqual([130, 85]);
  expect(state.free).toEqual([[70, 120], [130, 120]]);

  await page.keyboard.press("Shift+ArrowDown");
  state = await read();
  expect(state.pins).toEqual([[96, 90], [106, 90]]);
  expect(state.leftEnd).toEqual([96, 90]);
  expect(state.rightStart).toEqual([106, 90]);

  // 右パネルの←ボタン(1mm)も同じく配線を連れて動く
  await page.evaluate(() => document.querySelector('#selectionPanel [data-nudge="-1,0"]').click());
  state = await read();
  expect(state.pins).toEqual([[95, 90], [105, 90]]);
  expect(state.leftEnd).toEqual([95, 90]);
  expect(state.rightStart).toEqual([105, 90]);
});

test("改訂三角は最新の改訂記号で置かれ、図形・注記には電気属性欄を出さない", async ({ page }) => {
  await installPage(page, [], {
    project: { revisions: [{ rev: "A", date: "2026-01-01", note: "" }, { rev: "B", date: "2026-02-01", note: "" }] }
  });
  const result = await page.evaluate(() => {
    const api = window.__edsTest;
    const mark = { ...api.defaultElementAtPlacement("revisionMark", 50, 50), id: "rev" };
    const others = ["cloud", "arc", "ellipseArc", "polygon", "qualifierMark", "operatorMark"].map((type, index) => {
      const element = api.defaultElementAtPlacement(type, 50 + index * 30, 120);
      return { ...element, id: "x" + index };
    });
    const contact = { ...api.defaultElementAtPlacement("contactNO", 250, 50), id: "k1" };
    api.state.pages[0].elements = [mark, ...others, contact];
    api.selectElement("rev");
    const hasElectrical = id => {
      api.selectElement(id);
      return Array.from(document.querySelectorAll("#selectionPanel summary")).some(node => node.textContent.trim() === "電気属性");
    };
    return {
      label: mark.label,
      markText: Array.from(document.querySelectorAll('[data-id="rev"] text')).map(node => node.textContent),
      revisionMark: hasElectrical("rev"),
      others: others.map(element => hasElectrical(element.id)),
      contact: hasElectrical("k1")
    };
  });
  expect(result.label).toBe("B");
  expect(result.markText).toContain("B");
  expect(result.revisionMark).toBe(false);
  expect(result.others).toEqual([false, false, false, false, false, false]);
  expect(result.contact).toBe(true);
});

test("形の決まった記号は幅/高さ欄が読み取り専用になり、値を入れても接続ピンがずれない", async ({ page }) => {
  await installPage(page, []);
  const result = await page.evaluate(() => {
    const api = window.__edsTest;
    const contact = { ...api.defaultElementAtPlacement("contactNO", 100, 85), id: "k1" };
    const box = { ...api.defaultElement("rect", 40, 40), id: "r1" };
    api.state.pages[0].elements = [contact, box];
    api.selectElement("k1");
    const w = document.querySelector('#selectionPanel [data-bind="w"]');
    const h = document.querySelector('#selectionPanel [data-bind="h"]');
    const locked = { w: w.disabled, h: h.disabled, title: w.title };
    // disabledでも反映経路を直接叩かれた場合に備え、変更は拒否される
    w.disabled = false;
    w.value = "20";
    w.dispatchEvent(new Event("change", { bubbles: true }));
    const element = api.state.pages[0].elements.find(item => item.id === "k1");
    const pins = api.elementConnectionAnchors(element).map(anchor => [anchor.x, anchor.y]);
    api.selectElement("r1");
    const rectW = document.querySelector('#selectionPanel [data-bind="w"]');
    return { locked, contactW: element.w, pins, rectDisabled: rectW.disabled };
  });
  expect(result.locked).toEqual({ w: true, h: true, title: "形の決まった記号は大きさを変えられません（ページ設定のシンボル拡大を使用）" });
  expect(result.contactW).toBe(10);
  expect(result.pins).toEqual([[95, 85], [105, 85]]);
  // 図形(矩形)は従来どおり幅/高さを編集できる
  expect(result.rectDisabled).toBe(false);
});

test("Ctrl+Dの識別名は10進で進み、部品タグ固定ではタグもラベルも据え置く", async ({ page }) => {
  await installPage(page, []);
  await page.evaluate(() => {
    const api = window.__edsTest;
    const make = (type, id, props) => ({ ...api.defaultElement(type, 40, 40), id, ...props });
    api.state.pages[0].elements = [
      make("coil", "fixed", { tag: "CR1", label: "CR1", fixedTag: true }),
      make("contactor", "mc", { tag: "MC9", label: "MC9" }),
      make("pushButton", "pb", { tag: "PB19", label: "PB19" }),
      make("breaker", "cb", { tag: "CB9", label: "CB9" }),
      make("terminalBox", "tb", { tag: "TB9", label: "TB9" }),
      make("selectorSwitch", "ss", { tag: "", label: "OFF" }),
      make("qualifierMark", "dc", { label: "DC" }),
      make("contactNO", "x", { tag: "", label: "入力X06F" }),
      make("contactNO", "y", { tag: "", label: "Y07F" }),
      make("wire", "w9", { points: [[10, 10], [20, 10]], wireNo: "W09" }),
      make("wire", "wa", { points: [[10, 20], [20, 20]], wireNo: "W0A" }),
      make("wire", "core", { points: [[10, 30], [20, 30]], wireNo: "1-9" }),
      make("plcBlock", "plc", { pinText: "X01F\nY07F\nI09\nCOM" })
    ];
    api.setSelectionForTest(api.state.pages[0].elements.map(item => item.id));
    document.activeElement?.blur?.();
  });
  await page.keyboard.press("Control+d");
  const copies = await page.evaluate(() => {
    const elements = window.__edsTest.state.pages[0].elements;
    return elements.slice(elements.length / 2).map(item => ({ tag: item.tag, label: item.label, wireNo: item.wireNo, pinText: item.pinText }));
  });
  expect(copies).toHaveLength(13);
  expect(copies[0]).toMatchObject({ tag: "CR1", label: "CR1" });
  expect(copies[1]).toMatchObject({ tag: "MC10", label: "MC10" });
  expect(copies[2]).toMatchObject({ tag: "PB20", label: "PB20" });
  expect(copies[3]).toMatchObject({ tag: "CB10", label: "CB10" });
  expect(copies[4]).toMatchObject({ tag: "TB10", label: "TB10" });
  expect(copies[5].label).toBe("OFF");
  expect(copies[6].label).toBe("DC");
  // PLCの入出力アドレス(X/Y+16進)は16進で進む
  expect(copies[7].label).toBe("入力X070");
  expect(copies[8].label).toBe("Y080");
  // 配線番号W01〜は10進。リンクデバイスはA〜Fを含むときだけ16進
  expect(copies[9].wireNo).toBe("W10");
  expect(copies[10].wireNo).toBe("W0B");
  expect(copies[11].wireNo).toBe("1-10");
  expect(copies[12].pinText).toBe("X020\nY080\nI10\nCOM");
});

test("等間隔複製はn個目の識別名をn進め、複製のグループは元と別になる", async ({ page }) => {
  await installPage(page, []);
  await page.evaluate(() => {
    const api = window.__edsTest;
    api.state.pages[0].elements = [
      { ...api.defaultElement("coil", 40, 40), id: "c1", tag: "CR1", label: "CR1", group: "g1" },
      { ...api.defaultElement("contactNO", 20, 40), id: "k1", tag: "CR1", label: "CR1", group: "g1" }
    ];
    api.selectElement("c1");
    api.setSelectionForTest(["c1", "k1"]);
  });
  await page.evaluate(() => document.querySelector("#arrayCopyBtn").click());
  await page.locator("#arrCount").fill("3");
  await page.locator("#arrDx").fill("0");
  await page.locator("#arrDy").fill("9.5");
  await page.locator("#arrApplyBtn").click();
  const result = await page.evaluate(() => window.__edsTest.state.pages[0].elements
    .map(item => ({ id: item.id, type: item.type, label: item.label, tag: item.tag, group: item.group || "" })));
  const coils = result.filter(item => item.type === "coil");
  expect(coils.map(item => item.tag)).toEqual(["CR1", "CR2", "CR3", "CR4"]);
  expect(coils.map(item => item.label)).toEqual(["CR1", "CR2", "CR3", "CR4"]);
  // 元のグループには元の2要素だけが残り、各複製の組はそれぞれ新しいグループにまとまる
  expect(result.filter(item => item.group === "g1").map(item => item.id).sort()).toEqual(["c1", "k1"]);
  const copies = result.filter(item => item.id !== "c1" && item.id !== "k1");
  expect(copies).toHaveLength(6);
  const groups = [...new Set(copies.map(item => item.group))];
  expect(groups).toHaveLength(3);
  groups.forEach(group => {
    expect(group).not.toBe("");
    expect(copies.filter(item => item.group === group)).toHaveLength(2);
  });
});

test("Ctrl+D・貼り付け・ユーザー回路挿入の複製は元のグループに混ざらない", async ({ page }) => {
  await installPage(page, []);
  await page.evaluate(() => {
    const api = window.__edsTest;
    api.state.pages[0].elements = [
      { ...api.defaultElement("coil", 40, 40), id: "c1", tag: "CR1", label: "CR1", group: "g1" },
      { ...api.defaultElement("contactNO", 20, 40), id: "k1", tag: "CR1", label: "CR1", group: "g1" }
    ];
    api.state.userCircuits = [{
      id: "uc1", name: "回路A", w: 30, h: 10,
      elements: [
        { ...api.defaultElement("coil", 0, 0), id: "t1", label: "", group: "gu" },
        { ...api.defaultElement("contactNO", 15, 0), id: "t2", label: "", group: "gu" }
      ]
    }];
    api.setSelectionForTest(["c1", "k1"]);
    document.activeElement?.blur?.();
  });
  await page.keyboard.press("Control+d");
  await page.evaluate(() => {
    window.__edsTest.setSelectionForTest(["c1", "k1"]);
    document.activeElement?.blur?.();
  });
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await page.keyboard.press("Control+v");
  for (let i = 0; i < 2; i += 1) {
    await page.locator("#actionMenu").selectOption("insertUserCircuit");
    await page.locator("#userCircuitInsert").click();
  }
  const groups = await page.evaluate(() => window.__edsTest.state.pages[0].elements.map(item => item.group || ""));
  // 元2 + Ctrl+D 2 + 貼り付け2回×2 + 回路挿入2回×2 = 12要素、グループは6組(2要素ずつ)
  expect(groups).toHaveLength(12);
  expect(groups.slice(0, 2)).toEqual(["g1", "g1"]);
  const distinct = [...new Set(groups)];
  expect(distinct).toHaveLength(6);
  distinct.forEach(group => expect(groups.filter(item => item === group)).toHaveLength(2));
  expect(groups.slice(2).every(group => group !== "g1" && group !== "gu")).toBe(true);
});

test("新規要素の既定寸法は接続点がグリッドに乗り、既存図面の寸法は変えない", async ({ page }) => {
  await installPage(page, []);
  const result = await page.evaluate(() => {
    const api = window.__edsTest;
    const onGrid = value => Math.abs(value - Math.round(value / 2.5) * 2.5) < 0.011;
    const offGrid = {};
    ["rect", "circle", "ellipse", "buzzer", "cableMarker", "cableBundle", "connector", "terminalBox"].forEach(type => {
      const element = api.defaultElementAtPlacement(type, 100, 85);
      let anchors = api.elementConnectionAnchors(element);
      // 円・楕円の45度方向の点は幾何的にグリッドへ乗らないので、上下左右の4点を検査する
      if (element.type === "circle") anchors = anchors.filter((_, index) => index % 2 === 0);
      offGrid[type] = anchors.filter(anchor => !onGrid(anchor.x) || !onGrid(anchor.y)).map(anchor => [anchor.x, anchor.y]);
    });
    const sizes = Object.fromEntries(["rect", "circle", "ellipse", "buzzer", "cableMarker", "cableBundle", "connector"].map(type => {
      const element = api.defaultElement(type, 0, 0);
      return [type, [element.w, element.h]];
    }));
    const newBox = api.defaultElement("terminalBox", 0, 0);
    // 引き出し線長が未指定の既存端子箱は従来の6mmのまま
    const legacyBox = { id: "legacy", type: "terminalBox", x: 0, y: 0, w: 22.5, h: 15, rows: 3, label: "TB" };
    const legacyAnchors = api.elementConnectionAnchors(legacyBox).map(anchor => anchor.x);
    return { offGrid, sizes, newStub: newBox.boxStubLength, legacyMin: Math.min(...legacyAnchors), legacyMax: Math.max(...legacyAnchors) };
  });
  Object.entries(result.offGrid).forEach(([type, points]) => expect(points, type).toEqual([]));
  expect(result.sizes).toEqual({
    rect: [35, 20], circle: [20, 20], ellipse: [25, 15], buzzer: [12.5, 6],
    cableMarker: [27.5, 12], cableBundle: [32.5, 18], connector: [75, 10]
  });
  expect(result.newStub).toBe(5);
  expect(result.legacyMin).toBe(-6);
  expect(result.legacyMax).toBe(28.5);
});

test("機器箱に上下マージンだけを入れると端子ピッチ5mmで並び、既存コネクタは端子数を変えてもピッチを保つ", async ({ page }) => {
  await installPage(page, []);
  const result = await page.evaluate(() => {
    const api = window.__edsTest;
    const box = { ...api.defaultElementAtPlacement("deviceBox", 100, 85), id: "dev" };
    const legacyConnector = { id: "cn", type: "connector", x: 40, y: 150, w: 70, h: 10, count: 10, start: 1, prefix: "", orientation: "horizontal", terminalShape: "circle", label: "CN", layer: "symbols" };
    api.state.pages[0].elements = [box, legacyConnector];
    const set = (bind, value) => {
      const input = document.querySelector(`#selectionPanel [data-bind="${bind}"]`);
      input.value = String(value);
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    api.selectElement("dev");
    set("pinMargin", 5);
    const device = api.state.pages[0].elements.find(item => item.id === "dev");
    const deviceYs = [...new Set(api.elementConnectionAnchors(device).map(anchor => anchor.y))];
    api.selectElement("cn");
    set("count", 12);
    const connector = api.state.pages[0].elements.find(item => item.id === "cn");
    return { pinPitch: device.pinPitch, deviceYs, connectorW: connector.w };
  });
  expect(result.pinPitch).toBe(5);
  expect(result.deviceYs.slice(1).map((y, index) => Math.round((y - result.deviceYs[index]) * 100) / 100)).toEqual([5, 5, 5]);
  // 既存の7mmピッチのコネクタは12端子でも7mmピッチ(84mm)のまま。既存の端子から配線が外れない
  expect(result.connectorW).toBe(84);
});

test("部品検索: 整流器で整流用の部品が出て、JIS番号では既定デザインの部品が先頭になる", async ({ page }) => {
  const filter = page.locator("#paletteFilter");
  await filter.fill("整流器");
  const rectifier = await page.locator("#paletteGrid .palette-item").evaluateAll(nodes => nodes.map(node => node.dataset.type));
  expect(rectifier).toEqual(expect.arrayContaining(["diode", "powerSupply"]));

  await filter.fill("07-13-02");
  const jis = await page.locator("#paletteGrid .palette-item").evaluateAll(nodes => nodes.map(node => node.dataset.type));
  expect(jis[0]).toBe("contactor");
  expect(jis).toContain("contactNO");
  await filter.press("Enter");
  expect(await page.evaluate(() => window.__edsTest.getActiveTool())).toBe("contactor");
});
