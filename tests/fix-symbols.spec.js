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
  // page.evaluateへは関数を渡せないので、白紙1ページのプロジェクトを作る補助をページ側へ置く。
  await page.evaluate(() => {
    window.__blankProject = (elements, schemaVersion = 11) => ({
      schemaVersion,
      activePageId: "p",
      pages: [{ id: "p", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements }]
    });
  });
});

test.afterEach(async ({ page }) => {
  const issues = runtimeIssues.get(page);
  expect(issues?.consoleErrors ?? [], "console errorが発生していないこと").toEqual([]);
  expect(issues?.pageErrors ?? [], "page errorが発生していないこと").toEqual([]);
});

const blankProject = (elements, schemaVersion = 11) => ({
  schemaVersion,
  activePageId: "p",
  pages: [{ id: "p", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {}, elements }]
});

// 2.5mmグリッド上か(浮動小数の誤差は許容)
const onGrid = value => Math.abs(value / 2.5 - Math.round(value / 2.5)) < 1e-6;

test("トランジスタ・論理ゲートは既定デザインを持ち、右パネルとクイックプロパティに生のstandardを出さない", async ({ page }) => {
  const result = await page.evaluate(() => {
    const blank = window.__blankProject;
    const T = window.__edsTest;
    const defaults = { transistor: T.defaultElement("transistor", 30, 30).symbolVariant, logicGate: T.defaultElement("logicGate", 30, 30).symbolVariant };
    // 旧版で保存された(symbolVariant未設定の)トランジスタ・論理ゲートを読み込む
    const legacyTr = { ...T.defaultElement("transistor", 30, 30), id: "tr" };
    const legacyGate = { ...T.defaultElement("logicGate", 60, 30), id: "gate" };
    delete legacyTr.symbolVariant;
    delete legacyGate.symbolVariant;
    T.installProjectData(blank([legacyTr, legacyGate], 10));
    const loaded = Object.fromEntries(T.state.pages[0].elements.map(e => [e.id, e.symbolVariant]));
    const panelOptions = id => {
      T.selectElement(id);
      const select = document.querySelector('#selectionPanel select[data-bind="symbolVariant"]');
      return { values: Array.from(select.options).map(o => o.value), selected: select.value, text: select.selectedOptions[0].textContent };
    };
    return { defaults, loaded, tr: panelOptions("tr"), gate: panelOptions("gate") };
  });

  expect(result.defaults).toEqual({ transistor: "npn", logicGate: "and" });
  expect(result.loaded).toEqual({ tr: "npn", gate: "and" });
  expect(result.tr.values).not.toContain("standard");
  expect(result.tr.selected).toBe("npn");
  expect(result.tr.text).toBe("NPNトランジスタ（JIS 05-05-02・外囲みの円あり）");
  expect(result.gate.values).not.toContain("standard");
  expect(result.gate.selected).toBe("and");
  expect(result.gate.text).toBe("AND（&）");

  // クイックプロパティでも未設定値を既定デザインとして表示する(読込を経ない要素でも同じ)
  await page.evaluate(() => {
    const blank = window.__blankProject;
    const T = window.__edsTest;
    const bare = { ...T.defaultElement("transistor", 30, 30), id: "bare" };
    T.installProjectData(blank([bare]));
    delete T.state.pages[0].elements[0].symbolVariant;
    T.selectElement("bare");
  });
  await page.keyboard.press("q");
  const quick = page.locator("#quickVariant");
  await expect(quick).toBeVisible();
  expect(await quick.inputValue()).toBe("npn");
  expect(await quick.locator("option").evaluateAll(options => options.map(o => o.value))).not.toContain("standard");
});

test("symbolVariant未設定の補完は描画を変えない(既定デザインと同じ図形)", async ({ page }) => {
  const result = await page.evaluate(() => {
    const blank = window.__blankProject;
    const T = window.__edsTest;
    const types = ["transistor", "logicGate", "ground", "transformer", "qualifierMark", "operatorMark", "photoelectricSwitch", "proximitySwitch", "reedSwitch", "lightCurtain"];
    const elements = types.map((type, index) => {
      const element = { ...T.defaultElement(type, 20 + (index % 5) * 30, 30 + Math.floor(index / 5) * 40), id: type };
      delete element.symbolVariant;
      return element;
    });
    const shape = element => JSON.stringify(T.geoPrims(element));
    const before = Object.fromEntries(elements.map(element => [element.id, shape(element)]));
    T.installProjectData(blank(elements));
    return T.state.pages[0].elements.map(element => ({
      type: element.type,
      variant: element.symbolVariant || "",
      same: shape(element) === before[element.id],
      listed: T.SYMBOL_VARIANT_OPTIONS[element.type].some(([value]) => value === element.symbolVariant)
    }));
  });
  for (const item of result) {
    expect(item.variant, item.type).not.toBe("");
    expect(item.listed, item.type + "の補完値がデザイン候補にある").toBe(true);
    expect(item.same, item.type + "の図形が補完前後で同じ").toBe(true);
  }
});

