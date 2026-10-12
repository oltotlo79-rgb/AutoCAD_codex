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
  // 線番採番の確認(全ページ/上書き)と開始番号は既定値のまま受け入れる。
  page.on("dialog", dialog => (dialog.type() === "prompt" ? dialog.accept(dialog.defaultValue() || "1") : dialog.accept()));

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

// 機能メニューの一括生成を既定値のまま実行する。
async function runGenerator(page, option, setup) {
  await page.locator("#actionMenu").selectOption(option);
  if (setup) await setup();
  await page.locator("#dialogBackdrop:not(.hidden) #dialogBody .primary").first().click();
  await page.evaluate(() => window.__edsTest.setSelectionForTest([]));
}

// 線番採番(全ページ・上書き・開始番号1)。
async function autoNumber(page) {
  await page.locator("#autoWireBtn").click();
  await page.evaluate(() => window.__edsTest.setSelectionForTest([]));
}

// 取扱説明書の共通サンプルと同じ電源投入回路(P1/N1の設備ラダー+SS1/PB1/CR1,CR2)。
async function addPowerOnSample(page) {
  await page.locator("#templateMenu").selectOption("facilityLadder");
  await page.locator("#ladRails").fill("P1");
  await page.locator("#ladRight").fill("N1");
  await page.locator("#ladBuildBtn").click();
  await runGenerator(page, "powerOn", async () => {
    await page.locator("#poRow").fill("1");
    await page.locator("#poKs").fill("SS1");
    await page.locator("#poPb").fill("PB1");
    await page.locator("#poCr").fill("CR1,CR2");
  });
}

