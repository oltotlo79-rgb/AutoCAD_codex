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

const onGrid = value => Math.abs(value - Math.round(value / 2.5) * 2.5) < 0.011;

// 1ページだけの図面を読み込む(スナップON・2.5mmグリッド。frameVariant既定は白紙)。
async function installPage(page, elements = [], options = {}) {
  await page.evaluate(([items, opts]) => window.__edsTest.installProjectData({
    schemaVersion: 11,
    activePageId: "p",
    settings: { snap: true, objectSnap: true, grid: 2.5 },
    pages: [{
      id: "p", name: "P1", size: opts.size || "A3", orientation: opts.orientation || "landscape",
      frameVariant: opts.frameVariant || "blank", title: {}, elements: items
    }]
  }), [elements, options]);
}

// 用紙mm座標→画面座標(canvasPointの逆変換)。
async function moveMouseTo(page, x, y, steps = 3) {
  const point = await page.evaluate(([px, py]) => {
    const svg = document.querySelector("svg#canvas");
    const p = svg.createSVGPoint();
    p.x = px;
    p.y = py;
    const screen = p.matrixTransform(svg.getScreenCTM());
    return { x: screen.x, y: screen.y };
  }, [x, y]);
  await page.mouse.move(point.x, point.y, { steps });
}

