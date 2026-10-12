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

// 用紙(内部座標はY下向き)。右パネルの「Y（上が＋）」は 用紙高さ − 内部Y。
const PAGES = {
  a4p: { size: "A4", orientation: "portrait", frameVariant: "blank", height: 297 },
  a4l: { size: "A4", orientation: "landscape", frameVariant: "blank", height: 210 },
  ladder: { size: "A4", orientation: "portrait", frameVariant: "ladder", height: 297 }
};

// 機能メニューの生成・挿入ダイアログ。yFields=[入力欄, ラベル, 従来の既定値(内部Y=上端から)]。
const DIALOGS = {
  wireColumn: {
    button: "#applyWireColumnBtn",
    yFields: [["#wireColumnY1", "上端Y mm（上が＋）", 42.5], ["#wireColumnY2", "下端Y mm（上が＋）", { a4p: 240, a4l: 152.5, ladder: 217.5 }]]
  },
  wireRow: { button: "#applyWireRowBtn", yFields: [["#wireRowY", "開始Y mm（上が＋）", 55]] },
  twistedPair: { button: "#twBuildBtn", yFields: [["#twY", "開始Y mm（上が＋）", 80]] },
  motorCircuit: { button: "#mcBuildBtn", yFields: [["#mcY", "1相目Y mm（上が＋）", 65]] },
  dinRail: { button: "#dinBuild", yFields: [["#dinY", "Y mm（上が＋）", 60]] },
  insertUserCircuit: { button: "#userCircuitInsert", yFields: [["#userCircuitY", "Y mm（上が＋）", 40]] },
  cableFan: { button: "#fanApply", yFields: [["#fanY", "開始Y mm（上が＋）", 50]] }
};

