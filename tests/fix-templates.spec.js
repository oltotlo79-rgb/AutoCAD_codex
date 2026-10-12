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

// テンプレートを選び、ダイアログ型なら既定値のまま生成ボタンを押す。
async function addTemplate(page, option, setup) {
  await page.locator("#templateMenu").selectOption(option);
  if (setup) await setup();
  const button = page.locator("#dialogBackdrop:not(.hidden) #dialogBody .primary");
  if (await button.count()) await button.first().click();
  await page.evaluate(() => window.__edsTest.setSelectionForTest([]));
}

// 図面要素(data-id)内の文字・線の外接矩形を図面座標(mm)で返すヘルパをページへ注入する。
async function installGeometryHelpers(page) {
  await page.evaluate(() => {
    const toMm = node => {
      const svg = document.querySelector("svg#canvas");
      const matrix = svg.getScreenCTM().inverse().multiply(node.getScreenCTM());
      const box = node.getBBox();
      const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]
        .map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
      const xs = corners.map(point => point.x);
      const ys = corners.map(point => point.y);
      return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
    };
    window.__fixGeo = {
      toMm,
      textBoxes: value => [...document.querySelectorAll("#canvas g[data-id] text")]
        .filter(node => node.textContent === value)
        .map(node => ({ id: node.closest("g[data-id]").dataset.id, ...toMm(node) })),
      activePage: () => window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId)
    };
  });
}

test("右寄せ・中央寄せのテンプレート文字は意図した基準点に描かれる", async ({ page }) => {
  test.setTimeout(90_000);
  await addTemplate(page, "ladder");
  await installGeometryHelpers(page);
  const ladder = await page.evaluate(() => {
    const rungNumbers = Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(3, "0"))
      .map(value => window.__fixGeo.textBoxes(value)[0]);
    const center = box => (box.left + box.right) / 2;
    return {
      rungRights: rungNumbers.map(box => box.right),
      rungLefts: rungNumbers.map(box => box.left),
      lCenter: center(window.__fixGeo.textBoxes("L")[0]),
      nCenter: center(window.__fixGeo.textBoxes("N")[0]),
      textXs: window.__fixGeo.activePage().elements.filter(element => element.type === "text").map(element => element.x)
    };
  });
  // ラング番号は左母線(x=35)の左側、母線から18mmの位置で右揃え(配線や母線の内側へ食い込まない)。
  for (const right of ladder.rungRights) expect(right).toBeGreaterThan(16.3);
  for (const right of ladder.rungRights) expect(right).toBeLessThanOrEqual(17.2);
  for (const left of ladder.rungLefts) expect(left).toBeGreaterThan(12);
  expect(Math.abs(ladder.lCenter - 33)).toBeLessThan(0.5);
  expect(Math.abs(ladder.nCenter - 177)).toBeLessThan(0.5);
  expect(Math.min(...ladder.textXs)).toBeGreaterThanOrEqual(0);

  await page.goto(appUrl, { waitUntil: "load" });
  await addTemplate(page, "dcPower");
  await installGeometryHelpers(page);
  const rec = await page.evaluate(() => window.__fixGeo.textBoxes("REC1 OMRON S8VS-18024AP 180W")[0]);
  // REC型式は接地線(x=117.5)の左で x=112.5 に右揃えし、N1/P0分岐線(x=135/140)を横切らない。
  expect(rec.right).toBeLessThanOrEqual(113);
  expect(rec.right).toBeGreaterThan(111.5);
  expect(rec.left).toBeGreaterThan(67.5);

  for (const [option, center] of [["index", 102.5]]) {
    await page.goto(appUrl, { waitUntil: "load" });
    await addTemplate(page, option);
    await installGeometryHelpers(page);
    const box = await page.evaluate(() => window.__fixGeo.textBoxes("図面目次")[0]);
    expect(Math.abs((box.left + box.right) / 2 - center)).toBeLessThan(0.5);
  }

  await page.goto(appUrl, { waitUntil: "load" });
  await page.locator("#actionMenu").selectOption("indexGen");
  await installGeometryHelpers(page);
  const generated = await page.evaluate(() => {
    const table = window.__fixGeo.activePage().elements.find(element => element.type === "table");
    const box = window.__fixGeo.textBoxes("図面目次")[0];
    return { tableCenter: table.x + table.w / 2, textCenter: (box.left + box.right) / 2 };
  });
  expect(Math.abs(generated.textCenter - generated.tableCenter)).toBeLessThan(0.5);
});