test("配置直後の案内は実際の欄名で出し、非常停止以外の押しボタン・ブザー・端子も案内する", async ({ page }) => {
  const expected = {
    pushButton: "押しボタンを配置しました。右パネルの「シンボルデザイン」で形状を切り替えられます。",
    pushButtonEmergency: "非常停止ボタンを配置しました。右パネルの「シンボルデザイン」で形状を切り替えられます。",
    resistor: "抵抗を配置しました。右パネルの「抵抗形状」で形状を切り替えられます。",
    lamp: "ランプを配置しました。右パネルの「ランプ形状」で形状を切り替えられます。",
    buzzer: "ブザーを配置しました。右パネルの「ブザー形状」で形状を切り替えられます。",
    terminal: "端子を配置しました。右パネルの「端子形状」で形状を切り替えられます。"
  };
  for (const [type, message] of Object.entries(expected)) {
    await page.evaluate(([blank, tool]) => {
      window.__edsTest.installProjectData(blank);
      window.__edsTest.setActiveTool(tool);
    }, [blankProject([]), type]);
    await page.locator("svg#canvas").click({ position: { x: 300, y: 300 } });
    await expect(page.locator("#status"), type).toHaveText(message);
  }
});

test("非常停止ボタンの新規要素はキノコ形の本体寸法10×7mmで、接続点がグリッドに乗る", async ({ page }) => {
  const result = await page.evaluate(() => {
    const blank = window.__blankProject;
    const T = window.__edsTest;
    const fresh = T.defaultElement("pushButtonEmergency", 30, 30);
    T.installProjectData(blank([]));
    const placed = T.defaultElementAtPlacement("pushButtonEmergency", 41, 52.5);
    T.state.pages[0].elements.push(placed);
    const anchors = T.elementConnectionAnchors(placed).map(a => [a.x - placed.x, a.y - placed.y, a.x, a.y]);
    // 全デザインの本体寸法(右パネルで切り替えたときに付く寸法)と接続点の高さ
    const designs = T.SYMBOL_VARIANT_OPTIONS.pushButtonEmergency.map(([value]) => value)
      .filter(value => !/multi/i.test(value))
      .map(value => {
        const element = { ...fresh, symbolVariant: value };
        const prims = T.geoPrims(element);
        const ys = prims.flatMap(prim => prim.t === "line" ? [prim.p[1], prim.p[3]] : prim.t === "pline" ? prim.pts.map(pt => pt[1]) : prim.t === "circle" || prim.t === "arc" ? [prim.p[1] - prim.p[2], prim.p[1] + prim.p[2]] : []);
        return { value, top: Math.min(...ys), bottom: Math.max(...ys), pinY: T.elementConnectionAnchors({ ...element, x: 0, y: 0 })[0].y };
      });
    return { size: [fresh.w, fresh.h], pbStyle: fresh.pbStyle, anchors, designs, placedH: placed.h };
  });

  expect(result.size).toEqual([10, 7]);
  expect(result.pbStyle).toBe("emergency");
  expect(result.placedH).toBe(7);
  // 接続点は既存の10×7mm要素(移行・デザイン切替後)と同じローカルy=4.4
  expect(result.anchors.map(a => Math.round(a[1] * 10) / 10)).toEqual([4.4, 4.4]);
  result.anchors.forEach(a => {
    expect(onGrid(a[2]), "接続点X " + a[2]).toBe(true);
    expect(onGrid(a[3]), "接続点Y " + a[3]).toBe(true);
  });
  // キノコの頭も含めて図形が要素枠(0..7)からはみ出さない
  for (const design of result.designs) {
    expect(design.top, design.value).toBeGreaterThanOrEqual(-0.05);
    expect(design.bottom, design.value).toBeLessThanOrEqual(7.05);
    expect(design.pinY, design.value).toBeCloseTo(4.4, 6);
  }
});

test("サーミスタの選択肢名は描画どおりθと表示する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const blank = window.__blankProject;
    const T = window.__edsTest;
    const element = { ...T.defaultElement("resistor", 30, 30), id: "r", resistorStyle: "thermistor" };
    T.installProjectData(blank([element]));
    T.selectElement("r");
    const select = document.querySelector('#selectionPanel select[data-bind="resistorStyle"]');
    const symbolTexts = T.geoPrims(element).filter(prim => prim.t === "text" && prim.value).map(prim => prim.value);
    return { label: select.selectedOptions[0].textContent, symbolTexts };
  });
  expect(result.label).toBe("サーミスタ（θ）");
  expect(result.symbolTexts).toEqual(["θ"]);
});