// 変更前(Yを上端から測っていた版)のmainで、各ダイアログを既定値のまま実行して記録した作図結果。
// 「種別 x,y 幅x高さ」または「種別 点1 点2 …」。縦配線列・横配線行は用紙で既定値が変わるので用紙別。
const OLD_DEFAULT_OUTPUT = {
  twistedPair: [
    "wire 40,80 100,80", "arrow 35,80 40,80", "wire 40,85 100,85", "arrow 35,85 40,85", "wire 40,90 100,90",
    "arrow 35,90 40,90", "wire 40,95 100,95", "arrow 35,95 40,95", "circle 48,77.5 4x20", "circle 88,77.5 4x20",
    "line 52.5,80 67.5,95", "line 52.5,95 67.5,80", "line 72.5,80 87.5,95", "line 72.5,95 87.5,80",
    "line 50,77.5 90,77.5", "line 50,97.5 90,97.5"
  ],
  motorCircuit: [
    "motor 134.1,62 16x16", "breaker 45,62 12.5x5", "breaker 45,67 12.5x5", "breaker 45,72 12.5x5",
    "contactNO 67.5,62.8 10x4.4", "contactNO 67.5,67.8 10x4.4", "contactNO 67.5,72.8 10x4.4",
    "thermalElement 85,62 10x3", "thermalElement 85,67 10x3", "thermalElement 85,72 10x3", "wire 40,65 45,65",
    "wire 57.5,65 67.5,65", "wire 77.5,65 85,65", "wire 95,65 135,65", "wire 40,70 45,70", "wire 57.5,70 67.5,70",
    "wire 77.5,70 85,70", "wire 95,70 135,70", "wire 40,75 45,75", "wire 57.5,75 67.5,75", "wire 77.5,75 85,75",
    "wire 95,75 135,75", "mechanicalLink 51.15,66 51.15,76", "wire 147.5,77.5 147.5,85", "ground 145.5,85 4x5"
  ],
  dinRail: [
    "rect 30,60 150x7.5", "circle 34,62.75 2x2", "circle 44,62.75 2x2", "circle 54,62.75 2x2", "circle 64,62.75 2x2",
    "circle 74,62.75 2x2", "circle 84,62.75 2x2", "circle 94,62.75 2x2", "circle 104,62.75 2x2",
    "circle 114,62.75 2x2", "circle 124,62.75 2x2", "circle 134,62.75 2x2", "circle 144,62.75 2x2",
    "circle 154,62.75 2x2", "circle 164,62.75 2x2", "circle 174,62.75 2x2"
  ],
  insertUserCircuit: [
    "coil 30,40 10x4.4", "contactNO 45,40 10x4.4"
  ],
  cableFan: [
    "wire 30,50 65,50 115,50 150,50", "wire 30,57.5 65,57.5 115,57.5 150,57.5", "wire 30,65 65,65 115,65 150,65",
    "wire 30,72.5 65,72.5 115,72.5 150,72.5", "cableMarker 76.25,55.25 27.5x12"
  ],
  "a4p:wireColumn": [
    "wire 30,42.5 30,240", "wire 42.5,42.5 42.5,240", "wire 55,42.5 55,240", "wire 67.5,42.5 67.5,240",
    "wire 80,42.5 80,240", "wire 92.5,42.5 92.5,240", "wire 105,42.5 105,240", "wire 117.5,42.5 117.5,240"
  ],
  "a4p:wireRow": [
    "wire 27.5,55 182.5,55", "wire 27.5,67.5 182.5,67.5", "wire 27.5,80 182.5,80", "wire 27.5,92.5 182.5,92.5",
    "wire 27.5,105 182.5,105", "wire 27.5,117.5 182.5,117.5"
  ],
  "a4l:wireColumn": [
    "wire 30,42.5 30,152.5", "wire 42.5,42.5 42.5,152.5", "wire 55,42.5 55,152.5", "wire 67.5,42.5 67.5,152.5",
    "wire 80,42.5 80,152.5", "wire 92.5,42.5 92.5,152.5", "wire 105,42.5 105,152.5", "wire 117.5,42.5 117.5,152.5"
  ],
  "a4l:wireRow": [
    "wire 27.5,55 270,55", "wire 27.5,67.5 270,67.5", "wire 27.5,80 270,80", "wire 27.5,92.5 270,92.5",
    "wire 27.5,105 270,105", "wire 27.5,117.5 270,117.5"
  ],
  "ladder:wireColumn": [
    "wire 30,42.5 30,217.5", "wire 42.5,42.5 42.5,217.5", "wire 55,42.5 55,217.5", "wire 67.5,42.5 67.5,217.5",
    "wire 80,42.5 80,217.5", "wire 92.5,42.5 92.5,217.5", "wire 105,42.5 105,217.5", "wire 117.5,42.5 117.5,217.5"
  ],
  "ladder:wireRow": [
    "wire 27.5,55 182.5,55", "wire 27.5,67.5 182.5,67.5", "wire 27.5,80 182.5,80", "wire 27.5,92.5 182.5,92.5",
    "wire 27.5,105 182.5,105", "wire 27.5,117.5 182.5,117.5"
  ]
};

// 1ページだけの図面を読み込み、挿入用のユーザー回路(左上=(0,0)のコイル+a接点)を1件登録する。
async function installSheet(page, pageKey, elements = []) {
  const { height, ...pageDef } = PAGES[pageKey];
  await page.evaluate(([pageDef, elements]) => {
    const api = window.__edsTest;
    api.installProjectData({
      schemaVersion: 4, activePageId: "p1", cables: [],
      settings: { snap: true, objectSnap: true, grid: 2.5 },
      pages: [{ id: "p1", name: "P1", title: {}, elements, ...pageDef }]
    });
    api.state.userCircuits = [{
      id: "uc1", name: "回路A", w: 25, h: 7,
      elements: [
        { ...api.defaultElement("coil", 0, 0), id: "t1", label: "" },
        { ...api.defaultElement("contactNO", 15, 0), id: "t2", label: "" }
      ]
    }];
    api.setSelectionForTest([]);
  }, [pageDef, elements]);
}

// 既存要素以外(=今回生成した要素)の位置を「種別 x,y 幅x高さ」/「種別 点1 点2 …」で返す。
function createdSignatures(page, existingIds = []) {
  return page.evaluate(existingIds => window.__edsTest.state.pages[0].elements
    .filter(item => !existingIds.includes(item.id))
    .map(item => item.type + " " + (Array.isArray(item.points)
      ? item.points.map(point => point.join(",")).join(" ")
      : item.x + "," + item.y + " " + item.w + "x" + item.h)), existingIds);
}

function createdElements(page, existingIds = []) {
  return page.evaluate(existingIds => JSON.parse(JSON.stringify(
    window.__edsTest.state.pages[0].elements.filter(item => !existingIds.includes(item.id)))), existingIds);
}