test("v4以前の右寄せ・中央寄せ文字は保存当時の位置へ移行し、v5以降は変えない", async ({ page }) => {
  const result = await page.evaluate(() => {
    const elements = () => [
      { id: "end", type: "text", x: 17, y: 50, w: 24, h: 5, text: "001", fontSize: 2.6, align: "end" },
      { id: "middle", type: "text", x: 102.5, y: 31, w: 40, h: 6.8, text: "図面目次", fontSize: 4, align: "middle" },
      { id: "start", type: "text", x: 20, y: 26, w: 80, h: 8, text: "ラダー回路図", fontSize: 4 },
      { id: "rotated", type: "text", x: 60, y: 100, w: 20, h: 5, text: "R", fontSize: 2.5, align: "end", rotation: 90 }
    ];
    const project = version => ({
      schemaVersion: version,
      activePageId: "p1",
      pages: [{ id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements: elements() }]
    });
    const pick = data => Object.fromEntries(data.pages[0].elements.map(element => [element.id, [element.x, element.y]]));
    return { v3: pick(window.__edsTest.migrateProjectData(project(3))), v4: pick(window.__edsTest.migrateProjectData(project(4))), v5: pick(window.__edsTest.migrateProjectData(project(5))) };
  });
  const legacy = { end: [-7, 50], middle: [82.5, 31], start: [20, 26], rotated: [60, 80] };
  expect(result.v3).toEqual(legacy);
  expect(result.v4).toEqual(legacy);
  expect(result.v5).toEqual({ end: [17, 50], middle: [102.5, 31], start: [20, 26], rotated: [60, 100] });
});

