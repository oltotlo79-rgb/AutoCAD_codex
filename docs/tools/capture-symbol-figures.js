#!/usr/bin/env node
// 取扱説明書のシンボル一覧図をアプリ本体(index.html)の描画から生成する。
//
// 使い方(リポジトリ直下で実行):
//   node docs/tools/capture-symbol-figures.js            … 全図を生成
//   node docs/tools/capture-symbol-figures.js 70 photo   … ファイル名に「70」または「photo」を含む図だけ生成
// 出力先: docs/images/manual(環境変数 MANUAL_SHOT_DIR で変更可)。同名ファイルは上書きする。
//
// 図形を別途描き起こすと実装とずれる(旧 build-manual-symbol-figures.py の反省)ため、ここでは
//   1. パレット配置と同じ defaultElementAtPlacement() で部品を作り、
//   2. 右パネルのデザイン選択欄(シンボルデザイン/抵抗形状/ランプ形状/ブザー形状/端子形状)を
//      実際に切り替えて(寸法・接続点の補正も画面操作と同じ経路を通す)、
//   3. 描画された <g data-id> をそのまま複製し、選択欄の表示名を説明文として並べる。
// 説明文は右パネルの選択肢名そのもの。パレットから置いたときのデザインに「★既定」を付ける。
// 赤い点は配線の接続点(elementConnectionAnchors)、背景の格子は2.5mmグリッド。
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("@playwright/test");

const ROOT = path.resolve(__dirname, "..", "..");
const APP_URL = pathToFileURL(path.join(ROOT, "index.html")).href;
const OUT_DIR = path.resolve(process.env.MANUAL_SHOT_DIR || path.join(ROOT, "docs", "images", "manual"));

// 図の横幅(px)。PDFでは紙面幅の7〜9割で表示されるので、説明文は22px以上にする。
const SHEET_WIDTH = 1560;