// 右パネルの入力欄へ値を入れて確定(change)する。
async function setPanelField(page, bind, value) {
  const input = page.locator(`#selectionPanel [data-bind="${bind}"]`);
  await expect(input).toBeVisible();
  await input.evaluate((element, next) => {
    element.value = String(next);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function anchorsOf(page, id) {
  return page.evaluate(elementId => {
    const api = window.__edsTest;
    const element = api.state.pages[0].elements.find(item => item.id === elementId);
    return api.elementConnectionAnchors(element).map(anchor => [Math.round(anchor.x * 100) / 100, Math.round(anchor.y * 100) / 100]);
  }, id);
}

test("右パネルの「回転 deg」へ90の倍数を入れると右90°ボタンと同じ位置へ回り、接続ピンがグリッドに乗る", async ({ page }) => {
  await installPage(page);
  const expected = await page.evaluate(() => {
    const api = window.__edsTest;
    const pb = { ...api.defaultElementAtPlacement("pushButton", 100, 85), id: "pb" };
    api.state.pages[0].elements = [JSON.parse(JSON.stringify(pb))];
    api.setSelectionForTest(["pb"]);
    const read = () => api.elementConnectionAnchors(api.state.pages[0].elements[0]).map(anchor => [anchor.x, anchor.y]);
    const before = read();
    api.rotateSelected(90);
    const right = read();
    api.rotateSelected(90);
    const half = read();
    api.state.pages[0].elements = [pb];
    api.selectElement("pb");
    return { before, right, half };
  });
  await setPanelField(page, "rotation", 90);
  const viaField = await anchorsOf(page, "pb");
  // 旧実装は要素の左上を中心に回したため、接続ピンがグリッドから外れていた。
  expect(viaField).toEqual(expected.right);
  viaField.forEach(([x, y]) => {
    expect(onGrid(x)).toBe(true);
    expect(onGrid(y)).toBe(true);
  });
  await setPanelField(page, "rotation", 180);
  expect(await anchorsOf(page, "pb")).toEqual(expected.half);
  await setPanelField(page, "rotation", 0);
  expect(await anchorsOf(page, "pb")).toEqual(expected.before);

  // 90の倍数以外は従来どおり要素の原点(左上)まわりに角度だけ変わり、0へ戻すと元の位置へ戻る。
  const origin = await page.evaluate(() => {
    const element = window.__edsTest.state.pages[0].elements[0];
    return [element.x, element.y];
  });
  await setPanelField(page, "rotation", 30);
  const tilted = await page.evaluate(() => {
    const element = window.__edsTest.state.pages[0].elements[0];
    return { xy: [element.x, element.y], rotation: element.rotation };
  });
  expect(tilted).toEqual({ xy: origin, rotation: 30 });
  await setPanelField(page, "rotation", 0);
  expect(await anchorsOf(page, "pb")).toEqual(expected.before);
});

test("電流種別・操作機構の限定図記号は接続点がクリック点(グリッド)に合うように置かれる", async ({ page }) => {
  await installPage(page);
  const result = await page.evaluate(() => {
    const api = window.__edsTest;
    const out = [];
    [["qualifierMark", "dc"], ["qualifierMark", "threePhase"], ["operatorMark", "manual"], ["operatorMark", "rotate"], ["operatorMark", "positive"]]
      .forEach(([type, variant]) => {
        const element = api.defaultElementAtPlacement(type, 102.5, 85);
        element.symbolVariant = variant;
        const anchors = api.elementConnectionAnchors(element).map(anchor => [Math.round(anchor.x * 100) / 100, Math.round(anchor.y * 100) / 100]);
        out.push({ type, variant, anchors });
      });
    return out;
  });
  result.forEach(item => {
    // 旧実装は左上をクリック点へ置いたため、接続点が(106.5, 91)/(106.5, 93)へずれていた。
    expect(item.anchors, item.type + "/" + item.variant).toEqual([[102.5, 85]]);
  });
  // パレットから実際にクリックして置いても同じ。
  await page.evaluate(() => window.__edsTest.setActiveTool("operatorMark"));
  await moveMouseTo(page, 120, 60, 1);
  await page.mouse.down();
  await page.mouse.up();
  const placed = await page.evaluate(() => {
    const api = window.__edsTest;
    const element = api.state.pages[0].elements.find(item => item.type === "operatorMark");
    return api.elementConnectionAnchors(element).map(anchor => [anchor.x, anchor.y]);
  });
  expect(placed).toEqual([[120, 60]]);
});

test("ピル形の端子台は7.5mmピッチ・奥行き10mmで並び、端子と端子記号の接続点がグリッドに乗る", async ({ page }) => {
  await installPage(page);
  await page.evaluate(() => {
    const api = window.__edsTest;
    const strip = { ...api.defaultElementAtPlacement("terminalStrip", 100, 50), id: "tb", count: 4, terminalMarkRight: true };
    strip.h = 4 * 9.5 + 9.5;
    api.state.pages[0].elements = [strip];
    api.selectElement("tb");
  });
  const allOnGrid = anchors => anchors.every(([x, y]) => onGrid(x) && onGrid(y));
  const firstNode = () => page.evaluate(() => {
    const api = window.__edsTest;
    const pin = api.elementFirstPin(api.state.pages[0].elements[0]);
    return [pin.x, pin.y];
  });
  const nodeBefore = await firstNode();

  // ユニット列→ピル形(縦)
  await page.locator('#selectionPanel [data-bind="stripStyle"]').selectOption("");
  let shape = await page.evaluate(() => {
    const element = window.__edsTest.state.pages[0].elements[0];
    return { w: element.w, h: element.h };
  });
  // 旧実装は8mmピッチ・幅12mmで、2個目以降の端子と左右の端子記号がグリッドから外れていた。
  expect(shape).toEqual({ w: 10, h: 30 });
  expect(await firstNode()).toEqual(nodeBefore);
  let anchors = await anchorsOf(page, "tb");
  expect(anchors.length).toBeGreaterThanOrEqual(8);
  expect(allOnGrid(anchors)).toBe(true);

  // ピル形(横)
  await page.locator('#selectionPanel [data-bind="orientation"]').selectOption("horizontal");
  shape = await page.evaluate(() => {
    const element = window.__edsTest.state.pages[0].elements[0];
    return { w: element.w, h: element.h };
  });
  expect(shape).toEqual({ w: 30, h: 10 });
  anchors = await anchorsOf(page, "tb");
  expect(allOnGrid(anchors)).toBe(true);

  // 既存図面の8mmピッチのピル形は、端子数を変えてもそのピッチと奥行きのまま並べ直す(配線が外れない)。
  await page.evaluate(() => {
    const api = window.__edsTest;
    api.state.pages[0].elements = [{
      id: "old", type: "terminalStrip", x: 50, y: 40, w: 12, h: 32, count: 4, start: 1, prefix: "",
      orientation: "vertical", terminalShape: "circle", stripStyle: "", label: "TB2", layer: "symbols"
    }];
    api.selectElement("old");
  });
  const oldBefore = await anchorsOf(page, "old");
  await setPanelField(page, "count", 5);
  const oldShape = await page.evaluate(() => {
    const element = window.__edsTest.state.pages[0].elements[0];
    return { w: element.w, h: element.h };
  });
  expect(oldShape).toEqual({ w: 12, h: 40 });
  const oldAfter = await anchorsOf(page, "old");
  expect(oldAfter.slice(0, 4)).toEqual(oldBefore);
});

test("コの字で確定時に終点が4mm以内のピンへ吸着しても、端の線分は斜めにならず折れ点が追従する", async ({ page }) => {
  await installPage(page, [], { size: "A4", orientation: "portrait" });
  // 左ピン(90,82.5)の接点。ドラッグの終点(87.5,80)から3.5mmなので確定時に吸着する。
  await page.evaluate(() => {
    const api = window.__edsTest;
    const contact = { ...api.defaultElementAtPlacement("contactNO", 95, 82.5), id: "k1" };
    api.state.pages[0].elements = [contact];
    api.setSelectionForTest([]);
  });
  expect((await anchorsOf(page, "k1"))[0]).toEqual([90, 82.5]);
  await page.evaluate(() => window.__edsTest.setActiveTool("wire"));
  await moveMouseTo(page, 50, 50, 1);
  await page.mouse.down();
  await moveMouseTo(page, 80, 50);
  await moveMouseTo(page, 87.5, 80);
  await page.keyboard.press("Space");
  const drawing = await page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.type === "wire").points);
  expect(drawing).toEqual([[50, 50], [70, 50], [70, 80], [87.5, 80]]);
  await page.mouse.up();
  const points = await page.evaluate(() => window.__edsTest.state.pages[0].elements.find(item => item.type === "wire").points);
  // 旧実装は [70,80]→[90,82.5] の斜め線分が残っていた。
  expect(points).toEqual([[50, 50], [70, 50], [70, 82.5], [90, 82.5]]);
  points.slice(1).forEach((point, index) => {
    const prev = points[index];
    expect(Math.abs(point[0] - prev[0]) < 0.01 || Math.abs(point[1] - prev[1]) < 0.01).toBe(true);
  });
});

test("ラダー図枠の行に置いた部品は右90°×4・左90°×4・右→左で元の行へ正確に戻る(ピンが中心線上にない部品も)", async ({ page }) => {
  test.setTimeout(180_000);
  await installPage(page, [], { frameVariant: "ladder" });
  const result = await page.evaluate(() => {
    const api = window.__edsTest;
    const types = [...new Set(Array.from(document.querySelectorAll("#paletteGrid [data-type]")).map(node => node.dataset.type))]
      .filter(type => !type.includes(":"));
    const drawingPage = api.state.pages[0];
    const failures = [];
    const gridOk = value => Math.abs(value - Math.round(value / 2.5) * 2.5) < 0.011;
    const rowOk = value => Math.abs(value - (27 + 9.5 * Math.round((value - 27) / 9.5))) < 0.011;
    const cases = types.map(type => [type, 36.5]);
    // 行とグリッド線のずれが逆向きの行(46→45)でも確かめる。
    ["inductor", "footSwitch", "thermalElement", "proximitySwitch", "deviceBox", "plcBlock"].forEach(type => cases.push([type, 46]));
    let checked = 0;
    cases.forEach(([type, rowY]) => {
      const placed = api.defaultElementAtPlacement(type, 100, rowY);
      if (placed.points || !api.elementConnectionAnchors(placed).length) return;
      const reset = () => {
        drawingPage.elements = [JSON.parse(JSON.stringify(placed))];
        api.setSelectionForTest([placed.id]);
        return drawingPage.elements[0];
      };
      const anchors = element => api.elementConnectionAnchors(element).map(anchor => [anchor.x, anchor.y]);
      const firstPin = element => {
        const pin = api.elementFirstPin(element);
        return [pin.x, pin.y];
      };
      const startPin = firstPin(reset());
      if (!gridOk(startPin[0]) || !(gridOk(startPin[1]) || rowOk(startPin[1]))) return;
      checked += 1;
      const base = anchors(reset());
      const same = list => list.length === base.length
        && list.every((point, index) => Math.abs(point[0] - base[index][0]) < 0.011 && Math.abs(point[1] - base[index][1]) < 0.011);
      let element = reset();
      for (let i = 1; i <= 4; i++) {
        api.rotateSelected(90);
        const pin = firstPin(element);
        const stayed = Math.abs(pin[0] - startPin[0]) < 0.011 && Math.abs(pin[1] - startPin[1]) < 0.011;
        if (i % 2 === 1 && !stayed) {
          // 縦向きの途中段階では第1ピンがグリッドに乗る(行へ寄せない)。中心に接続点がある部品はピンが動かない。
          if (!gridOk(pin[0]) || !gridOk(pin[1])) failures.push(type + "@" + rowY + " 右90°×" + i + " 第1ピンがグリッド外: " + JSON.stringify(pin));
        }
      }
      if (!same(anchors(element))) failures.push(type + "@" + rowY + " 右90°×4: " + JSON.stringify(firstPin(element)) + " / " + JSON.stringify(startPin));
      element = reset();
      for (let i = 0; i < 4; i++) api.rotateSelected(-90);
      if (!same(anchors(element))) failures.push(type + "@" + rowY + " 左90°×4: " + JSON.stringify(firstPin(element)) + " / " + JSON.stringify(startPin));
      element = reset();
      api.rotateSelected(90);
      api.rotateSelected(-90);
      if (!same(anchors(element))) failures.push(type + "@" + rowY + " 右→左: " + JSON.stringify(firstPin(element)) + " / " + JSON.stringify(startPin));
    });
    return { failures, checked };
  });
  expect(result.checked).toBeGreaterThan(55);
  // 旧実装はリアクトル・フットスイッチ等が1.5〜4mm行からずれて戻っていた。
  expect(result.failures).toEqual([]);

  // 180°(指定回転・回転欄)は右90°×2回と同じ位置になり、接続ピンが中心線から少し外れた部品も同じ行に残る。
  const halfTurns = await page.evaluate(() => {
    const api = window.__edsTest;
    const drawingPage = api.state.pages[0];
    return ["pushButton", "breaker", "footSwitch", "limitSwitch"].map(type => {
      const placed = api.defaultElementAtPlacement(type, 100, 36.5);
      const run = turns => {
        drawingPage.elements = [JSON.parse(JSON.stringify(placed))];
        api.setSelectionForTest([placed.id]);
        turns.forEach(degrees => api.rotateSelected(degrees));
        return api.elementConnectionAnchors(drawingPage.elements[0]).map(anchor => [anchor.x, anchor.y]);
      };
      return { type, twice: run([90, 90]), half: run([180]) };
    });
  });
  halfTurns.forEach(item => {
    expect(item.half, item.type).toEqual(item.twice);
    expect(item.half[0][1], item.type).toBe(36.5);
  });

  // 中心に接続点がある端子は、縦向きの途中段階でも接続点が行(36.5)から動かない。
  const terminalSteps = await page.evaluate(() => {
    const api = window.__edsTest;
    const terminal = { ...api.defaultElementAtPlacement("terminal", 100, 36.5), id: "t1" };
    api.state.pages[0].elements = [terminal];
    api.setSelectionForTest(["t1"]);
    const pin = () => {
      const point = api.elementFirstPin(api.state.pages[0].elements[0]);
      return [point.x, point.y];
    };
    const steps = [pin()];
    for (let i = 0; i < 4; i++) {
      api.rotateSelected(90);
      steps.push(pin());
    }
    return steps;
  });
  terminalSteps.forEach(point => expect(point).toEqual([100, 36.5]));
});