// 図面上の文字の実際の字形範囲(インク範囲)と線分を図面mm座標で返すヘルパをページへ注入する。
// getBBox()は行送りの余白を含むため、配線のすぐ上の線番まで「重なり」と判定してしまう。
// 1文字ずつ getExtentOfChar() の位置へ canvas の measureText() で測った字形の上下左右を当てはめる。
async function installInkHelpers(page) {
  await page.evaluate(() => {
    const svg = document.querySelector("svg#canvas");
    const ctx = document.createElement("canvas").getContext("2d");
    const SCALE = 100;
    const toMm = node => svg.getScreenCTM().inverse().multiply(node.getScreenCTM());
    const current = () => window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    const ownerOf = node => node.closest("g[data-id]")?.dataset.id || null;
    const charBoxes = node => {
      const style = getComputedStyle(node);
      ctx.font = `${style.fontWeight} ${parseFloat(style.fontSize) * SCALE}px ${style.fontFamily}`;
      ctx.textBaseline = "alphabetic";
      const m = toMm(node);
      const boxes = [];
      for (let i = 0; i < node.getNumberOfChars(); i++) {
        const ch = node.textContent[i];
        if (!ch || !ch.trim()) continue;
        const ext = node.getExtentOfChar(i);
        const metrics = ctx.measureText(ch);
        const base = ext.y + metrics.fontBoundingBoxAscent / SCALE;
        const x1 = ext.x - metrics.actualBoundingBoxLeft / SCALE;
        const x2 = ext.x + metrics.actualBoundingBoxRight / SCALE;
        const y1 = base - metrics.actualBoundingBoxAscent / SCALE;
        const y2 = base + metrics.actualBoundingBoxDescent / SCALE;
        const corners = [[x1, y1], [x2, y1], [x1, y2], [x2, y2]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
        const xs = corners.map(point => point.x);
        const ys = corners.map(point => point.y);
        boxes.push({ left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) });
      }
      return boxes;
    };
    const union = boxes => ({
      left: Math.min(...boxes.map(box => box.left)),
      right: Math.max(...boxes.map(box => box.right)),
      top: Math.min(...boxes.map(box => box.top)),
      bottom: Math.max(...boxes.map(box => box.bottom))
    });
    // 図面に見えている文字(ラベル・文字要素・線番・端子名など)。
    const texts = () => [...svg.querySelectorAll("g[data-id] text")]
      .filter(node => node.textContent.trim() && getComputedStyle(node).display !== "none")
      .map(node => {
        const chars = charBoxes(node);
        const owner = ownerOf(node);
        const element = current().elements.find(item => item.id === owner);
        return {
          text: node.textContent,
          owner,
          ownerType: element?.type || "",
          // 記号の一部として描く固定文字(バリスタのU・説明文・参照番号など)は記号形状の一部。
          symbolPart: node.getAttribute("data-content-exempt") === "true",
          chars,
          box: chars.length ? union(chars) : null
        };
      })
      .filter(item => item.box);
    // 配線・母線・直線・矢印・連動線・矩形の線分(図面mm)。
    const segments = () => {
      const kinds = new Set(["wire", "line", "arrow", "mechanicalLink", "rect"]);
      const list = [];
      svg.querySelectorAll("g[data-id]").forEach(group => {
        const element = current().elements.find(item => item.id === group.dataset.id);
        if (!element || !kinds.has(element.type)) return;
        group.querySelectorAll(".wire-line, .symbol-line").forEach(node => {
          const m = toMm(node);
          const map = (x, y) => {
            const point = new DOMPoint(Number(x), Number(y)).matrixTransform(m);
            return [point.x, point.y];
          };
          const push = (a, b) => list.push({ owner: element.id, type: element.type, a, b });
          if (node.tagName === "line") {
            push(map(node.getAttribute("x1"), node.getAttribute("y1")), map(node.getAttribute("x2"), node.getAttribute("y2")));
          } else if (node.tagName === "rect") {
            const x = Number(node.getAttribute("x")), y = Number(node.getAttribute("y"));
            const w = Number(node.getAttribute("width")), h = Number(node.getAttribute("height"));
            const c = [map(x, y), map(x + w, y), map(x + w, y + h), map(x, y + h)];
            c.forEach((point, i) => push(point, c[(i + 1) % 4]));
          } else if (node.tagName === "polyline") {
            const pts = node.getAttribute("points").trim().split(/[\s,]+/).map(Number);
            for (let i = 2; i + 1 < pts.length; i += 2) push(map(pts[i - 2], pts[i - 1]), map(pts[i], pts[i + 1]));
          } else if (node.tagName === "path") {
            const d = node.getAttribute("d") || "";
            if (/[^MLml0-9.\s,-]/.test(d)) return;
            const tokens = d.match(/[ML]|-?\d*\.?\d+/g) || [];
            let last = null;
            for (let i = 0; i < tokens.length;) {
              const command = tokens[i++];
              const point = map(tokens[i++], tokens[i++]);
              if (command === "L" && last) push(last, point);
              last = point;
            }
          }
        });
      });
      return list;
    };
    // 線分が矩形(内側へ0.05mm縮めた範囲)を通るか(Liang-Barsky)。
    const crosses = (segment, box) => {
      const e = 0.05;
      const [x0, y0] = segment.a;
      const dx = segment.b[0] - x0, dy = segment.b[1] - y0;
      let t0 = 0, t1 = 1;
      const edges = [[-dx, x0 - (box.left + e)], [dx, (box.right - e) - x0], [-dy, y0 - (box.top + e)], [dy, (box.bottom - e) - y0]];
      for (const [p, q] of edges) {
        if (Math.abs(p) < 1e-9) {
          if (q < 0) return false;
        } else {
          const r = q / p;
          if (p < 0) t0 = Math.max(t0, r);
          else t1 = Math.min(t1, r);
          if (t0 > t1) return false;
        }
      }
      return true;
    };
    const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.02
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.02;
    // 文字が線分を横切る/他の文字と重なる箇所を「文字(所有種別) × 相手」の一覧で返す。
    const collisions = () => {
      const allTexts = texts();
      const lines = segments();
      const found = [];
      allTexts.filter(item => !item.symbolPart).forEach(item => {
        lines.forEach(segment => {
          if (item.chars.some(box => crosses(segment, box))) found.push(`${item.text}(${item.ownerType}) × ${segment.type}線`);
        });
      });
      for (let i = 0; i < allTexts.length; i++) {
        for (let j = i + 1; j < allTexts.length; j++) {
          const a = allTexts[i], b = allTexts[j];
          if (a.owner === b.owner || !overlap(a.box, b.box)) continue;
          if (a.chars.some(ca => b.chars.some(cb => overlap(ca, cb)))) found.push(`${a.text}(${a.ownerType}) × ${b.text}(${b.ownerType})`);
        }
      }
      return [...new Set(found)];
    };
    window.__labelGeo = { texts, segments, collisions, current };
  });
}

async function collisions(page) {
  await installInkHelpers(page);
  return page.evaluate(() => window.__labelGeo.collisions());
}