test("抵抗・ランプ・ブザーの形状欄にも左右反転チェックが出て、記号と接続点を反転する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const blank = window.__blankProject;
    const T = window.__edsTest;
    const probe = (type, bind, value) => {
      const element = { ...T.defaultElement(type, 30, 30), id: "m", [bind]: value };
      T.installProjectData(blank([element]));
      T.selectElement("m");
      return Boolean(document.querySelector('#selectionPanel [data-bind="mirrorX"]'));
    };
    const shown = {
      varistor: probe("resistor", "resistorStyle", "varistor"),
      thermistor: probe("resistor", "resistorStyle", "thermistor"),
      fluor: probe("lamp", "lampVariant", "fluor"),
      sound: probe("buzzer", "buzzerVariant", "sound"),
      jis0806: probe("buzzer", "buzzerVariant", "jis0806"),
      // geo形状を持たない筒形ランプ・ホーン形ブザーは反転できないので出さない
      cylinder: probe("lamp", "lampVariant", "cylinder"),
      horn: probe("buzzer", "buzzerVariant", "horn")
    };
    // バリスタでチェックを入れると mirrorX が立ち、記号の図形が変わる
    const element = { ...T.defaultElement("resistor", 30, 30), id: "v", resistorStyle: "varistor" };
    T.installProjectData(blank([element]));
    T.selectElement("v");
    const before = JSON.stringify(T.geoPrims(T.state.pages[0].elements[0]));
    const checkbox = document.querySelector('#selectionPanel [data-bind="mirrorX"]');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    const after = T.state.pages[0].elements[0];
    return { shown, mirrorX: after.mirrorX, changed: JSON.stringify(T.geoPrims(after)) !== before };
  });
  expect(result.shown).toEqual({ varistor: true, thermistor: true, fluor: true, sound: true, jis0806: true, cylinder: false, horn: false });
  expect(result.mirrorX).toBe(true);
  expect(result.changed).toBe(true);
});

test("ブザーのホーン形・スピーカー形は左右ピン間隔12.5mmで両ピンがグリッドに乗る", async ({ page }) => {
  const result = await page.evaluate(() => {
    const blank = window.__blankProject;
    const T = window.__edsTest;
    const fresh = T.defaultElement("buzzer", 30, 30);
    T.installProjectData(blank([]));
    const placed = ["horn", "speaker"].map((variant, index) => {
      const element = T.defaultElementAtPlacement("buzzer", 41 + index * 30, 52.5);
      element.buzzerVariant = variant;
      return element;
    });
    // JIS形から右パネルでホーン形へ切り替えても12.5×6mmになる
    const jis = { ...T.defaultElement("buzzer", 100, 100), id: "jis", buzzerVariant: "jis0806", w: 10, h: 6 };
    T.installProjectData(blank([jis]));
    T.selectElement("jis");
    const select = document.querySelector('#selectionPanel select[data-bind="buzzerVariant"]');
    select.value = "horn";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const switched = T.state.pages[0].elements[0];
    return {
      size: [fresh.w, fresh.h],
      variant: fresh.buzzerVariant,
      pins: placed.map(element => T.elementConnectionAnchors(element).map(a => [a.x, a.y])),
      switched: [switched.w, switched.h]
    };
  });
  expect(result.variant).toBe("horn");
  expect(result.size).toEqual([12.5, 6]);
  expect(result.switched).toEqual([12.5, 6]);
  for (const pins of result.pins) {
    expect(pins).toHaveLength(2);
    expect(pins[1][0] - pins[0][0]).toBeCloseTo(12.5, 6);
    pins.forEach(([x, y]) => {
      expect(onGrid(x), "接続点X " + x).toBe(true);
      expect(onGrid(y), "接続点Y " + y).toBe(true);
    });
  }
});