// 入力欄の直前のラベル文字。
function fieldLabel(page, selector) {
  return page.locator(selector).evaluate(input => input.previousElementSibling?.textContent.trim());
}

// 要素を選択し、右パネルの座標欄(Y上が＋)に表示された値を文字列のまま返す。
async function rightPanelY(page, id, bind) {
  await page.evaluate(id => window.__edsTest.selectElement(id), id);
  const value = await page.locator(`#selectionPanel [data-bind="${bind}"]`).inputValue();
  await page.evaluate(() => window.__edsTest.setSelectionForTest([]));
  return value;
}

test("生成・挿入ダイアログのY欄は「上が＋」で、既定値のまま生成すると従来と同じ位置に作図する", async ({ page }) => {
  test.setTimeout(60_000);
  for (const pageKey of ["a4p", "a4l", "ladder"]) {
    const { height } = PAGES[pageKey];
    for (const [action, dialog] of Object.entries(DIALOGS)) {
      // ラダー図枠で既定値が変わるのは縦配線列・横配線行だけ。
      if (pageKey === "ladder" && !["wireColumn", "wireRow"].includes(action)) continue;
      const context = pageKey + ":" + action;
      await installSheet(page, pageKey);
      await page.locator("#actionMenu").selectOption(action);
      await expect(page.locator("#dialogBackdrop"), context).toBeVisible();
      for (const [selector, label, internalDefault] of dialog.yFields) {
        const internal = typeof internalDefault === "number" ? internalDefault : internalDefault[pageKey];
        expect(await fieldLabel(page, selector), context).toBe(label);
        // 既定値は従来の内部Y(上端から)を右パネルと同じ「下端から上が＋」へ換算した値。
        expect(Number(await page.locator(selector).inputValue()), context + " " + selector).toBeCloseTo(height - internal, 6);
      }
      await page.locator(dialog.button).click();
      await expect(page.locator("#dialogBackdrop"), context).toBeHidden();
      const expected = OLD_DEFAULT_OUTPUT[context] || OLD_DEFAULT_OUTPUT[action];
      expect(await createdSignatures(page), context).toEqual(expected);
    }
  }
});

test("右パネルに表示されたYをそのまま入れると、その要素と同じ高さに生成・挿入する", async ({ page }) => {
  test.setTimeout(60_000);
  // 参照用: 横配線2本(始点Y=102.5と187.5)と文字(左上Y=152.5)。右端に置き、生成物と重ねない。
  const references = [
    { id: "refA", type: "wire", points: [[187.5, 102.5], [197.5, 102.5]], wireNo: "", layer: "wires" },
    { id: "refB", type: "wire", points: [[187.5, 187.5], [197.5, 187.5]], wireNo: "", layer: "wires" },
    { id: "refT", type: "text", x: 187.5, y: 152.5, w: 10, h: 5, text: "REF", fontSize: 3.5, layer: "notes" }
  ];
  const existingIds = references.map(item => item.id);
  const horizontalYs = elements => elements
    .filter(item => item.type === "wire" && item.points.length >= 2 && item.points[0][1] === item.points[item.points.length - 1][1])
    .map(item => item.points[0][1]);

  for (const pageKey of ["a4p", "a4l"]) {
    const { height } = PAGES[pageKey];
    await installSheet(page, pageKey, references);
    const yA = await rightPanelY(page, "refA", "p0y");
    const yB = await rightPanelY(page, "refB", "p0y");
    const yT = await rightPanelY(page, "refT", "y");
    // 右パネルの値は 用紙高さ − 内部Y(上が＋)。
    expect([yA, yB, yT].map(Number), pageKey).toEqual([height - 102.5, height - 187.5, height - 152.5]);

    const run = async (action, fills) => {
      await installSheet(page, pageKey, references);
      await page.locator("#actionMenu").selectOption(action);
      for (const [selector, value] of fills) await page.locator(selector).fill(value);
      await page.locator(DIALOGS[action].button).click();
      await expect(page.locator("#dialogBackdrop"), pageKey + ":" + action).toBeHidden();
      return createdElements(page, existingIds);
    };

    // 縦配線列: 上端=refA、下端=refBの高さ。
    let created = await run("wireColumn", [["#wireColumnY1", yA], ["#wireColumnY2", yB]]);
    expect(created[0].points, pageKey).toEqual([[30, 102.5], [30, 187.5]]);

    // 横配線行: 1本目がrefAの高さで、2本目以降は下へ(内部Yが増える向き)並ぶ。
    created = await run("wireRow", [["#wireRowY", yA], ["#wireRowCount", "3"]]);
    expect(horizontalYs(created), pageKey).toEqual([102.5, 115, 127.5]);

    // ツイストペア: 1本目の導体がrefAの高さ、以降は導体ピッチ5mmで下へ。
    created = await run("twistedPair", [["#twY", yA]]);
    expect(horizontalYs(created).slice(0, 4), pageKey).toEqual([102.5, 107.5, 112.5, 117.5]);

    // モータ分岐: 1相目の配線がrefAの高さ、2相目・3相目は5mm下。
    created = await run("motorCircuit", [["#mcY", yA]]);
    expect([...new Set(horizontalYs(created))].sort((a, b) => a - b), pageKey).toEqual([102.5, 107.5, 112.5]);

    // ケーブル展開: 1芯目がrefAの高さ、以降は芯間隔7.5mmで下へ。
    created = await run("cableFan", [["#fanY", yA]]);
    expect(horizontalYs(created), pageKey).toEqual([102.5, 110, 117.5, 125]);

    // DINレール: 外形の上辺(右パネルの「位置 Y」)が文字refTと同じ。
    created = await run("dinRail", [["#dinY", yT]]);
    expect(created.find(item => item.accessoryType === "rail").y, pageKey).toBe(152.5);

    // ユーザー回路: 回路全体の左上がrefTと同じ高さ。
    created = await run("insertUserCircuit", [["#userCircuitY", yT]]);
    expect(created.map(item => item.y), pageKey).toEqual([152.5, 152.5]);
  }
});