// 図の定義。sections[].type はパレット種別、variants を省略するとその種別の全デザイン。
// chip は1枚に複数種別が並ぶときに各セルへ出す種別名(パレット表示名)。
// items[] でデザインを個別指定したセルは caption で説明文を上書きできる(選択欄を持たない部品用)。
const SHEETS = [
  {
    file: "59-jis-qualifier-operator.png",
    title: "電流種別・操作機構の限定図記号（4種＋14種）",
    columns: 6, scale: 20,
    sections: [
      { type: "qualifierMark", chip: "電流種別" },
      { type: "operatorMark", chip: "操作機構" }
    ]
  },
  {
    file: "66-timer-contact-jis.png",
    title: "限時a接点・限時b接点のデザイン（各4種）",
    columns: 4, scale: 24,
    sections: [
      { type: "timerContactNO", chip: "限時a接点" },
      { type: "timerContactNC", chip: "限時b接点" }
    ]
  },
  {
    file: "70-switch-contactor-breaker.png",
    title: "切替スイッチ8種・電磁接触器2種・遮断器3種",
    columns: 5, scale: 20,
    sections: [
      { type: "selectorSwitch", chip: "切替スイッチ" },
      { type: "contactor", chip: "電磁接触器" },
      { type: "breaker", chip: "遮断器" }
    ]
  },
  {
    file: "71-outlet-motor-variants.png",
    title: "盤内コンセント（箱形2口）と回転機の接続点",
    columns: 4, scale: 15,
    sections: [
      { type: "outlet", chip: "コンセント／プラグ", variants: ["boxDouble", "boxDoubleEarth"] },
      { type: "motor", chip: "モータ" }
    ]
  },
  {
    file: "72-jis-added-symbols.png",
    title: "JIS C 0617の追加・是正デザイン",
    columns: 6, scale: 20,
    sections: [
      { type: "limitSwitch", chip: "リミットスイッチ", variants: ["jisNo", "jisNc"] },
      { type: "pushButton", chip: "押しボタン", variants: ["jis", "jisPull", "jisTwist", "jisPositive"] },
      { type: "coil", chip: "コイル", variants: ["box", "jisCoupled", "jisThermal", "jisElectric"] },
      { type: "proximitySwitch", chip: "近接スイッチ" },
      { type: "meter", chip: "計器(V/A)", variants: ["voltJis", "ampereJis"] },
      { type: "thermocouple", chip: "熱電対", items: [{ caption: "熱電対（JIS 08-06-01・デザイン1種）" }] },
      { type: "meter", chip: "ラベル表示", items: [{ variant: "voltJis", props: { label: "PV1" }, caption: "部品ラベルの既定文字高2.2mm（例: 電圧計にPV1）", noDefaultMark: true }] },
      { type: "operatorMark", chip: "操作機構", variants: ["rotate", "positive"] }
    ]
  },
  {
    file: "73-photo-light-curtain-variants.png",
    title: "光電スイッチ13種・ライトカーテン8種",
    columns: 5, scale: 13,
    sections: [
      { type: "photoelectricSwitch", chip: "光電スイッチ" },
      { type: "lightCurtain", chip: "ライトカーテン" }
    ]
  },
  {
    file: "75-transformer-variants.png",
    title: "トランス（変圧器）のデザイン（9種）",
    columns: 5, scale: 15,
    sections: [{ type: "transformer" }]
  },
  {
    file: "76-estop-variants.png",
    title: "非常停止ボタンのデザイン（7種）",
    columns: 4, scale: 20,
    sections: [{ type: "pushButtonEmergency" }]
  },
  {
    file: "77-thermal-relay-variants.png",
    title: "サーマルリレーのデザイン（10種）",
    columns: 5, scale: 22,
    sections: [{ type: "thermalRelay" }]
  },
  {
    file: "78-diode-transistor-variants.png",
    title: "ダイオード9種・トランジスタ7種・論理ゲート6種",
    columns: 6, scale: 20,
    sections: [
      { type: "diode", chip: "ダイオード" },
      { type: "transistor", chip: "トランジスタ" },
      { type: "logicGate", chip: "論理ゲート" }
    ]
  },
  {
    file: "79-passive-variants.png",
    title: "抵抗・コンデンサ・リアクトル・変流器・ヒータ・バッテリ・避雷器",
    columns: 6, scale: 20,
    sections: [
      { type: "resistor", chip: "抵抗" },
      { type: "capacitor", chip: "コンデンサ" },
      { type: "inductor", chip: "リアクトル" },
      { type: "currentTransformer", chip: "変流器(CT)" },
      { type: "heater", chip: "ヒータ" },
      { type: "battery", chip: "バッテリ" },
      { type: "arrester", chip: "避雷器" }
    ]
  },
  {
    file: "80-lamp-buzzer-meter-variants.png",
    title: "ランプ4種・ブザー7種・計器6種",
    columns: 6, scale: 20,
    sections: [
      { type: "lamp", chip: "ランプ" },
      { type: "buzzer", chip: "ブザー" },
      { type: "meter", chip: "計器(V/A)" }
    ]
  },
  {
    file: "81-contact-coil-variants.png",
    title: "a接点・b接点・電磁接触器・コイル・ヒューズ・断路器",
    columns: 6, scale: 20,
    sections: [
      { type: "contactNO", chip: "a接点" },
      { type: "contactNC", chip: "b接点" },
      { type: "contactor", chip: "電磁接触器" },
      { type: "coil", chip: "コイル" },
      { type: "fuse", chip: "ヒューズ" },
      { type: "disconnector", chip: "断路器" }
    ]
  },
  {
    file: "82-switch-variants.png",
    title: "押しボタン・リミットスイッチ・検出スイッチ類のデザイン",
    columns: 6, scale: 18,
    sections: [
      { type: "pushButton", chip: "押しボタン" },
      { type: "limitSwitch", chip: "リミットスイッチ" },
      { type: "pressureSwitch", chip: "圧力スイッチ" },
      { type: "floatSwitch", chip: "フロートスイッチ" },
      { type: "thermoSwitch", chip: "温度スイッチ" },
      { type: "flowSwitch", chip: "フロースイッチ" },
      { type: "footSwitch", chip: "フットスイッチ" },
      { type: "matSwitch", chip: "マットスイッチ" },
      { type: "reedSwitch", chip: "リードスイッチ" }
    ]
  },
  {
    file: "83-outlet-plug-variants.png",
    title: "コンセント／プラグのデザイン（20種）",
    columns: 5, scale: 17,
    sections: [{ type: "outlet" }]
  },
  {
    file: "84-ground-sensor-power-variants.png",
    title: "接地・センサ・電源・ソレノイド弁・端子",
    columns: 6, scale: 11,
    sections: [
      { type: "ground", chip: "接地", scale: 24 },
      { type: "sensor", chip: "センサ" },
      { type: "powerSupply", chip: "電源", scale: 10, minShrink: 0.55 },
      { type: "solenoidValve", chip: "ソレノイド弁" },
      { type: "terminal", chip: "端子", scale: 24 }
    ]
  }
];