test("schema v10のホーン形ブザーを12.5mmへ広げ、右ピンの配線・接続点だけを追従させる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const T = window.__edsTest;
    const buzzer = (id, variant, x, y, extra = {}) => ({ id, type: "buzzer", x, y, w: 12, h: 6, buzzerVariant: variant, label: "BZ", ...extra });
    const source = {
      schemaVersion: 10,
      activePageId: "p1",
      customSymbols: [{
        id: "custom-bz",
        templates: [
          buzzer("tpl-horn", "horn", 0, 0),
          { id: "tpl-wire", type: "wire", points: [[12, 3], [20, 3]] }
        ]
      }],
      pages: [{
        id: "p1", name: "P1", size: "A4", orientation: "portrait", frameVariant: "blank", title: {},
        elements: [
          // 既定のホーン形: 左ピン(20,30)はそのまま、右ピン(32,30)→(32.5,30)
          buzzer("horn", "horn", 20, 27),
          { id: "w-horn-l", type: "wire", points: [[10, 30], [20, 30]] },
          { id: "w-horn-r", type: "wire", points: [[32, 30], [40, 30], [40, 45]] },
          // buzzerVariant未設定はホーン形として扱われていた。右ピンは接続点(junction)へ直結
          { id: "nameless", type: "buzzer", x: 60, y: 27, w: 12, h: 6, label: "BZ" },
          { id: "j-nameless", type: "junction", x: 72, y: 30, w: 2, h: 2, r: .5 },
          // 90度回転のスピーカー形: 右ピンは(x, y+12)→(x, y+12.5)
          buzzer("speaker", "speaker", 103, 20, { rotation: 90 }),
          { id: "w-speaker", type: "wire", points: [[100, 32], [100, 40]] },
          // シンボル拡大1.5倍: 右ピンは x+18 → x+18.75
          buzzer("scaled", "horn", 20, 60, { scale: 1.5 }),
          { id: "w-scaled", type: "wire", points: [[38, 64.5], [45, 64.5]] },
          // 利用者が15mmへ広げた要素とJIS形(geo)は触らない
          buzzer("custom-width", "horn", 60, 60, { w: 15, h: 9 }),
          { id: "w-custom", type: "wire", points: [[75, 64.5], [80, 64.5]] },
          buzzer("jis", "jis0806", 100, 60),
          { id: "w-jis", type: "wire", points: [[104.75, 66], [104.75, 75]] }
        ]
      }]
    };
    const migrated = T.migrateProjectData(source);
    const again = T.migrateProjectData(JSON.parse(JSON.stringify(migrated)));
    const byId = Object.fromEntries(migrated.pages[0].elements.map(e => [e.id, e]));
    const pins = id => T.elementConnectionAnchors(byId[id]).map(a => [Math.round(a.x * 1000) / 1000, Math.round(a.y * 1000) / 1000]);
    return {
      schemaVersion: migrated.schemaVersion,
      idempotent: JSON.stringify(migrated) === JSON.stringify(again),
      sizes: Object.fromEntries(["horn", "nameless", "speaker", "scaled", "custom-width", "jis"].map(id => [id, [byId[id].w, byId[id].h, byId[id].x, byId[id].y]])),
      pins: { horn: pins("horn"), nameless: pins("nameless"), speaker: pins("speaker"), scaled: pins("scaled") },
      wires: Object.fromEntries(["w-horn-l", "w-horn-r", "w-speaker", "w-scaled", "w-custom", "w-jis"].map(id => [id, byId[id].points])),
      junction: [byId["j-nameless"].x, byId["j-nameless"].y],
      template: migrated.customSymbols[0].templates.map(t => t.points || [t.w, t.h])
    };
  });

  expect(result.schemaVersion).toBe(11);
  expect(result.idempotent).toBe(true);
  // ホーン形・スピーカー形(未設定含む)は12.5mmへ。原点(左ピン側)は動かない
  expect(result.sizes.horn).toEqual([12.5, 6, 20, 27]);
  expect(result.sizes.nameless).toEqual([12.5, 6, 60, 27]);
  expect(result.sizes.speaker).toEqual([12.5, 6, 103, 20]);
  expect(result.sizes.scaled).toEqual([12.5, 6, 20, 60]);
  // 別寸法へ変えた要素とJIS形は変更しない
  expect(result.sizes["custom-width"]).toEqual([15, 9, 60, 60]);
  expect(result.sizes.jis).toEqual([12, 6, 100, 60]);

  expect(result.pins.horn).toEqual([[20, 30], [32.5, 30]]);
  expect(result.pins.nameless).toEqual([[60, 30], [72.5, 30]]);
  expect(result.pins.speaker).toEqual([[100, 20], [100, 32.5]]);
  expect(result.pins.scaled).toEqual([[20, 64.5], [38.75, 64.5]]);

  // 右ピンの配線端点・接続点だけが新しい右ピンへ移る(左ピン・他の点は不変)
  expect(result.wires["w-horn-l"]).toEqual([[10, 30], [20, 30]]);
  expect(result.wires["w-horn-r"]).toEqual([[32.5, 30], [40, 30], [40, 45]]);
  expect(result.junction).toEqual([72.5, 30]);
  expect(result.wires["w-speaker"]).toEqual([[100, 32.5], [100, 40]]);
  expect(result.wires["w-scaled"]).toEqual([[38.75, 64.5], [45, 64.5]]);
  expect(result.wires["w-custom"]).toEqual([[75, 64.5], [80, 64.5]]);
  expect(result.wires["w-jis"]).toEqual([[104.75, 66], [104.75, 75]]);
  // ユーザー部品のテンプレートも同じ規則で移行する
  expect(result.template).toEqual([[12.5, 6], [[12.5, 3], [20, 3]]]);
});