test("AC受電・分岐のFAN1は送風機の真上に付き、メインアースブロックは相レールを横切らない", async ({ page }) => {
  await addTemplate(page, "acPower");
  await installInkHelpers(page);
  const result = await page.evaluate(() => {
    const geo = window.__labelGeo;
    const current = geo.current();
    const fan = current.elements.find(item => item.type === "fan");
    const fl1 = current.elements.find(item => item.type === "lamp" && item.tag === "FL1");
    const all = geo.texts();
    const fanLabel = all.find(item => item.owner === fan.id && item.text === "FAN1").box;
    const fl1Label = all.find(item => item.owner === fl1.id && item.text === "FL1").box;
    // 送風機の円(中心=外形中央、半径r)。
    const circleTop = fan.y + fan.h / 2 - fan.r;
    const fanCenterX = fan.x + fan.w / 2;
    const earth = all.filter(item => ["メインアース", "ブロック"].includes(item.text)).map(item => item.box);
    const earthFrame = current.elements.find(item => item.type === "rect" && item.dash);
    const leaderLines = current.elements.filter(item => item.type === "line" && item.points.some(point => point[0] < 33) && item.points.some(point => point[0] > 34));
    return {
      gapToFan: circleTop - fanLabel.bottom,
      gapToFl1Row: fanLabel.top - (fl1.y + fl1.h / 2),
      fanLabelCenterOffset: Math.abs((fanLabel.left + fanLabel.right) / 2 - fanCenterX),
      fl1LabelAboveOwnLamp: fl1Label.bottom < fl1.y + fl1.h / 2,
      earthLines: earth.length,
      earthRight: Math.max(...earth.map(box => box.right)),
      earthLeft: Math.min(...earth.map(box => box.left)),
      earthTop: Math.min(...earth.map(box => box.top)),
      frameBottom: earthFrame.y + earthFrame.h,
      leaderLines: leaderLines.length
    };
  });
  // FAN1は円の上0.3〜2mmにあり、上段のFL1の行(配線)からは十分離れて送風機の名前と分かる。
  expect(result.gapToFan).toBeGreaterThan(0.3);
  expect(result.gapToFan).toBeLessThan(2);
  expect(result.gapToFl1Row).toBeGreaterThan(result.gapToFan * 3);
  expect(result.fanLabelCenterOffset).toBeLessThan(0.5);
  expect(result.fl1LabelAboveOwnLamp).toBe(true);
  // メインアースブロックは点線枠の直下、G母線(x=30)より左の2行で、R/S/T相レール(35/40/45)へ届かない。
  expect(result.earthLines).toBe(2);
  expect(result.earthRight).toBeLessThan(29.5);
  expect(result.earthLeft).toBeGreaterThan(15);
  expect(result.earthTop).toBeGreaterThan(result.frameBottom);
  expect(result.leaderLines).toBe(0);
  expect(await collisions(page)).toEqual([]);
});

test("電源投入回路は線番採番後もコイル→N1の線番を母線とCR1ラベルへ重ねない", async ({ page }) => {
  await addPowerOnSample(page);
  await autoNumber(page);
  await installInkHelpers(page);
  const result = await page.evaluate(() => {
    const geo = window.__labelGeo;
    const current = geo.current();
    const railN1 = current.elements.find(item => item.ladderRail === "N1");
    const railX = railN1.points[0][0];
    const coils = current.elements.filter(item => item.type === "coil");
    const stubs = current.elements.filter(item => item.type === "wire" && !item.ladderRail
      && item.points.some(point => Math.abs(point[0] - railX) < 0.01)
      && item.points.some(point => Math.abs(point[0] - 145) < 0.01));
    const wireIds = new Set(current.elements.filter(item => item.type === "wire").map(item => item.id));
    const numbers = geo.texts().filter(item => wireIds.has(item.owner));
    const labels = geo.texts().filter(item => coils.some(coil => coil.id === item.owner) && /^CR\d$/.test(item.text)).map(item => item.box);
    return {
      stubCount: stubs.length,
      stubNumbers: stubs.map(item => item.wireNo),
      stubHidden: stubs.map(item => item.hideWireNo === true),
      numbersCrossingRail: numbers.filter(item => item.box.left < railX && item.box.right > railX).map(item => item.text),
      numbersOnLabels: numbers.filter(item => labels.some(label => Math.min(label.right, item.box.right) > Math.max(label.left, item.box.left)
        && Math.min(label.bottom, item.box.bottom) > Math.max(label.top, item.box.top))).map(item => item.text),
      visibleNumbers: numbers.map(item => item.text).sort()
    };
  });
  // コイル→N1の2.5mmの引出しは線番データを持つが、図面には出さない(N1ネットは母線名で読む)。
  expect(result.stubCount).toBe(2);
  expect(result.stubNumbers.every(value => /^\d+-\d{2}$/.test(value))).toBe(true);
  expect(result.stubHidden).toEqual([true, true]);
  expect(result.numbersCrossingRail).toEqual([]);
  expect(result.numbersOnLabels).toEqual([]);
  // 線番そのものは他の配線で引き続き表示される(P1側・SS1→CR1・PB1→CR2)。
  expect(result.visibleNumbers.length).toBeGreaterThanOrEqual(3);
  expect(await collisions(page)).toEqual([]);
});