test("Y欄に任意の値を入れても、内部座標でグリッドへ揃えて生成する", async ({ page }) => {
  // A4縦の高さ297mmは2.5mmの倍数ではないため、Y=200(上が＋)は内部Y=97になる。スナップONでは97.5へ揃える。
  const onGrid = value => Math.abs(value / 2.5 - Math.round(value / 2.5)) < .001;
  const cases = [
    ["wireRow", "#wireRowY", items => items[0].points[0][1]],
    ["twistedPair", "#twY", items => items[0].points[0][1]],
    ["motorCircuit", "#mcY", items => items.find(item => item.type === "wire").points[0][1]],
    ["cableFan", "#fanY", items => items[0].points[0][1]],
    ["dinRail", "#dinY", items => items[0].y],
    ["insertUserCircuit", "#userCircuitY", items => items[0].y]
  ];
  for (const [action, selector, firstY] of cases) {
    await installSheet(page, "a4p");
    await page.locator("#actionMenu").selectOption(action);
    await page.locator(selector).fill("200");
    await page.locator(DIALOGS[action].button).click();
    const created = await createdElements(page);
    expect(firstY(created), action).toBe(97.5);
    const offGrid = created
      .filter(item => item.type === "wire")
      .flatMap(item => item.points)
      .filter(point => !onGrid(point[0]) || !onGrid(point[1]));
    expect(offGrid, action).toEqual([]);
  }

  // 縦配線列: 上端Y=200・下端Y=100(上が＋)は内部Y 97→97.5、197→197.5。
  await installSheet(page, "a4p");
  await page.locator("#actionMenu").selectOption("wireColumn");
  await page.locator("#wireColumnY1").fill("200");
  await page.locator("#wireColumnY2").fill("100");
  await page.locator("#applyWireColumnBtn").click();
  expect((await createdElements(page))[0].points).toEqual([[30, 97.5], [30, 197.5]]);

  // 上端Yに下端Y以下の値を入れると(上下が逆)、生成せずに知らせる。
  await installSheet(page, "a4p");
  await page.locator("#actionMenu").selectOption("wireColumn");
  await page.locator("#wireColumnY1").fill("100");
  await page.locator("#wireColumnY2").fill("200");
  await page.locator("#applyWireColumnBtn").click();
  await expect(page.locator("#status")).toContainText("作図範囲を越えます");
  expect(await createdElements(page)).toEqual([]);
});