// 右パネルでデザインを切り替える選択欄(data-bind名)。上から順に探す。
const VARIANT_BINDS = ["symbolVariant", "resistorStyle", "lampVariant", "buzzerVariant", "terminalShape"];

// ---- ページ側: 部品を配置して右パネルからデザインを切り替える ----
// 戻り値はセルごとの { id, caption, isDefault, chip, scale, anchors }。
async function placeSheetElements(page, sheet) {
  return page.evaluate(({ sheet, binds }) => {
    const T = window.__edsTest;
    T.installProjectData({
      schemaVersion: T.state.schemaVersion,
      activePageId: "fig",
      pages: [{ id: "fig", name: "FIG", size: "A3", orientation: "landscape", frameVariant: "blank", title: {}, elements: [] }]
    }, "図の生成用ページ");
    const elements = T.state.pages[0].elements;
    let slot = 0;
    // 複製元を取り出すだけなので重なってもよいが、確認しやすいよう50mm間隔の格子へ置く。
    const nextPoint = () => { const i = slot++; return { x: 25 + (i % 8) * 50, y: 25 + Math.floor(i / 8) * 45 }; };
    const findSelect = () => {
      for (const bind of binds) {
        const select = document.querySelector(`#selectionPanel select[data-bind="${bind}"]`);
        if (select) return select;
      }
      return null;
    };
    const place = type => {
      const point = nextPoint();
      const element = T.defaultElementAtPlacement(type, point.x, point.y);
      elements.push(element);
      T.selectElement(element.id);
      return element;
    };
    const cells = [];
    sheet.sections.forEach(section => {
      // パレットから置いた直後の状態で、選択肢と既定デザインを読む。
      const probe = place(section.type);
      const probeSelect = findSelect();
      const options = probeSelect ? Array.from(probeSelect.options).map(o => [o.value, o.textContent.trim()]) : [];
      const defaultValue = probeSelect ? probeSelect.value : null;
      elements.splice(elements.indexOf(probe), 1);
      const items = section.items || (section.variants || options.map(([value]) => value)).map(variant => ({ variant }));
      items.forEach(item => {
        const element = place(section.type);
        const select = findSelect();
        if (item.variant !== undefined && select && select.value !== item.variant) {
          if (!options.some(([value]) => value === item.variant)) throw new Error(section.type + " に " + item.variant + " がありません");
          select.value = item.variant;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        const current = elements.find(e => e.id === element.id);
        Object.assign(current, item.props || {});
        const option = options.find(([value]) => value === item.variant);
        cells.push({
          id: current.id,
          caption: item.caption || (option ? option[1] : section.type),
          isDefault: !item.noDefaultMark && item.variant !== undefined && item.variant === defaultValue,
          chip: section.chip || "",
          scale: section.scale || sheet.scale,
          minShrink: section.minShrink || 0.65,
          anchors: (T.elementConnectionAnchors(current) || []).map(a => [a.x, a.y])
        });
      });
    });
    T.setSelectionForTest([]);
    return cells;
  }, { sheet, binds: VARIANT_BINDS });
}

// ---- ページ側: 描画済みの部品を複製してセルへ並べた一覧図を組み立てる ----
async function composeSheet(page, sheet, cells) {
  return page.evaluate(({ sheet, cells, width }) => {
    const NS = "http://www.w3.org/2000/svg";
    document.querySelectorAll("#figSheet").forEach(node => node.remove());
    const root = document.createElement("div");
    root.id = "figSheet";
    root.innerHTML = `
      <style>
        #figSheet { position: absolute; left: 0; top: 0; z-index: 2147483000; width: ${width}px; box-sizing: border-box;
          padding: 0 20px 22px; background: #fff; color: #1d2a33;
          font-family: "Yu Gothic UI", "Meiryo", sans-serif; }
        #figSheet .fig-head { display: flex; align-items: baseline; justify-content: space-between; gap: 24px;
          margin: 0 -20px 18px; padding: 16px 24px 14px; background: #eef5f4; border-bottom: 2px solid #cfe1de; }
        #figSheet .fig-title { font-size: 32px; font-weight: 700; color: #173f3a; }
        #figSheet .fig-legend { font-size: 21px; color: #44545e; white-space: nowrap; }
        #figSheet .fig-legend .dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%;
          background: #e0302a; vertical-align: 1px; margin-right: 4px; }
        #figSheet .fig-grid { display: grid; grid-template-columns: repeat(${sheet.columns}, minmax(0, 1fr)); gap: 12px; }
        #figSheet .fig-cell { display: flex; flex-direction: column; border: 2px solid #cbd8dd; border-radius: 12px;
          overflow: hidden; background: #fff; }
        #figSheet .fig-cell.is-default { border-color: #0f6f63; }
        #figSheet .fig-chip { align-self: flex-start; margin: 8px 0 0 10px; padding: 1px 10px; border-radius: 999px;
          background: #e8eef1; color: #3b4c57; font-size: 19px; font-weight: 600; }
        #figSheet .fig-symbol { flex: 1; display: flex; align-items: center; justify-content: center; padding: 14px 10px; }
        #figSheet .fig-symbol svg { display: block; overflow: visible; }
        #figSheet .fig-caption { padding: 9px 12px 11px; border-top: 2px solid #dde7ea; background: #f8fbfa;
          font-size: ${sheet.captionPx || 23}px; line-height: 1.32; font-weight: 600; color: #173f3a; text-align: center;
          overflow-wrap: anywhere; }
        #figSheet .fig-nowrap { white-space: nowrap; }
        #figSheet .fig-default { display: inline-block; margin-left: 6px; padding: 0 8px; border-radius: 6px;
          background: #0f6f63; color: #fff; font-size: 0.86em; white-space: nowrap; }
        /* アプリの線は画面px固定(non-scaling-stroke)なので、拡大図ではmm単位の線幅へ置き換える */
        #figSheet .symbol-line, #figSheet .symbol-fill, #figSheet .symbol-solid, #figSheet .terminal-dot, #figSheet .wire-line {
          vector-effect: none !important; stroke-width: 0.18px !important; }
        /* 撮影中はアプリ画面を隠す(固定配置の状態表示などが図へ写り込まないように) */
        body > *:not(#figSheet) { visibility: hidden !important; }
      </style>
      <div class="fig-head">
        <div class="fig-title"></div>
        <div class="fig-legend"><span class="dot"></span>配線の接続点　★既定＝パレットから置いたときのデザイン　背景の格子＝2.5mm</div>
      </div>
      <svg width="0" height="0" style="position:absolute">
        <defs>
          <pattern id="figGrid" patternUnits="userSpaceOnUse" width="2.5" height="2.5">
            <path d="M 2.5 0 L 0 0 0 2.5" fill="none" stroke="#e1e8ec" stroke-width="0.07"></path>
          </pattern>
        </defs>
      </svg>
      <div class="fig-grid"></div>`;
    root.querySelector(".fig-title").textContent = sheet.title;
    document.body.appendChild(root);
    const grid = root.querySelector(".fig-grid");
    const gap = 12;
    const columnWidth = (grid.clientWidth - gap * (sheet.columns - 1)) / sheet.columns;
    const canvas = document.querySelector("svg#canvas");
    const report = [];

    cells.forEach(cell => {
      const source = canvas.querySelector(`g[data-id="${cell.id}"]`);
      if (!source) throw new Error("描画が見つかりません: " + cell.id);
      const box = document.createElement("div");
      box.className = "fig-cell" + (cell.isDefault ? " is-default" : "");
      if (cell.chip) {
        const chip = document.createElement("div");
        chip.className = "fig-chip";
        chip.textContent = cell.chip;
        box.appendChild(chip);
      }
      const symbol = document.createElement("div");
      symbol.className = "fig-symbol";
      const svg = document.createElementNS(NS, "svg");
      const background = document.createElementNS(NS, "rect");
      background.setAttribute("fill", "url(#figGrid)");
      svg.appendChild(background);
      const holder = document.createElementNS(NS, "g");
      const clone = source.cloneNode(true);
      // クリック判定用の透明な当たり領域は図に不要(外接枠の計算も狂わせる)。
      clone.querySelectorAll('[fill-opacity="0"], [stroke-opacity="0"]').forEach(node => node.remove());
      // アプリ側の [data-id] 検索に複製が引っかからないよう識別属性は外す。
      clone.removeAttribute("data-id");
      clone.classList.remove("element");
      holder.appendChild(clone);
      svg.appendChild(holder);
      symbol.appendChild(svg);
      box.appendChild(symbol);
      const caption = document.createElement("div");
      caption.className = "fig-caption";
      // JIS番号(例 07-05-01)が行末のハイフンで泣き別れにならないよう、番号だけ改行禁止にする。
      cell.caption.split(/(JIS \d{2}-\d{2}-\d{2}系?)/).forEach((part, index) => {
        if (!part) return;
        if (index % 2) {
          const keep = document.createElement("span");
          keep.className = "fig-nowrap";
          keep.textContent = part;
          caption.appendChild(keep);
        } else {
          caption.appendChild(document.createTextNode(part));
        }
      });
      if (cell.isDefault) {
        const mark = document.createElement("span");
        mark.className = "fig-default";
        mark.textContent = "★既定";
        caption.appendChild(mark);
      }
      box.appendChild(caption);
      grid.appendChild(box);

      // 図形と接続点を囲む範囲(mm)。文字の外接枠も含む。
      const bb = holder.getBBox();
      let minX = bb.x, minY = bb.y, maxX = bb.x + bb.width, maxY = bb.y + bb.height;
      const dotR = 0.38;
      cell.anchors.forEach(([x, y]) => {
        minX = Math.min(minX, x - dotR); minY = Math.min(minY, y - dotR);
        maxX = Math.max(maxX, x + dotR); maxY = Math.max(maxY, y + dotR);
      });
      const margin = 0.8;
      minX -= margin; minY -= margin; maxX += margin; maxY += margin;
      const w = maxX - minX, h = maxY - minY;
      // 横長の図形は、指定倍率のminShrink倍(既定65%)まで縮めれば入る最小の列数にまたがらせる
      // (縦長の図が間延びしないよう、またぐ列は最小限)。全幅でも入らなければ全幅に合わせて縮小する。
      const padding = 24;
      const available = columns => columns * columnWidth + (columns - 1) * gap - padding;
      let span = 1;
      while (span < sheet.columns && available(span) < w * cell.scale * cell.minShrink) span++;
      const scale = Math.min(cell.scale, available(span) / w);
      box.style.gridColumn = "span " + Math.max(1, span);
      svg.setAttribute("viewBox", `${minX} ${minY} ${w} ${h}`);
      svg.setAttribute("width", String(Math.round(w * scale)));
      svg.setAttribute("height", String(Math.round(h * scale)));
      background.setAttribute("x", String(minX));
      background.setAttribute("y", String(minY));
      background.setAttribute("width", String(w));
      background.setAttribute("height", String(h));
      cell.anchors.forEach(([x, y]) => {
        const dot = document.createElementNS(NS, "circle");
        dot.setAttribute("cx", String(x));
        dot.setAttribute("cy", String(y));
        dot.setAttribute("r", String(Math.max(0.3, 4.5 / scale)));
        dot.setAttribute("fill", "#e0302a");
        dot.setAttribute("stroke", "#fff");
        dot.setAttribute("stroke-width", "0.08");
        svg.appendChild(dot);
      });
      report.push({ caption: cell.caption, mm: [Math.round(w * 10) / 10, Math.round(h * 10) / 10], span, scale: Math.round(scale * 10) / 10 });
    });
    const rect = root.getBoundingClientRect();
    return { width: Math.ceil(rect.width), height: Math.ceil(rect.height), report };
  }, { sheet, cells, width: SHEET_WIDTH });
}

async function main() {
  const filters = process.argv.slice(2);
  const sheets = filters.length ? SHEETS.filter(sheet => filters.some(filter => sheet.file.includes(filter))) : SHEETS;
  if (!sheets.length) {
    console.error("該当する図がありません: " + filters.join(", "));
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: SHEET_WIDTH + 40, height: 1200 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(APP_URL, { waitUntil: "load" });
    await page.waitForSelector("svg#canvas");
    await page.waitForFunction(() => Boolean(window.__edsTest));
    for (const sheet of sheets) {
      const cells = await placeSheetElements(page, sheet);
      const size = await composeSheet(page, sheet, cells);
      // シート全体が1画面に入る大きさへ広げてから撮る(はみ出し部分の欠けを防ぐ)。
      await page.setViewportSize({ width: Math.max(SHEET_WIDTH + 40, size.width), height: Math.max(600, size.height + 20) });
      const file = path.join(OUT_DIR, sheet.file);
      await page.locator("#figSheet").screenshot({ path: file });
      console.log(`${sheet.file}: ${cells.length}セル ${size.width}x${size.height}px`);
      if (process.env.FIG_DEBUG) size.report.forEach(item => console.log("  ", JSON.stringify(item)));
      await page.evaluate(() => document.querySelectorAll("#figSheet").forEach(node => node.remove()));
      await page.setViewportSize({ width: SHEET_WIDTH + 40, height: 1200 });
    }
    if (errors.length) throw new Error("アプリでエラーが発生しました:\n" + errors.join("\n"));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