test("テンプレートの文字は生成直後も線番採番後も配線・枠線・他の文字に重ならない", async ({ page }) => {
  test.setTimeout(180_000);
  const templates = [
    ["facilityLadder"], ["acPower"], ["acPower", async () => page.locator("#acVolt").selectOption("100")],
    ["acMotor"], ["acMotor", async () => page.locator("#acDrive").selectOption("inverter")],
    ["dcPower"], ["plcPower"], ["safetyRelay"], ["plcInput"], ["interlock"], ["ladder"], ["index"], ["layout"]
  ];
  const problems = {};
  for (const [option, setup] of templates) {
    const name = option + (setup ? "*" : "");
    await page.goto(appUrl, { waitUntil: "load" });
    await addTemplate(page, option, setup);
    const fresh = await collisions(page);
    await autoNumber(page);
    const numbered = await collisions(page);
    if (fresh.length) problems[name] = fresh;
    if (numbered.length) problems[name + " 線番採番後"] = numbered;
  }
  expect(problems).toEqual({});
});

test("一括生成の文字は生成直後も線番採番後も配線・枠線・他の文字に重ならない", async ({ page }) => {
  test.setTimeout(180_000);
  const generators = ["rungCircuit", "estopChain", "powerOn", "brake", "wireColumn", "wireRow", "twistedPair", "motorCircuit", "plcUnit", "dinRail"];
  const problems = {};
  for (const option of generators) {
    await page.goto(appUrl, { waitUntil: "load" });
    await runGenerator(page, option);
    const fresh = await collisions(page);
    await autoNumber(page);
    const numbered = await collisions(page);
    if (fresh.length) problems[option] = fresh;
    if (numbered.length) problems[option + " 線番採番後"] = numbered;
  }
  expect(problems).toEqual({});
});

test("非常停止チェーン・ツイストペア・DINレールの線番と名称は記号から離して置く", async ({ page }) => {
  await runGenerator(page, "estopChain");
  await autoNumber(page);
  const estop = await page.evaluate(() => {
    const current = window.__edsTest.state.pages.find(item => item.id === window.__edsTest.state.activePageId);
    const wires = current.elements.filter(item => item.type === "wire");
    // PB→局境界端子の5mmは線番を出さない。表示灯ループの線番は横線の下へ下げる。
    const stubs = wires.filter(item => item.points.length === 2 && Math.abs(item.points[1][0] - item.points[0][0] - 5) < 0.01);
    const loops = wires.filter(item => item.points.length === 5);
    return { stubs: stubs.map(item => item.hideWireNo === true), loops: loops.map(item => [Boolean(item.wireNo), item.hideWireNo === true, item.wireNoDy]) };
  });
  expect(estop.stubs.length).toBe(6);
  expect(estop.stubs.every(Boolean)).toBe(true);
  expect(estop.loops).toEqual([[true, false, -3.6], [true, false, -3.6], [true, false, -3.6]]);

  await page.goto(appUrl, { waitUntil: "load" });
  await runGenerator(page, "twistedPair");
  await autoNumber(page);
  await installInkHelpers(page);
  const twisted = await page.evaluate(() => {
    const geo = window.__labelGeo;
    const current = geo.current();
    const ellipses = current.elements.filter(item => item.type === "circle");
    const leftEllipse = Math.min(...ellipses.map(item => item.x));
    const conductors = current.elements.filter(item => item.type === "wire");
    const numbers = geo.texts().filter(item => conductors.some(wire => wire.id === item.owner));
    return { count: numbers.length, maxRight: Math.max(...numbers.map(item => item.box.right)), leftEllipse, minLeft: Math.min(...numbers.map(item => item.box.left)), x0: Math.min(...conductors.map(wire => wire.points[0][0])) };
  });
  // 導体4本の線番は、シェブロン(x0)と左の楕円束の間に収まる。
  expect(twisted.count).toBe(4);
  expect(twisted.minLeft).toBeGreaterThan(twisted.x0);
  expect(twisted.maxRight).toBeLessThan(twisted.leftEllipse);

  await page.goto(appUrl, { waitUntil: "load" });
  await runGenerator(page, "dinRail");
  await installInkHelpers(page);
  const din = await page.evaluate(() => {
    const geo = window.__labelGeo;
    const current = geo.current();
    const rail = current.elements.find(item => item.type === "rect" && item.accessoryType === "rail");
    const label = geo.texts().find(item => item.owner === rail.id && item.text === "DINレール").box;
    const holes = current.elements.filter(item => item.type === "circle" && item.group === rail.group);
    return {
      labelAboveRail: label.bottom < rail.y,
      holesUnderLabel: holes.filter(hole => hole.x < label.right && hole.x + hole.w > label.left && hole.y < label.bottom && hole.y + hole.h > label.top).length
    };
  });
  expect(din).toEqual({ labelAboveRail: true, holesUnderLabel: 0 });
});