test("遮断器の連動破線は先頭極から最終極まで全極の可動線を結ぶ", async ({ page }) => {
  test.setTimeout(120_000);
  const cases = [
    { name: "servo", option: "acMotor", poles: [3] },
    { name: "inverter", option: "acMotor", setup: async () => page.locator("#acDrive").selectOption("inverter"), poles: [3] },
    // ELB0(3極/単相2極)+CP0・CP01・CP1・CP2・CP3・CP4・CP11・CP12(各2極)。
    { name: "ac200", option: "acPower", poles: [3, 2, 2, 2, 2, 2, 2, 2, 2] },
    { name: "ac100", option: "acPower", setup: async () => page.locator("#acVolt").selectOption("100"), poles: [2, 2, 2, 2, 2, 2, 2, 2, 2] },
    { name: "dc", option: "dcPower", poles: [2, 2] },
    { name: "motorBranch", action: "motorCircuit", poles: [3] }
  ];
  for (const item of cases) {
    await page.goto(appUrl, { waitUntil: "load" });
    if (item.action) {
      await page.locator("#actionMenu").selectOption(item.action);
      await page.locator("#mcBuildBtn").click();
    } else {
      await addTemplate(page, item.option, item.setup);
    }
    const links = await page.evaluate(() => {
      const api = window.__edsTest;
      const current = api.state.pages.find(entry => entry.id === api.state.activePageId);
      // 各遮断器の可動線(軸に平行でない長い線)を図面座標で求める。
      const blades = current.elements.filter(element => element.type === "breaker").map(element => {
        const line = api.geoPrims(element).find(prim => prim.t === "line"
          && Math.abs(prim.p[0] - prim.p[2]) > .01 && Math.abs(prim.p[1] - prim.p[3]) > .01
          && Math.hypot(prim.p[2] - prim.p[0], prim.p[3] - prim.p[1]) > 3);
        return { id: element.id, a: [element.x + line.p[0], element.y + line.p[1]], b: [element.x + line.p[2], element.y + line.p[3]] };
      });
      const onSegment = (point, seg) => {
        const [ax, ay] = seg.a, [bx, by] = seg.b;
        const t = Math.max(0, Math.min(1, ((point[0] - ax) * (bx - ax) + (point[1] - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
        return Math.hypot(point[0] - (ax + t * (bx - ax)), point[1] - (ay + t * (by - ay))) < .05;
      };
      const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
      const intersects = (p1, p2, seg) => {
        const d1 = cross(p1, p2, seg.a), d2 = cross(p1, p2, seg.b), d3 = cross(seg.a, seg.b, p1), d4 = cross(seg.a, seg.b, p2);
        return (d1 * d2 <= 1e-9) && (d3 * d4 <= 1e-9);
      };
      return current.elements.filter(element => element.type === "mechanicalLink").map(link => {
        const [p1, p2] = [link.points[0], link.points[link.points.length - 1]];
        return {
          startOnBlade: blades.filter(blade => onSegment(p1, blade)).length,
          endOnBlade: blades.filter(blade => onSegment(p2, blade)).length,
          crossedPoles: blades.filter(blade => intersects(p1, p2, blade)).length
        };
      });
    });
    expect(links.map(link => link.crossedPoles), `${item.name}の連動破線が結ぶ極数`).toEqual(item.poles);
    for (const link of links) {
      expect(link.startOnBlade, `${item.name}の連動破線の始点`).toBe(1);
      expect(link.endOnBlade, `${item.name}の連動破線の終点`).toBe(1);
    }
  }
});

test("JIS形遮断器は定格(refNo)を✕と可動線に重ねず表示する", async ({ page }) => {
  test.setTimeout(60_000);
  await page.evaluate(() => window.__edsTest.installProjectData({
    schemaVersion: 10,
    activePageId: "p1",
    pages: [{
      id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {},
      elements: [
        { ...window.__edsTest.defaultElement("breaker", 40, 40), id: "cbH", label: "CP12", refNo: "10A" },
        { ...window.__edsTest.defaultElement("breaker", 80, 40), id: "cbV", label: "CB2", refNo: "10A", orientation: "vertical", w: 5, h: 12.5 }
      ]
    }]
  }));
  await installGeometryHelpers(page);
  const result = await page.evaluate(() => ["cbH", "cbV"].map(id => {
    const group = document.querySelector(`#canvas g[data-id="${id}"]`);
    const rating = [...group.querySelectorAll("text")].find(node => node.textContent === "10A");
    const label = [...group.querySelectorAll("text")].find(node => node.textContent !== "10A");
    if (!rating) return { id, shown: false };
    const box = window.__fixGeo.toMm(rating);
    const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > .05 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .05;
    // getBBoxは行送り込みの高さなので、文字どうしは上下20%を除いた字面の高さで比べる。
    const glyph = b => ({ ...b, top: b.top + (b.bottom - b.top) * .2, bottom: b.bottom - (b.bottom - b.top) * .2 });
    const lines = [...group.querySelectorAll("line")].map(node => window.__fixGeo.toMm(node));
    return { id, shown: true, hitsSymbol: lines.some(line => overlaps(glyph(box), line)), hitsLabel: overlaps(glyph(box), glyph(window.__fixGeo.toMm(label))) };
  }));
  expect(result).toEqual([
    { id: "cbH", shown: true, hitsSymbol: false, hitsLabel: false },
    { id: "cbV", shown: true, hitsSymbol: false, hitsLabel: false }
  ]);

  // テンプレートの定格(10A/3A/2A/1A)も既定のJIS形で図面に出る。
  await page.goto(appUrl, { waitUntil: "load" });
  await addTemplate(page, "acMotor");
  await expect(page.locator("#canvas g[data-type='breaker'] text", { hasText: /^10A$/ })).toHaveCount(1);
  await page.goto(appUrl, { waitUntil: "load" });
  await addTemplate(page, "dcPower");
  await expect(page.locator("#canvas g[data-type='breaker'] text", { hasText: /^3A$/ })).toHaveCount(1);
  await expect(page.locator("#canvas g[data-type='breaker'] text", { hasText: /^1A$/ })).toHaveCount(1);
});

test("非常停止チェーンの点線局枠はPBタグ文字を横切らず上下辺が方眼に乗る", async ({ page }) => {
  await page.locator("#actionMenu").selectOption("estopChain");
  await page.locator("#esBuildBtn").click();
  await installGeometryHelpers(page);
  const result = await page.evaluate(() => {
    const current = window.__fixGeo.activePage();
    const frames = current.elements.filter(element => element.type === "rect" && element.dash);
    const labels = ["PBE1", "PBE2", "PBE3"].flatMap(value => window.__fixGeo.textBoxes(value));
    const onGrid = value => Math.abs(value / 2.5 - Math.round(value / 2.5)) < .001;
    return {
      frameCount: frames.length,
      tops: frames.map(frame => frame.y),
      edgesOnGrid: frames.every(frame => onGrid(frame.y) && onGrid(frame.y + frame.h)),
      crossed: labels.filter(box => frames.some(frame => box.top < frame.y && box.bottom > frame.y)).length,
      labelCount: labels.length
    };
  });
  expect(result.frameCount).toBe(3);
  expect(result.tops).toEqual([37.5, 37.5, 37.5]);
  expect(result.edgesOnGrid).toBe(true);
  expect(result.labelCount).toBeGreaterThanOrEqual(3);
  expect(result.crossed).toBe(0);
});

test("AC電源・サーボ・インバータの小さな文字は配線・枠・巻線に掛からない", async ({ page }) => {
  test.setTimeout(90_000);
  await addTemplate(page, "acMotor", async () => page.locator("#acDrive").selectOption("inverter"));
  await installGeometryHelpers(page);
  const inverter = await page.evaluate(() => {
    const current = window.__fixGeo.activePage();
    const rects = current.elements.filter(element => element.type === "rect");
    const crossesEdge = box => rects.some(rect => {
      const edgesY = [rect.y, rect.y + rect.h].some(y => box.top < y && box.bottom > y && box.right > rect.x && box.left < rect.x + rect.w);
      const edgesX = [rect.x, rect.x + rect.w].some(x => box.left < x && box.right > x && box.bottom > rect.y && box.top < rect.y + rect.h);
      return edgesY || edgesX;
    });
    return ["FR-E720 0.4K", "CC-LINK"].map(value => crossesEdge(window.__fixGeo.textBoxes(value)[0]));
  });
  expect(inverter).toEqual([false, false]);

  await page.goto(appUrl, { waitUntil: "load" });
  await addTemplate(page, "acPower");
  await installGeometryHelpers(page);
  const ac = await page.evaluate(() => {
    const current = window.__fixGeo.activePage();
    const transformer = current.elements.find(element => element.type === "transformer");
    const windings = [...document.querySelectorAll(`#canvas g[data-id="${transformer.id}"] path`)].map(node => window.__fixGeo.toMm(node));
    const windingLeft = Math.min(...windings.map(box => box.left));
    const rating = window.__fixGeo.textBoxes("100VA")[0];
    const model = window.__fixGeo.textBoxes("TRH100-21S")[0];
    const label108 = window.__fixGeo.textBoxes("108")[0];
    const earthBlock = current.elements.find(element => element.type === "rect" && element.dash);
    return {
      rating: transformer.rating,
      catalog: transformer.catalog,
      ratingClear: rating.right < windingLeft,
      modelClear: model.right < rating.left,
      label108Clear: label108.right < 120,
      earthBlockRight: earthBlock.x + earthBlock.w
    };
  });
  expect(ac).toEqual({ rating: "100VA", catalog: "TRH100-21S", ratingClear: true, modelClear: true, label108Clear: true, earthBlockRight: 32.5 });

  await page.goto(appUrl, { waitUntil: "load" });
  await addTemplate(page, "acMotor");
  await installGeometryHelpers(page);
  const servo = await page.evaluate(() => ["N1", "P3M", "P24", "N24"]
    .flatMap(value => window.__fixGeo.textBoxes(value).filter(box => box.left < 40))
    .map(box => box.left > 30 && box.right < 35));
  expect(servo.length).toBeGreaterThanOrEqual(5);
  expect(servo.every(Boolean)).toBe(true);
});

test("インターロック接続ダイアログは「図枠」表記を使う", async ({ page }) => {
  await page.locator("#templateMenu").selectOption("interlock");
  await expect(page.locator("#dialogBody")).toContainText("図枠内に収まる10信号まで");
  await expect(page.locator("#dialogBody")).not.toContainText("設備図枠");
});

test("端子接続図と汎用ラダーは生成直後の監査で指摘が出ない", async ({ page }) => {
  test.setTimeout(60_000);
  for (const option of ["terminalSheet", "ladder"]) {
    await page.goto(appUrl, { waitUntil: "load" });
    await addTemplate(page, option);
    await page.locator("#auditBtn").click();
    const pageName = await page.evaluate(() => window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId).name);
    await expect(page.locator("#dialogBody tbody tr").filter({ hasText: pageName }), `${option}の監査指摘`).toHaveCount(0);
  }

  // 端子接続図の各行はP1母線へ接続せず、左端は端子小円で受ける。
  await page.goto(appUrl, { waitUntil: "load" });
  await addTemplate(page, "terminalSheet");
  const sheet = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    const rows = current.elements.filter(element => element.type === "wire" && /^W\d+$/.test(element.wireNo || ""));
    return {
      rowStarts: [...new Set(rows.map(wire => wire.points[0][0]))],
      railJunctions: current.elements.filter(element => element.type === "junction" && element.x === 32.5).length,
      leadTerminals: current.elements.filter(element => element.type === "terminal" && element.x + 0.9 === 37.5).length
    };
  });
  expect(sheet).toEqual({ rowStarts: [37.5], railJunctions: 0, leadTerminals: 16 });
});

test("空きラングは母線と結合せず、部品を入れて分割したラングは通常どおり監査される", async ({ page }) => {
  test.setTimeout(60_000);
  const rail = (id, x, side) => ({ id, type: "wire", points: [[x, 45], [x, 240]], wireNo: "", hideWireNo: true, ladderRail: side, layer: "wires" });
  const rung = (id, y, wireNo, points) => ({ id, type: "wire", points: points || [[35, y], [175, y]], wireNo, ladderRung: true, rungNo: wireNo.slice(1), layer: "wires" });
  const project = elements => ({
    schemaVersion: 10,
    activePageId: "p1",
    pages: [{ id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: { title: "ラダー" }, elements }]
  });
  const auditRows = async () => {
    await page.locator("#auditBtn").click();
    const rows = await page.locator("#dialogBody tbody tr").allInnerTexts();
    await page.locator("#dialogClose").click();
    return rows;
  };

  await page.evaluate(data => window.__edsTest.installProjectData(data), project([
    rail("L", 35, "left"), rail("N", 175, "right"), rung("r1", 55, "R001"), rung("r2", 70, "R002"), rung("r3", 85, "R003")
  ]));
  expect(await auditRows()).toEqual([]);

  // 1・2行目へ部品を入れた(配線が分割された)状態: 左側の線は同じL母線の電位なので線番の混在を指摘する。
  await page.evaluate(data => window.__edsTest.installProjectData(data), project([
    rail("L", 35, "left"), rail("N", 175, "right"),
    rung("r1a", 55, "R001", [[35, 55], [60, 55]]), rung("r1b", 55, "R001", [[70, 55], [175, 55]]),
    rung("r2a", 70, "R002", [[35, 70], [60, 70]]), rung("r2b", 70, "R002", [[70, 70], [175, 70]]),
    rung("r3", 85, "R003")
  ]));
  const rows = await auditRows();
  expect(rows.some(row => row.includes("同一ネット内で線番が混在") && row.includes("R001") && row.includes("R002"))).toBe(true);
  expect(rows.some(row => row.includes("R003"))).toBe(false);
});

test("AC電源回路（モータ）ダイアログは方式別の項目を明示し、モータ型式の既定も切り替える", async ({ page }) => {
  await page.locator("#templateMenu").selectOption("acMotor");
  const labelOf = id => page.locator(`label:has(+ #${id})`);
  await expect(labelOf("acMotor1Name")).toHaveText("モータ1名称（サーボ時）");
  await expect(labelOf("acMotor2Name")).toHaveText("モータ2名称（サーボ時）");
  await expect(labelOf("acInvTag")).toHaveText("インバータタグ（インバータ時）");
  await expect(labelOf("acInvModel")).toHaveText("インバータ型式（インバータ時）");
  await expect(page.locator("#acMotorModel")).toHaveValue("0.2kW 三菱電機 HG-KR23BK");
  await page.locator("#acDrive").selectOption("inverter");
  await expect(page.locator("#acMotorModel")).toHaveValue("0.4kW 三相誘導電動機");
  await page.locator("#acDrive").selectOption("servo");
  await expect(page.locator("#acMotorModel")).toHaveValue("0.2kW 三菱電機 HG-KR23BK");

  // 利用者が入力した型式は方式を切り替えても上書きしない。
  await page.locator("#acMotorModel").fill("1.5kW 特注");
  await page.locator("#acDrive").selectOption("inverter");
  await expect(page.locator("#acMotorModel")).toHaveValue("1.5kW 特注");
  await page.locator("#acMotorModel").fill("0.4kW 三相誘導電動機");
  await page.locator("#acMotorBuildBtn").click();
  const description = await page.evaluate(() => window.__edsTest.state.pages
    .find(item => item.id === window.__edsTest.state.activePageId).elements.find(element => element.type === "motor").description);
  expect(description).toBe("0.4kW 三相誘導電動機");
});

// confirm/promptへ順に答える。true/false=confirmのOK/キャンセル、文字列=promptの入力。
function answerDialogs(page, answers) {
  const queue = [...answers];
  const handler = async dialog => {
    const answer = queue.shift();
    if (!queue.length) page.off("dialog", handler);
    if (dialog.type() === "prompt") await dialog.accept(String(answer));
    else if (answer) await dialog.accept();
    else await dialog.dismiss();
  };
  page.on("dialog", handler);
}

test("極ごとに描いた多極機器は2極目以降が1極目のタグを共有し、採番・重複監査・BOMで別部品にならない", async ({ page }) => {
  test.setTimeout(60_000);
  await addTemplate(page, "acMotor");
  const poles = () => page.evaluate(() => window.__edsTest.state.pages
    .find(item => item.id === window.__edsTest.state.activePageId).elements
    .filter(element => element.type === "breaker")
    .map(element => ({ tag: element.tag || "", label: element.label || "", subPole: Boolean(element.subPole) })));
  expect(await poles()).toEqual([
    { tag: "", label: "CB1", subPole: false },
    { tag: "CB1", label: "", subPole: true },
    { tag: "CB1", label: "", subPole: true }
  ]);

  // 未入力のみの採番: 2・3極目へ別番号(CB02等)を振らず、ラベルも描かない。
  answerDialogs(page, [true, false, "1"]);
  await page.locator("#actionMenu").selectOption("tagComponents");
  expect((await poles()).map(pole => [pole.tag, pole.label])).toEqual([["", "CB1"], ["CB1", ""], ["CB1", ""]]);
  await expect(page.locator("#canvas g[data-type='breaker'] text", { hasText: /^CB/ })).toHaveCount(1);

  await page.locator("#auditBtn").click();
  await expect(page.locator("#dialogBody tr").filter({ hasText: "同一部品種別で部品タグが重複" }).filter({ hasText: "CB1" })).toHaveCount(0);
  await page.locator("#dialogClose").click();

  await page.locator("#actionMenu").selectOption("bom");
  const breakerRow = page.locator("#dialogBody tbody tr").filter({ hasText: "CB1" }).first();
  await expect(breakerRow.locator("td").nth(5)).toHaveText("1");
  await page.locator("#dialogClose").click();

  // 上書き採番: 1極目の新しいタグへ2・3極目が追従する(ラベルは1極目だけ)。
  answerDialogs(page, [true, true, "1"]);
  await page.locator("#actionMenu").selectOption("tagComponents");
  const renumbered = await poles();
  expect(renumbered[0].tag).not.toBe("");
  expect(renumbered[0].label).toBe(renumbered[0].tag);
  expect(renumbered.slice(1)).toEqual([
    { tag: renumbered[0].tag, label: "", subPole: true },
    { tag: renumbered[0].tag, label: "", subPole: true }
  ]);
});
