# 参照スキャン完全再現 実装仕様書(Codex 引き渡し用)

最終更新: 2026-07-10
対象: `index.html`(単一ファイル。**このファイル以外は編集しないこと**)
参照: `scan-001.pdf`(16枚=32ページ相当)/ `scan-001 (1).pdf`(11枚=22ページ相当)
※参照PDFは絶対にコミットしない。

本書は、参照スキャンPDFの全ページを人手で忠実に再作図できるようにするための
**実測にもとづくシンボル寸法仕様・描画コード・統合手順・検証手順**をまとめたもの。
両PDFの全54ページ(A4相当)をレンダリングし、主要シンボルを拡大実測して作成した。

---

## 0. Codex への必須指示(最初に読むこと)

1. **シンボルの形を名前から推測しない。** 本書の寸法・プリミティブ定義を唯一の正とする。
   これまでの不一致の最大原因は「a接点」「遮断器」等の名前から IEC/教科書風の形を
   推測して描いたことにある。参照図面は**自動車工場の設備図面様式(JISベース+PLCラダー様式)**であり、
   一般的な教科書記号とは形が違う。
2. 実装は本書「7. 統合手順」のステップ順に行い、各ステップの受入条件を満たしてから次へ進む。
3. SVG と DXF を別々に描かない。「2. ジオメトリ単一定義方式」に従い、
   1つの定義から SVG / DXF / 接続アンカーの3つを導出する。
4. 寸法は全て mm(ページ座標)。スキャン実測のため ±0.3mm の誤差を含むが、
   **本書の数値をそのまま使う**こと(現物合わせで数値を変えない)。
5. 既存機能(保存/読込、Undo、配線分割、帳票、監査、印刷)を壊さない。
   新規フィールドはすべて省略可能とし、旧 JSON を読んでもエラーにしない。
6. `index.html` 以外のファイル(docs、PDF、設定)は変更しない。

---

## 1. 原因分析: なぜ今まで正確に再現できなかったか

| # | 原因 | 対策(本書) |
|---|------|------------|
| 1 | **様式の取り違え**。参照図面の接点はPLCラダー式「縦バー2本 ⊣⊢」なのに、円2個+斜めブレードのIEC風で実装していた。遮断器・コイル・ランプ・接地・モータも同様に別物 | 4章の実測仕様に全面置換 |
| 2 | **SVGとDXFの二重実装**。`drawXxx()` と `dxfXxxLocal()` を手で同期しており、片方だけ直ってドリフトする | 2章のジオメトリ単一定義方式 |
| 3 | **比例スケーリング**(`w*.3` など)。要素サイズで形が歪み、寸法仕様が曖昧になる | 固定mm座標のプリミティブ定義+等倍スケール |
| 4 | **数値仕様の欠如**。「参照PDFに合わせて」だけでは実装者(AI)は形を決められない | 全シンボルの実測寸法表 |
| 5 | **検証ループの欠如**。描いた結果と参照の比較手順がなかった | 8章の検証手順(下絵オーバーレイ) |

---

## 2. 改善アーキテクチャ: ジオメトリ単一定義方式

### 2.1 方針

- 各シンボルを `SYMBOL_GEO` レジストリに **mmローカル座標のプリミティブ配列**として1回だけ定義する。
- SVG描画・DXF出力・接続アンカーはすべてこの定義から生成する。
- シンボルは**固定寸法**で描く(伸縮させない)。`element.w/h` は選択枠・当たり判定用。
- 縦横は `orientation` で切替え、ジオメトリ変換で自動導出する(縦用の別実装を書かない)。

### 2.2 プリミティブ仕様

```text
{ t:"line",   p:[x1,y1,x2,y2], dash? }            // 線分
{ t:"pline",  pts:[[x,y],...], dash? }             // 折れ線
{ t:"rect",   p:[x,y,w,h], fill? }                 // fill: "white"(白抜き) | 省略(枠のみ)
{ t:"circle", p:[cx,cy,r], fill? }                 // fill: "white" | "solid"(塗り) | 省略
{ t:"arc",    p:[cx,cy,r,a0,a1] }                  // 角度は度。画面座標系(yは下向き)で
                                                   // +x軸=0°、時計回りに増加。a0→a1を時計回りに描く
{ t:"text",   p:[x,y], size, anchor?, field?, value?, dy? }
   // field: "label"|"tag"|"refNo"|"catalog"|"lampColor" など element のプロパティ名
   // value: 固定文字。field と value 両方あれば field 優先。空文字は描かない
```

### 2.3 レジストリとレンダラ(このまま実装する)

`index.html` の `wireStyle()` 付近(補助関数群)に追加:

```js
// ===== ジオメトリ単一定義方式 =========================================
// 参照スキャン実測にもとづく固定寸法シンボル定義。
// SVG / DXF / 接続アンカーはすべてここから導出する。

const SYMBOL_GEO = {}; // 4章の定義をここに登録する

function geoKeyFor(element) {
  if (element.type === "contactNO") return "contactNO";
  if (element.type === "contactNC") return "contactNC";
  if (element.type === "thermalRelay") return "thermalRelay";
  if (element.type === "thermalElement") return "thermalElement";
  if (element.type === "breaker") return "breaker";
  if (element.type === "coil") return "coil";
  if (element.type === "lamp" && (element.lampVariant || "pilot") === "pilot") return "lamp";
  if (element.type === "pushButton") return (element.pbStyle || "momentary") === "emergency" ? "pushButtonEmergency" : "pushButton";
  if (element.type === "selectorSwitch") return "selectorSwitch";
  if (element.type === "limitSwitch") return "limitSwitch";
  if (element.type === "pressureSwitch") return "pressureSwitch";
  if (element.type === "motor") return "motor";
  if (element.type === "ground") return "ground";
  if (element.type === "terminal") return "terminal";
  if (element.type === "resistor") return (element.resistorStyle || "box") === "varistor" ? "varistor" : "resistor";
  if (element.type === "connector" && element.connStyle === "pair") return "connectorPair";
  if (element.type === "contactBlock") return "contactBlock";
  if (element.type === "positionMark") return (element.markStyle || "box") === "box" ? "positionMarkBox" : "positionMarkLine";
  if (element.type === "polarityMark") return "polarityMark";
  return null;
}

function geoFor(element) {
  const key = geoKeyFor(element);
  return key ? SYMBOL_GEO[key] || null : null;
}

// orientation==="vertical" は横定義を時計回り90度回転して導出する。
// (x,y) -> (bodyH - y, x)。角度は +90 度。
function geoBodySize(element) {
  const geo = geoFor(element);
  if (!geo) return null;
  const vertical = element.orientation === "vertical";
  return { w: vertical ? geo.h : geo.w, h: vertical ? geo.w : geo.h };
}

function geoMapPoint(geo, element, x, y) {
  if (element.orientation === "vertical") return [geo.h - y, x];
  return [x, y];
}

function geoPrims(element) {
  const geo = geoFor(element);
  if (!geo) return [];
  const map = (x, y) => geoMapPoint(geo, element, x, y);
  return geo.prims.map(prim => {
    const q = deepClone(prim);
    if (prim.t === "line") {
      const a = map(prim.p[0], prim.p[1]);
      const b = map(prim.p[2], prim.p[3]);
      q.p = [a[0], a[1], b[0], b[1]];
    } else if (prim.t === "pline") {
      q.pts = prim.pts.map(pt => map(pt[0], pt[1]));
    } else if (prim.t === "rect") {
      const a = map(prim.p[0], prim.p[1]);
      const b = map(prim.p[0] + prim.p[2], prim.p[1] + prim.p[3]);
      q.p = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])];
    } else if (prim.t === "circle") {
      const c = map(prim.p[0], prim.p[1]);
      q.p = [c[0], c[1], prim.p[2]];
    } else if (prim.t === "arc") {
      const c = map(prim.p[0], prim.p[1]);
      const rot = element.orientation === "vertical" ? 90 : 0;
      q.p = [c[0], c[1], prim.p[2], prim.p[3] + rot, prim.p[4] + rot];
    } else if (prim.t === "text") {
      const c = map(prim.p[0], prim.p[1]);
      q.p = [c[0], c[1]];
    }
    return q;
  });
}

function geoTextValue(element, prim) {
  if (prim.field) {
    const raw = element[prim.field];
    return raw === undefined || raw === null ? "" : String(raw);
  }
  return prim.value === undefined ? "" : String(prim.value);
}

function svgArcPath(cx, cy, r, a0, a1) {
  const rad = d => d * Math.PI / 180;
  const x0 = cx + r * Math.cos(rad(a0));
  const y0 = cy + r * Math.sin(rad(a0));
  const x1 = cx + r * Math.cos(rad(a1));
  const y1 = cy + r * Math.sin(rad(a1));
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return "M " + round(x0) + " " + round(y0) + " A " + r + " " + r + " 0 " + large + " 1 " + round(x1) + " " + round(y1);
}

// SVG 描画。geo 定義があれば true を返す。
function drawGeoSymbol(g, element, stroke) {
  const geo = geoFor(element);
  if (!geo) return false;
  geoPrims(element).forEach(prim => {
    if (prim.t === "line") {
      g.appendChild(svgEl("line", { x1: prim.p[0], y1: prim.p[1], x2: prim.p[2], y2: prim.p[3], class: "symbol-line", stroke, "stroke-dasharray": prim.dash || null }));
    } else if (prim.t === "pline") {
      g.appendChild(svgEl("path", { d: prim.pts.map((pt, i) => (i ? "L " : "M ") + pt[0] + " " + pt[1]).join(" "), class: "symbol-line", stroke, "stroke-dasharray": prim.dash || null }));
    } else if (prim.t === "rect") {
      g.appendChild(svgEl("rect", { x: prim.p[0], y: prim.p[1], width: prim.p[2], height: prim.p[3], class: prim.fill === "white" ? "symbol-fill" : "symbol-line", stroke, fill: prim.fill === "white" ? "#fff" : "none" }));
    } else if (prim.t === "circle") {
      if (prim.fill === "solid") g.appendChild(svgEl("circle", { cx: prim.p[0], cy: prim.p[1], r: prim.p[2], fill: stroke }));
      else g.appendChild(svgEl("circle", { cx: prim.p[0], cy: prim.p[1], r: prim.p[2], class: prim.fill === "white" ? "terminal-dot" : "symbol-line", stroke, fill: prim.fill === "white" ? "#fff" : "none" }));
    } else if (prim.t === "arc") {
      g.appendChild(svgEl("path", { d: svgArcPath(prim.p[0], prim.p[1], prim.p[2], prim.p[3], prim.p[4]), class: "symbol-line", stroke, fill: "none" }));
    } else if (prim.t === "text") {
      const value = geoTextValue(element, prim);
      if (value) g.appendChild(textEl(value, prim.p[0], prim.p[1], { fontSize: prim.size || 2, anchor: prim.anchor || "middle" }));
    }
  });
  return true;
}

// DXF 出力。geo 定義があれば true を返す。
function dxfGeoSymbol(out, page, element) {
  const geo = geoFor(element);
  if (!geo) return false;
  geoPrims(element).forEach(prim => {
    if (prim.t === "line") {
      dxfLineLocal(out, page, "SYMBOL", element, prim.p[0], prim.p[1], prim.p[2], prim.p[3]);
    } else if (prim.t === "pline") {
      for (let i = 1; i < prim.pts.length; i++) {
        dxfLineLocal(out, page, "SYMBOL", element, prim.pts[i - 1][0], prim.pts[i - 1][1], prim.pts[i][0], prim.pts[i][1]);
      }
    } else if (prim.t === "rect") {
      dxfRectLocal(out, page, "SYMBOL", element, prim.p[0], prim.p[1], prim.p[2], prim.p[3]);
    } else if (prim.t === "circle") {
      dxfCircleLocal(out, page, "SYMBOL", element, prim.p[0], prim.p[1], prim.p[2]);
    } else if (prim.t === "arc") {
      dxfArcLocal(out, page, "SYMBOL", element, prim.p[0], prim.p[1], prim.p[2], prim.p[3], prim.p[4]);
    } else if (prim.t === "text") {
      const value = geoTextValue(element, prim);
      if (!value) return;
      const dx = prim.anchor === "middle" ? value.length * (prim.size || 2) * .3 : (prim.anchor === "end" ? value.length * (prim.size || 2) * .6 : 0);
      dxfTextLocal(out, page, "TEXT", element, prim.p[0] - dx, prim.p[1] + (prim.size || 2) * .35, prim.size || 2, value);
    }
  });
  return true;
}

// DXF ARC。画面座標(y下向き・時計回り角度)を CAD 座標(y上向き・反時計回り)へ変換:
// CAD開始角 = -a1, CAD終了角 = -a0
function dxfArcLocal(out, page, layer, element, cx, cy, r, a0, a1) {
  const c = localPoint(element, cx, cy);
  const rot = Number(element.rotation || 0);
  const s = ((-(a1 + rot)) % 360 + 360) % 360;
  const e = ((-(a0 + rot)) % 360 + 360) % 360;
  out.push("0", "ARC", "8", layer, "10", round(c[0]), "20", round(cadY(page, c[1])), "40", round(r), "50", round(s), "51", round(e));
}

// 接続アンカー(グローバル座標)
function geoAnchors(element) {
  const geo = geoFor(element);
  if (!geo) return null;
  return geo.anchors.map(a => {
    const p = geoMapPoint(geo, element, a[0], a[1]);
    return localAnchor(element, p[0], p[1]);
  });
}
```

### 2.4 既存コードへの接続(置換ポイント)

1. `drawElement()` の type別 if 連鎖の**先頭**に追加:
   ```js
   if (drawGeoSymbol(g, element, stroke)) {
     drawVisibleAttributes(g, element);
     svg.appendChild(g);
     return;
   }
   ```
   ※ `drawVisibleAttributes` は既存のまま利用。
2. `dxfElement()` の先頭(underlay除外の直後)に追加:
   ```js
   if (dxfGeoSymbol(out, page, element)) { dxfVisibleAttributes(out, page, element); return; }
   ```
3. `elementConnectionAnchors()` の先頭に追加:
   ```js
   const fromGeo = geoAnchors(element);
   if (fromGeo) return fromGeo;
   ```
   ※ `geoAnchors` はグローバル座標(rotation/orientation 適用済み)を返すため、
   以降の `add()` 経路には入らず、そのまま return する。
4. geo 対象タイプの旧 `drawXxx` / `dxfXxxLocal` 関数は**削除せず残してよい**(未到達になる)。
   ただし `drawContact` 系を参照している `drawThermalRelay`/`dxfThermalRelayLocal` 等の
   呼び出し関係は壊さないこと。

---

## 3. 寸法体系(基本定数)

スキャン実測から得た共通寸法。**全シンボル・図枠・テンプレートで共通使用**する。

| 定数 | 値 | 根拠(実測箇所) |
|---|---|---|
| `RUNG_PITCH`(ラダー行ピッチ) | **9.5mm** | 両PDF全ページの行番号00〜20の間隔 |
| 行番号領域: 行00のY | **27.0mm** | 行番号「00」中心 |
| 図面枠: 左右余白 | **19.0mm** | 外枠線位置 |
| 図面枠: 上余白 / 作図領域下端 | **18.0mm / 273.0mm**(A4縦) | 外枠線位置 |
| 接点バー: 高さ/太さ/内側間隔 | **3.2 / 0.6 / 1.4mm** | s1_p2A Y0F0ほか全接点 |
| 端子・開閉器の小円 半径 | **0.9mm**(⌀1.8) | X080手前の端子円、PB/LS/OLの端子円 |
| コイル・ランプ円 半径 | **2.2mm**(⌀4.4) | CR1X, MSB3, PB1(電源PL) |
| PLCユニット端子円 半径 | **3.5mm**(⌀7.0) | QX82ユニットの X080 円 |
| 接続点(ジャンクション) 半径 | **0.75mm**(塗りつぶし) | レール上の分岐点 |
| 文字: ページ見出し | 3.5mm | 「制御盤」「工程間インターロック信号」 |
| 文字: 行番号 | 3.0mm | 00〜20 |
| 文字: 機器タグ(接点上のY0F0等) | 2.0mm | 全ページ |
| 文字: 機能説明(タグの上の小書き) | 1.8mm | 「電源正常」等 |
| 文字: クロス参照番号(接点下の1504等) | 1.7mm | 全ページ |
| 文字: 右側の信号説明欄 | 2.3mm | 「移載機より自動運転中」等 |
| 線幅 | 既存クラス(.32/.38)を維持 | スキャンは一様に約0.35mm |

**要素既定寸法の変更**(`defaultElement()` を下表のとおり更新):

| type | 新既定 w×h | 追加フィールド(全て省略可) |
|---|---|---|
| contactNO / contactNC | 8 × 4.4 | `refNo:""`(下の参照番号) |
| thermalRelay | 8 × 4 | `refNo:""` |
| thermalElement(新規) | 8 × 3 | — |
| breaker | 12 × 5 | `refNo:""` |
| coil | 10 × 4.4 | `refNo:""`(catalog を型式表示に使用) |
| lamp(pilot) | 10 × 4.4 | `lampColor:"W"` |
| pushButton | 10 × 5 | `pbStyle:"momentary"|"emergency"` |
| selectorSwitch | 10 × 5 | — |
| limitSwitch | 10 × 4.6 | — |
| pressureSwitch(新規) | 10 × 6 | — |
| motor | 16 × 16 | — |
| ground | 4 × 5 | — |
| terminal | 1.8 × 1.8 | ラベルは円の上に表示 |
| junction | r 0.75(w/h 2) | `autoJunctions()` の r も 0.75 に変更 |
| resistor | 10 × 2.6 | `resistorStyle:"box"|"varistor"` |
| connector(pair) | 6 × 3 | `connStyle:"pair"` の場合のみ geo 使用 |
| contactBlock | 14 × 8 | `blockFrame:"solid"|"dashed"`(既定 solid) |
| positionMark(新規) | 4 × 6 | `markStyle:"box"|"line"` |
| polarityMark(新規) | 2.6 × 2.6 | `sign:"+"|"-"` |

`resizeContactElementForOrientation` / `resizeProtectiveElementForOrientation` /
`resizeSingleTerminalForOrientation` は「w/h を geoBodySize() から取得して入れ替える」実装に変更する:

```js
function resizeGeoElementForOrientation(element) {
  const size = geoBodySize(element);
  if (!size) return;
  element.w = size.w;
  element.h = size.h;
}
```

---

## 4. シンボル別詳細仕様(実測+ジオメトリ定義)

各定義は `SYMBOL_GEO` にそのまま登録する。座標は横向き基準・原点は本体左上。
`anchors` は配線が吸着し、インライン配置時に配線を分割する端子位置。

**実測ソース一覧(トレーサビリティ)**

| シンボル | 実測箇所 |
|---|---|
| a接点(ラダー) | scan-001.pdf p2A 行01 `Y0F0`、scan-001 (1).pdf p5A `MSB1A` |
| b接点(ラダー) | scan-001 (1).pdf p2A 行04 `CR3`(バー2本+斜線) |
| サーマルリレーb接点 | scan-001.pdf p1A 行11-14 `OL1A〜OL3`(円2+X) |
| サーマル素子(⊓) | scan-001 (1).pdf p5A/p6B `OL1A/OL3`(横配線上の凸形) |
| 遮断器/CP | scan-001 (1).pdf p5A `CB1`(円+半円アーク+段差トリップ素子、3極+縦破線連動) |
| コイル | scan-001 (1).pdf p8B `CR1X/MSB3`(無印円、上タグ・下型式) |
| 表示灯 | scan-001 (1).pdf p8B `PB1(電源PL)/LED1`(円+45°ヒゲ4本+色文字) |
| 押しボタン(a) | scan-001 (1).pdf p8B `PBL1`(円2+上浮きブレード+中央突起) |
| 押しボタン(非常停止b) | scan-001 (1).pdf p7A `PBE1`(キノコ頭+下弧+R) |
| 切替スイッチ | scan-001 (1).pdf p8B `KS1`+`入/切`ポジション表示 |
| リミットスイッチ | scan-001.pdf p9A `LS X460`(円2+上の横長矩形) |
| 圧力スイッチ | scan-001.pdf p1A 行10 `PS1`(円2+斜めブレード+ドーム) |
| モータ | scan-001 (1).pdf p5A/p6B `M1A/M3`(円+内タグ+斜めスタブ+小円端子) |
| 接地 | scan-001 (1).pdf p5A(縦線+斜線ハッチ3本) |
| 端子(小円) | scan-001.pdf p2A `X080`手前、scan-001 (1).pdf p2A `TC00` |
| PLCユニット端子円 | scan-001.pdf p2A `QX82(3/4)` X080〜 |
| バリスタ/抵抗 | scan-001 (1).pdf p6B `VR1`(矩形+対角線) |
| コネクタ対 | scan-001 (1).pdf p6B `J141/J142`(縦バー+対向弧) |
| 矢印(フォーク/開き/塗り/シェブロン) | 母線端Y字、`GC1000 Si0へ`、`P1-X060`継続 |
| 接点ブロック | scan-001 (1).pdf p8B `CB1`(実線矩形+内部接点) |
| 機器箱 | scan-001 (1).pdf p5A `整流器`(矩形+内部ピン番号2/4/1) |
| ツイストペア | scan-001 (1).pdf p5A/p6B `DA/DB/DG/SLD` |
| 極性マーク | 各ラダーページ `P1(⊕)/N1(⊖)` |

### 4.1 a接点 `contactNO`(ラダー式)

```text
                 Y0F0        ← タグ(2.0mm, 中央)
        ─────────▯▯─────────  ← バー: 高3.2 幅0.6 内側間隔1.4(白抜き矩形)
                 1504        ← refNo(1.7mm, 中央)
        本体 w8 × h4.4、配線中心 cy=2.2
```

```js
SYMBOL_GEO.contactNO = {
  w: 8, h: 4.4,
  anchors: [[0, 2.2], [8, 2.2]],
  prims: [
    { t: "line", p: [0, 2.2, 2.7, 2.2] },
    { t: "line", p: [5.3, 2.2, 8, 2.2] },
    { t: "rect", p: [2.7, 0.6, 0.6, 3.2], fill: "white" },
    { t: "rect", p: [4.7, 0.6, 0.6, 3.2], fill: "white" },
    { t: "text", p: [4, -1.4], size: 2, anchor: "middle", field: "label" },
    { t: "text", p: [4, 6.0], size: 1.7, anchor: "middle", field: "refNo" }
  ]
};
```

### 4.2 b接点 `contactNC`(ラダー式)

a接点+**斜線1本**(左下→右上、バー2本を貫通)。

```js
SYMBOL_GEO.contactNC = {
  w: 8, h: 4.4,
  anchors: [[0, 2.2], [8, 2.2]],
  prims: [
    { t: "line", p: [0, 2.2, 2.7, 2.2] },
    { t: "line", p: [5.3, 2.2, 8, 2.2] },
    { t: "rect", p: [2.7, 0.6, 0.6, 3.2], fill: "white" },
    { t: "rect", p: [4.7, 0.6, 0.6, 3.2], fill: "white" },
    { t: "line", p: [2.6, 4.6, 5.4, -0.4] },
    { t: "text", p: [4, -1.4], size: 2, anchor: "middle", field: "label" },
    { t: "text", p: [4, 6.0], size: 1.7, anchor: "middle", field: "refNo" }
  ]
};
```

### 4.3 サーマルリレー接点 `thermalRelay`(○✕○)

熱動継電器のb接点。端子小円2つ+中央にX(交差2線)。従来の「接点+波線」は廃止。

```js
SYMBOL_GEO.thermalRelay = {
  w: 8, h: 4,
  anchors: [[0, 2.4], [8, 2.4]],
  prims: [
    { t: "line", p: [0, 2.4, 1.7, 2.4] },
    { t: "line", p: [6.3, 2.4, 8, 2.4] },
    { t: "circle", p: [2.6, 2.4, 0.9], fill: "white" },
    { t: "circle", p: [5.4, 2.4, 0.9], fill: "white" },
    { t: "line", p: [3.1, 1.3, 4.9, 3.1] },
    { t: "line", p: [3.1, 3.1, 4.9, 1.3] },
    { t: "text", p: [4, -1.2], size: 2, anchor: "middle", field: "label" },
    { t: "text", p: [4, 5.6], size: 1.7, anchor: "middle", field: "refNo" }
  ]
};
```

### 4.4 サーマル素子 `thermalElement`(新規タイプ、⊓形)

動力回路(モータ主回路)上の熱動素子。配線が**凸形に持ち上がる**形。
幅3.6mm・高さ1.8mmの角凸。

```js
SYMBOL_GEO.thermalElement = {
  w: 8, h: 3,
  anchors: [[0, 3], [8, 3]],
  prims: [
    { t: "pline", pts: [[0, 3], [2.2, 3], [2.2, 1.2], [5.8, 1.2], [5.8, 3], [8, 3]] },
    { t: "text", p: [4, -0.2], size: 2, anchor: "middle", field: "label" }
  ]
};
```

`PALETTE` に `{ type: "thermalElement", label: "サーマル素子", icon: "resistor" }` を追加。
`DEFAULT_TAG_PREFIXES.thermalElement = "OL"`。`wireBreakingTypes()` と `centerPlacedTypes()` に追加。

### 4.5 遮断器/サーキットプロテクタ `breaker`

1極 = 「端子円2つ+上向き半円アーク+段差形トリップ素子」。
アークは円中心間(2.5→7.0)を弦とする半径2.25の上半円。
トリップ素子: 上に1.1、右へ1.0、下へ2.2(配線より1.1下)、右へ0.8、上へ戻る段差。

```js
SYMBOL_GEO.breaker = {
  w: 12, h: 5,
  anchors: [[0, 3], [12, 3]],
  prims: [
    { t: "line", p: [0, 3, 1.6, 3] },
    { t: "arc", p: [4.75, 3, 2.25, 180, 360] },
    { t: "circle", p: [2.5, 3, 0.9], fill: "white" },
    { t: "circle", p: [7, 3, 0.9], fill: "white" },
    { t: "line", p: [7.9, 3, 8.4, 3] },
    { t: "pline", pts: [[8.4, 3], [8.4, 1.9], [9.4, 1.9], [9.4, 4.1], [10.2, 4.1], [10.2, 3], [12, 3]] },
    { t: "text", p: [6, -1.2], size: 2, anchor: "middle", field: "label" },
    { t: "text", p: [9.3, 0.9], size: 1.7, anchor: "middle", field: "refNo" }
  ]
};
```

- 定格(10A/1.3A)は `refNo` に入れてトリップ素子上に表示する。
- **3極表現**: 3個の breaker を縦ピッチ **4.75mm**(RUNG_PITCH/2)で配置し、
  アーク頂点(ローカル x=4.75, y=0.75)どうしを `mechanicalLink`(破線 1.2 1.4)で結ぶ。
  右パネル用の一括生成ボタンは不要(テンプレート6.1で自動生成)。

### 4.6 コイル `coil`(無印円)

```text
     MSB3          ← タグ(2.0mm)
  ────( )────      ← 円 r2.2(白抜き)、左右リード
    SD-T12         ← 型式 = element.catalog(1.7mm)
```

```js
SYMBOL_GEO.coil = {
  w: 10, h: 4.4,
  anchors: [[0, 2.2], [10, 2.2]],
  prims: [
    { t: "line", p: [0, 2.2, 2.8, 2.2] },
    { t: "line", p: [7.2, 2.2, 10, 2.2] },
    { t: "circle", p: [5, 2.2, 2.2], fill: "white" },
    { t: "text", p: [5, -1.4], size: 2, anchor: "middle", field: "label" },
    { t: "text", p: [5, 6.2], size: 1.7, anchor: "middle", field: "catalog" }
  ]
};
```

### 4.7 表示灯 `lamp`(円+45°ヒゲ4本+色文字)

円 r2.2、四隅45°方向に長さ1.2mmのヒゲ(内端は円周上)。円内に色文字(W/R/G/Y)。

```js
SYMBOL_GEO.lamp = {
  w: 10, h: 4.4,
  anchors: [[0, 2.2], [10, 2.2]],
  prims: [
    { t: "line", p: [0, 2.2, 2.8, 2.2] },
    { t: "line", p: [7.2, 2.2, 10, 2.2] },
    { t: "circle", p: [5, 2.2, 2.2], fill: "white" },
    { t: "line", p: [6.56, 0.64, 7.4, -0.2] },
    { t: "line", p: [6.56, 3.76, 7.4, 4.6] },
    { t: "line", p: [3.44, 0.64, 2.6, -0.2] },
    { t: "line", p: [3.44, 3.76, 2.6, 4.6] },
    { t: "text", p: [5, 2.2], size: 2.2, anchor: "middle", field: "lampColor" },
    { t: "text", p: [5, -1.6], size: 2, anchor: "middle", field: "label" }
  ]
};
```

- `lampVariant:"cylinder"`(筒形)は既存実装を残す(geoKeyFor が pilot のみ geo を返す)。
- 右パネルに「ランプ色文字」入力(`lampColor`)を追加(specificFields の lamp 分岐)。

### 4.8 押しボタン `pushButton`

**(a) momentary(既定)** — PBL1形。円2+**上に浮いた水平ブレード**+中央突起。ラベルは下。

```js
SYMBOL_GEO.pushButton = {
  w: 10, h: 5,
  anchors: [[0, 3.5], [10, 3.5]],
  prims: [
    { t: "line", p: [0, 3.5, 2.5, 3.5] },
    { t: "line", p: [7.5, 3.5, 10, 3.5] },
    { t: "circle", p: [3.4, 3.5, 0.9], fill: "white" },
    { t: "circle", p: [6.6, 3.5, 0.9], fill: "white" },
    { t: "line", p: [2.6, 2.2, 7.4, 2.2] },
    { t: "line", p: [5, 2.2, 5, 1.0] },
    { t: "line", p: [4.3, 1.0, 5.7, 1.0] },
    { t: "text", p: [5, 6.6], size: 2, anchor: "middle", field: "label" }
  ]
};
```

**(b) emergency(非常停止b接点)** — PBE1形。ブレードが円上端に接触(閉)、
キノコ頭(T形大型)、下に戻し弧、右肩に小さな「R」。

```js
SYMBOL_GEO.pushButtonEmergency = {
  w: 10, h: 6,
  anchors: [[0, 3.8], [10, 3.8]],
  prims: [
    { t: "line", p: [0, 3.8, 2.5, 3.8] },
    { t: "line", p: [7.5, 3.8, 10, 3.8] },
    { t: "circle", p: [3.4, 3.8, 0.9], fill: "white" },
    { t: "circle", p: [6.6, 3.8, 0.9], fill: "white" },
    { t: "line", p: [2.4, 2.9, 7.6, 2.9] },
    { t: "line", p: [5, 2.9, 5, 1.5] },
    { t: "line", p: [3.6, 1.5, 6.4, 1.5] },
    { t: "arc", p: [5, 3.8, 1.9, 20, 160] },
    { t: "text", p: [7.6, 1.5], size: 1.6, anchor: "start", value: "R" },
    { t: "text", p: [5, 6.8], size: 2, anchor: "middle", field: "label" }
  ]
};
```

右パネル(specificFields の pushButton 分岐)に「PB形状: 標準 / 非常停止(キノコ)」の
`pbStyle` セレクトを追加。既存の「接点方向」セレクトは維持。

### 4.9 切替スイッチ `selectorSwitch`(KS1形)

円2+それぞれ上向き縦線→内向きフックの「持ち手」。ラベルは下。

```js
SYMBOL_GEO.selectorSwitch = {
  w: 10, h: 5,
  anchors: [[0, 3.2], [10, 3.2]],
  prims: [
    { t: "line", p: [0, 3.2, 2.5, 3.2] },
    { t: "line", p: [7.5, 3.2, 10, 3.2] },
    { t: "circle", p: [3.4, 3.2, 0.9], fill: "white" },
    { t: "circle", p: [6.6, 3.2, 0.9], fill: "white" },
    { t: "pline", pts: [[3.4, 2.3], [3.4, 1.4], [4.1, 1.4]] },
    { t: "pline", pts: [[6.6, 2.3], [6.6, 1.4], [5.9, 1.4]] },
    { t: "text", p: [5, 6.2], size: 2, anchor: "middle", field: "label" }
  ]
};
```

**ポジション表示 `positionMark`(新規タイプ)**: 切替スイッチの「入/切」を配線上に示す補助記号。
- `markStyle:"box"`: 配線を跨ぐ縦線(長さ6)+中央に1.6×1.6の小矩形(白抜き)。
- `markStyle:"line"`: 縦線のみ。
- ラベル(入/切)は上に2.0mm。

```js
SYMBOL_GEO.positionMarkBox = {
  w: 4, h: 6,
  anchors: [[2, 3]],
  prims: [
    { t: "line", p: [2, 0, 2, 6] },
    { t: "rect", p: [1.2, 2.2, 1.6, 1.6], fill: "white" },
    { t: "text", p: [2, -1.4], size: 2, anchor: "middle", field: "label" }
  ]
};
SYMBOL_GEO.positionMarkLine = {
  w: 4, h: 6,
  anchors: [[2, 3]],
  prims: [
    { t: "line", p: [2, 0, 2, 6] },
    { t: "text", p: [2, -1.4], size: 2, anchor: "middle", field: "label" }
  ]
};
```

`PALETTE` に `{ type: "positionMark", label: "ポジション表示", icon: "line" }` を追加。
配置は中心基準(`centerPlacedTypes` に追加)。配線は分割しない。

### 4.10 リミットスイッチ `limitSwitch`

円2+**円の上に浮いた横長矩形**(4.2×1.3、白抜き)。従来のヒンジ+ローラ表現は廃止。

```js
SYMBOL_GEO.limitSwitch = {
  w: 10, h: 4.6,
  anchors: [[0, 2.8], [10, 2.8]],
  prims: [
    { t: "line", p: [0, 2.8, 2.5, 2.8] },
    { t: "line", p: [7.5, 2.8, 10, 2.8] },
    { t: "circle", p: [3.4, 2.8, 0.9], fill: "white" },
    { t: "circle", p: [6.6, 2.8, 0.9], fill: "white" },
    { t: "rect", p: [2.9, 0.4, 4.2, 1.3], fill: "white" },
    { t: "text", p: [5, -1.2], size: 2, anchor: "middle", field: "label" }
  ]
};
```

### 4.11 圧力スイッチ `pressureSwitch`(新規タイプ、PS1形)

円2+**斜めブレード**(左円から右下がり)+ブレード中央から下がるステム+**ドーム形**(半円+底線)。

```js
SYMBOL_GEO.pressureSwitch = {
  w: 10, h: 6,
  anchors: [[0, 2.2], [10, 2.2]],
  prims: [
    { t: "line", p: [0, 2.2, 2.5, 2.2] },
    { t: "line", p: [7.5, 2.2, 10, 2.2] },
    { t: "circle", p: [3.4, 2.2, 0.9], fill: "white" },
    { t: "circle", p: [6.6, 2.2, 0.9], fill: "white" },
    { t: "line", p: [4.1, 1.7, 7.3, 3.2] },
    { t: "line", p: [4.6, 2.6, 4.6, 3.6] },
    { t: "arc", p: [4.6, 4.7, 1.1, 180, 360] },
    { t: "line", p: [3.5, 4.7, 5.7, 4.7] },
    { t: "text", p: [5, -1.2], size: 2, anchor: "middle", field: "label" }
  ]
};
```

`PALETTE` に `{ type: "pressureSwitch", label: "圧力スイッチ", icon: "limitSwitch" }`、
`DEFAULT_TAG_PREFIXES.pressureSwitch = "PS"`、`wireBreakingTypes`/`centerPlacedTypes` に追加。

### 4.12 モータ `motor`

円 r6・**タグは円の中**(2.2mm)。左側に3本の端子スタブ
(小円端子 r0.9 → 斜め線で円周へ)、右下に接地用スタブ1本。

```js
SYMBOL_GEO.motor = {
  w: 16, h: 16,
  anchors: [[0.9, 2.4], [0.9, 8], [0.9, 13.6], [14.6, 14.6]],
  prims: [
    { t: "circle", p: [8, 8, 6], fill: "white" },
    { t: "circle", p: [0.9, 2.4, 0.9], fill: "white" },
    { t: "circle", p: [0.9, 8, 0.9], fill: "white" },
    { t: "circle", p: [0.9, 13.6, 0.9], fill: "white" },
    { t: "line", p: [1.7, 2.8, 3.76, 3.76] },
    { t: "line", p: [1.8, 8, 2, 8] },
    { t: "line", p: [1.7, 13.2, 3.76, 12.24] },
    { t: "line", p: [12.24, 12.24, 14.6, 14.6] },
    { t: "text", p: [8, 8], size: 2.2, anchor: "middle", field: "label" }
  ]
};
```

- 3相の配線は左の3つの小円端子へ水平接続する(スキャンでは配線は水平、斜めなのはスタブ)。
- 右下アンカー(14.6,14.6)は接地・接続用。
- 「M」1文字ではなく **タグ全体(M1A等)を円内に表示**する。円上のラベル表示は廃止。

### 4.13 接地 `ground`(縦線+斜線ハッチ3本)

従来の水平3本線(長→短)は**廃止**。縦ステム+45°の平行ハッチ3本(右下へずらして配置)。

```js
SYMBOL_GEO.ground = {
  w: 4, h: 5,
  anchors: [[2, 0]],
  prims: [
    { t: "line", p: [2, 0, 2, 2.6] },
    { t: "line", p: [2.0, 2.6, 0.87, 3.73] },
    { t: "line", p: [2.6, 3.05, 1.47, 4.18] },
    { t: "line", p: [3.2, 3.5, 2.07, 4.63] },
    { t: "text", p: [2, 6.6], size: 2, anchor: "middle", field: "label" }
  ]
};
```

### 4.14 端子 `terminal`(小円)

**⌀1.8の白抜き小円のみ**。ラベルは円の上(1.8mm)。従来の左右リード線+大きめ円は廃止
(リードは配線そのもので表現する)。盤境界通過端子(TC00)・機器手前端子(X080 の手前)・
ピン番号端子(15/7)はすべてこれ。

```js
SYMBOL_GEO.terminal = {
  w: 1.8, h: 1.8,
  anchors: [[0.9, 0.9], [0, 0.9], [1.8, 0.9]],
  prims: [
    { t: "circle", p: [0.9, 0.9, 0.9], fill: "white" },
    { t: "text", p: [0.9, -1.4], size: 1.8, anchor: "middle", field: "label" }
  ]
};
```

- `terminalShape:"square"` の場合は既存実装(角端子)を残す
  (geoKeyFor で `element.terminalShape === "square"` のとき null を返す)。
- 配線上に置くと anchors[1]/[2](左右端)で配線が1.8mmだけ分割され、円が白抜きで残る。

### 4.15 接続点 `junction`

塗りつぶし円 **r0.75**。`defaultElement` の r を 1.45→0.75、`autoJunctions()` 内の r を 1.35→0.75 に変更。
(geo 登録不要、既存 drawJunction のままでよい)

### 4.16 抵抗/バリスタ `resistor`

**リード線なしの枠矩形**(5×2.6)を配線に直挿しする形。バリスタは対角線1本を追加。
縦配線には `orientation:"vertical"` で自動回転。

```js
SYMBOL_GEO.resistor = {
  w: 10, h: 2.6,
  anchors: [[0, 1.3], [10, 1.3]],
  prims: [
    { t: "line", p: [0, 1.3, 2.5, 1.3] },
    { t: "line", p: [7.5, 1.3, 10, 1.3] },
    { t: "rect", p: [2.5, 0, 5, 2.6], fill: "white" },
    { t: "text", p: [5, -1.2], size: 2, anchor: "middle", field: "label" }
  ]
};
SYMBOL_GEO.varistor = {
  w: 10, h: 2.6,
  anchors: [[0, 1.3], [10, 1.3]],
  prims: [
    { t: "line", p: [0, 1.3, 2.5, 1.3] },
    { t: "line", p: [7.5, 1.3, 10, 1.3] },
    { t: "rect", p: [2.5, 0, 5, 2.6], fill: "white" },
    { t: "line", p: [2.5, 2.6, 7.5, 0] },
    { t: "text", p: [5, -1.2], size: 2, anchor: "middle", field: "label" }
  ]
};
```

右パネル(specificFields)に「抵抗形状: 標準 / バリスタ」(`resistorStyle`)を追加。
`autoOrientElementForPlacement` の対象タイプに `resistor` を追加(縦配線上で自動縦向き)。

### 4.17 コネクタ対 `connector`(connStyle:"pair")

プラグ(縦バー)+ソケット(対向弧)。`J141 J142` のような対ラベルは label にスペース区切りで入れる。

```js
SYMBOL_GEO.connectorPair = {
  w: 6, h: 3,
  anchors: [[0, 1.5], [6, 1.5]],
  prims: [
    { t: "line", p: [0, 1.5, 2.3, 1.5] },
    { t: "line", p: [2.3, 0.3, 2.3, 2.7] },
    { t: "arc", p: [3.9, 1.5, 1.2, 270, 450] },
    { t: "line", p: [5.1, 1.5, 6, 1.5] },
    { t: "text", p: [3, 4.4], size: 1.8, anchor: "middle", field: "label" }
  ]
};
```

既存の丸端子列コネクタ(count 指定)は `connStyle` 未指定時にそのまま維持。

### 4.18 信号矢印 `arrow` の4スタイル

`element.arrowStyle`(既定 "open")を追加し、`drawArrow`/`dxfElement` の arrow 分岐を拡張:

| スタイル | 用途(実測) | 形状 |
|---|---|---|
| `open` | インターロックの送り先(→) | 後ろ向きバーブ2本、長さ3.0、半角20° |
| `solid` | 他ページからの継続(太矢印) | 塗り三角、長さ3.4、半角15° |
| `fork` | 母線・レールの端(Y字) | **前向き**に開くバーブ2本、長さ3.2、半角25° |
| `chevron` | 配線の継続マーク(>) | 後ろ向きバーブ、長さ2.2、半角28°(軸線は描かない・端点に置く) |

実装(drawArrow を置換):

```js
function drawArrow(g, element, stroke) {
  const points = element.points || [[element.x || 0, element.y || 0], [(element.x || 0) + 30, element.y || 0]];
  const a = points[0];
  const b = points[points.length - 1];
  const style = element.arrowStyle || "open";
  if (style !== "chevron") {
    g.appendChild(svgEl("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: "symbol-line", stroke }));
  }
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const SPEC = { open: [3, .35], solid: [3.4, .26], fork: [3.2, .44], chevron: [2.2, .49] };
  const head = (tip, dirAngle) => {
    const [len, half] = SPEC[style] || SPEC.open;
    const sgn = style === "fork" ? 1 : -1; // fork は進行方向の前へ開く、他は後ろ向きバーブ
    const q1 = [tip[0] + sgn * len * Math.cos(dirAngle - half), tip[1] + sgn * len * Math.sin(dirAngle - half)];
    const q2 = [tip[0] + sgn * len * Math.cos(dirAngle + half), tip[1] + sgn * len * Math.sin(dirAngle + half)];
    if (style === "solid") {
      g.appendChild(svgEl("path", { d: "M " + q1[0] + " " + q1[1] + " L " + tip[0] + " " + tip[1] + " L " + q2[0] + " " + q2[1] + " Z", fill: stroke, stroke: "none" }));
    } else {
      g.appendChild(svgEl("path", { d: "M " + q1[0] + " " + q1[1] + " L " + tip[0] + " " + tip[1] + " L " + q2[0] + " " + q2[1], class: "symbol-line", stroke, fill: "none" }));
    }
  };
  head(b, angle);
  if (element.arrowAtStart) head(a, angle + Math.PI);
  if (element.label) {
    const mid = pathMid(a, b);
    g.appendChild(textEl(element.label, mid.x, mid.y - 3, { fontSize: 2.4, anchor: "middle" }));
  }
  if ((element.signalRole || "reference") !== "reference") {
    g.appendChild(textEl(signalRoleLabel(element.signalRole), b[0], b[1] + 4.5, { fontSize: 2.1, anchor: "middle" }));
  }
}
```

DXF側 `dxfElement` の arrow 分岐も同じ規則でバーブ2線(solid は塗りの代わりに三角形3線)を出力する。
右パネル(specificFields の arrow 分岐)に矢印スタイルのセレクト
(参照/開き・塗り・フォーク・シェブロン)と `arrowAtStart` チェックを追加。

### 4.19 極性マーク `polarityMark`(新規タイプ、⊕/⊖)

レール上端の P1(⊕)/N1(⊖)。円 r1.1+中の記号。

```js
SYMBOL_GEO.polarityMark = {
  w: 2.6, h: 2.6,
  anchors: [[1.3, 2.6]],
  prims: [
    { t: "circle", p: [1.3, 1.3, 1.1], fill: "white" },
    { t: "line", p: [0.55, 1.3, 2.05, 1.3] },
    { t: "text", p: [1.3, -1.2], size: 2.2, anchor: "middle", field: "label" }
  ]
};
```

- `sign:"+"` のときは縦線 `{ t:"line", p:[1.3,0.55,1.3,2.05] }` を追加した形にする。
  実装は geoKeyFor ではなく **prims を動的に組む**か、`polarityMarkPlus`/`polarityMarkMinus` の
  2定義に分けて `sign` で切り替える(推奨: 2定義方式)。
- `PALETTE` に `{ type: "polarityMark", label: "極性マーク", icon: "dot" }` を追加。

### 4.20 接点ブロック `contactBlock`(実線矩形+内部ラダー接点)

CB補助接点(CB1)形。**実線**矩形14×8+内部にラダー接点(バー2本)。
点線枠が必要な場合(グループ囲み)は `blockFrame:"dashed"`。

```js
SYMBOL_GEO.contactBlock = {
  w: 14, h: 8,
  anchors: [[0, 4], [14, 4]],
  prims: [
    { t: "rect", p: [0, 0, 14, 8] },
    { t: "line", p: [1.2, 4, 6.0, 4] },
    { t: "line", p: [8.0, 4, 12.8, 4] },
    { t: "rect", p: [6.0, 2.4, 0.6, 3.2], fill: "white" },
    { t: "rect", p: [7.4, 2.4, 0.6, 3.2], fill: "white" },
    { t: "text", p: [7, -1.4], size: 2, anchor: "middle", field: "label" }
  ]
};
```

- `blockContact:"NC"` のときは斜線 `{ t:"line", p:[5.8,6.2,8.2,1.8] }` を追加
  (contactNC と同じ要領。2定義 `contactBlock`/`contactBlockNC` に分けて切替)。
- `blockFrame:"dashed"` のとき外枠 rect に `dash:"1.4 1.2"` を付ける
  (geoPrims 生成後に外枠 prim へ dash を注入するか、4定義に分ける。実装しやすい方でよい)。

### 4.21 機器箱 `deviceBox`(整流器タイプ)

スキャンの機器箱(整流器・インバータ等)は:
- 枠矩形のみ(**外部スタブ線は無し**。配線は枠線まで直接引く)
- ピン番号/端子名は**枠の内側**、入線位置の脇に書く(左: x=1.5 左寄せ / 右: x=w-1.5 右寄せ、2.2mm)
- 機器名は箱内中央(複数行可)

既存 `drawDeviceBox`/DXF を次のとおり修正(geo 登録ではなく既存関数の修正で対応):
- `-5〜0` / `w〜w+5` の外部スタブ線を削除(または `stubLen` フィールド既定0)。
- 接続アンカーは枠上のピン位置 `(0,y)` `(w,y)` のまま維持(配線吸着位置は変わらない)。
- ピン文字サイズを 1.8→2.2 に変更。

### 4.22 PLC/I-O `plcBlock`(ユニット列スタイル)

scan-001.pdf 全ページの右側に出る I/O ユニット表現。`plcStyle:"unit"`(新規、既定は従来の "grid")。

構成(横幅 **10.5mm** の縦長カラム):
- 左右の縦線2本(x=0, x=10.5)。上下端は**波形破断線**で閉じる。
- 端子円: r3.5、カラム中心(x=5.25)、縦ピッチ **9.5mm**。円内にアドレス文字(2.0mm)。
- ユニット名(QX82(3/4) 等)はカラム上端の上 2mm に 2.2mm で左寄せ表示(`label` を使用)。
- 接続アンカー: 各端子円の**左端縁 (0, y_i)**。

実装(drawPlcBlock に分岐追加):

```js
function drawPlcUnitColumn(g, element, stroke) {
  const rows = Math.max(1, Number(element.rows || 8));
  const w = 10.5;
  const h = rows * 9.5;
  const labels = String(element.pinText || "").split(/\r?\n/);
  const wave = y => {  // 波形破断線(左端から右端へS字2山)
    return "M 0 " + y +
      " C 2 " + (y - 2.2) + " 3.5 " + (y - 2.2) + " 5.25 " + y +
      " C 7 " + (y + 2.2) + " 8.5 " + (y + 2.2) + " 10.5 " + y;
  };
  g.appendChild(svgEl("line", { x1: 0, y1: 0, x2: 0, y2: h, class: "symbol-line", stroke }));
  g.appendChild(svgEl("line", { x1: w, y1: 0, x2: w, y2: h, class: "symbol-line", stroke }));
  g.appendChild(svgEl("path", { d: wave(0), class: "symbol-line", stroke, fill: "none" }));
  g.appendChild(svgEl("path", { d: wave(h), class: "symbol-line", stroke, fill: "none" }));
  for (let i = 0; i < rows; i++) {
    const cy = 9.5 * i + 4.75;
    g.appendChild(svgEl("circle", { cx: w / 2, cy, r: 3.5, class: "terminal-dot", stroke }));
    if (labels[i]) g.appendChild(textEl(labels[i], w / 2, cy, { fontSize: 2, anchor: "middle" }));
  }
  if (element.label) g.appendChild(textEl(element.label, 0, -2.4, { fontSize: 2.2 }));
}
```

- `elementConnectionAnchors` の plcBlock 分岐: `plcStyle==="unit"` のとき
  `for i: add(0, 9.5*i+4.75)` に変更。
- DXF も同構成で出力(波線は 8 点折れ線近似でよい:
  `[[0,y],[1.8,y-1.6],[3.6,y-1.6],[5.25,y],[6.9,y+1.6],[8.7,y+1.6],[10.5,y]]`)。
- 既定サイズ: `w:10.5, h:rows*9.5`。resize系関数で w を固定。

### 4.23 ツイストペア/シールド `cableBundle`(生成テンプレート)

DA/DB/DG/SLD のツイストペア表現。単一シンボルではなく**複数要素の一括生成**で対応する
(左パネル「自動処理」に「ツイストペア」ボタンを追加し、ダイアログで本数/長さ/開始位置を指定)。

構成(実測: 導体ピッチ 6.3mm、束マーク=縦長楕円):
- 導体: 水平配線 n本、ピッチ 6.3mm。
- 両端の束マーク: 楕円 rx1.9 / ry = (n-1)*6.3/2 + 2.5、中心は導体群の中心。
  ※ SVG は `ellipse`、DXF は `dxfEllipseApproxLocal` を使用。
- 交差: 束マーク間で隣接導体が X 交差する斜線を2組(全導体を跨ぐ大きなX×2)。
- シールド: 上端導体の上 2mm と下端導体の下 2mm に**破線(3 2)**を楕円間に引き、
  SLD 線(最下段)に接続。
- 各導体の左端に `chevron` スタイル矢印(4.18)を置く。

生成コードは既存 `addReferenceTerminalWiringSet` と同じ要領で
`makeTwistedPairSet(page, x, y, count, span)` として実装(要素は wire/line/arrow の組合せ)。

### 4.24 表 `table` の斜線セル対応

センサ設定表(scan-001.pdf p16)の空欄セルは**対角斜線**で消し込まれている。
`element.cellDiagonals`(例 `"1,2;2,2;3,2"` = 行,列 を `;` 区切り、1始まり)を追加し、
`drawTable`/DXF の両方で該当セルに左下→右上の対角線を引く。

```js
function tableDiagonalCells(element) {
  return String(element.cellDiagonals || "").split(";").map(pair => pair.split(",").map(Number)).filter(p => p.length === 2 && p.every(Number.isFinite));
}
```

drawTable 内(セル文字描画の後):

```js
const diagonals = tableDiagonalCells(element);
if (diagonals.length) {
  const xs = [0]; colWidths.forEach(cw => xs.push(xs[xs.length - 1] + cw));
  const ys = [0]; rowHeights.forEach(rh => ys.push(ys[ys.length - 1] + rh));
  diagonals.forEach(([r, c]) => {
    if (r >= 1 && r <= rows && c >= 1 && c <= cols) {
      g.appendChild(svgEl("line", { x1: xs[c - 1], y1: ys[r], x2: xs[c], y2: ys[r - 1], class: "symbol-line", stroke }));
    }
  });
}
```

右パネルの table 分岐に「斜線セル(行,列;行,列)」入力を追加。

---

## 5. 図枠「設備標準」仕様(`frameVariant: "ladder"`)

全54ページが同一の図枠。既存4種に加えて **5種目 "ladder"** を追加する
(セレクトに「設備標準: 行番号+機器符号表」を追加。既存テンプレートは変更しない)。

### 5.1 レイアウト実測値(A4縦 210×297)

```text
外枠:            x 19〜191、y 18〜273(1本線。内側の二重線は無し)
行番号 00〜20:    x=25.5 中央揃え、y = 27.0 + 9.5*i (i=0..20)、3.0mm
作図領域:        y 27〜217 が回路領域、217〜224 は空き
クロス参照表:     x 19〜105.8、y 224〜273
  - 13等分列(列幅 6.677mm)
  - ヘッダ行 224〜229(機器タグを列ごとに 1.8mm で左寄せ)
  - 本体 229〜262(参照番号を 1.7mm で列内に縦に列挙)
  - 下部2行: 262〜267.5〜273(空欄)
機器符号表:       x 105.8〜191、y 224〜252.5
  - 2グループ×3列 [機器符号 11 / 機器符号内容 27.1 / 頁 4.5](グループ幅 42.6)
  - ヘッダ行 2.6mm + 明細10行(各約2.53mm)、文字 1.7mm
表題欄:          x 105.8〜191
  - 客先機番/装置区分: y 252.5〜258.5(x=137 で分割。ラベルはセル左上に 1.7mm)
  - 内容行:   y 258.5〜266.5(左に「内容」縦書きラベル列 x 105.8〜110、
              中央に page.title.title を 3.2mm 中央揃え、
              右に頁ボックス x 177〜191: 上段「頁」1.7mm・下段 page.title.page 3.5mm 中央)
  - 図番行:   y 266.5〜273(左に「図番」ラベル列、値は page.title.drawingNo、無ければ "−")
下部余白行(枠外): y 277、1.9mm
  - x19「汎用図番:」 x55「図番:」 x95「出力日: {page.title.date}」
    x125「更新日: {project.date}」 x190 右寄せ「自車 製造部 設備保全課 設備係」
ページ見出し:     作図領域上部 y 22.5、x105 中央揃え 3.5mm(page.name を表示)
```

### 5.2 タイトル項目マッピング

| 表題欄 | データ源 |
|---|---|
| 客先機番 | `page.title.installation` |
| 装置区分 | `page.title.facility` |
| 内容 | `page.title.title` |
| 頁 | `page.title.page` |
| 図番 | `page.title.drawingNo`(空なら "−") |
| 出力日 | `page.title.date` |
| 更新日 | `state.project.date` |

### 5.3 実装コード

`drawFrame()` に分岐を追加し、以下を実装する(coordinate番号列 `drawCoordinateNumbers` は
ladder では**呼ばない**。二重内枠も描かない):

```js
function drawLadderFrame(frame, page, size) {
  const L = 19, R = size.w - 19, T = 18, B = size.h - 24;
  frame.appendChild(svgEl("rect", { x: L, y: T, width: R - L, height: B - T, class: "frame-thick" }));
  for (let i = 0; i <= 20; i++) {
    frame.appendChild(textEl(String(i).padStart(2, "0"), 25.5, 27 + 9.5 * i, { fontSize: 3, anchor: "middle" }));
  }
  frame.appendChild(textEl(page.name || "", (L + R) / 2, 22.5, { fontSize: 3.5, anchor: "middle" }));
  const tblTop = B - 49, xrefR = 105.8;
  // クロス参照表(左)
  frame.appendChild(svgEl("rect", { x: L, y: tblTop, width: xrefR - L, height: B - tblTop, class: "frame-line" }));
  for (let i = 1; i < 13; i++) {
    const x = L + (xrefR - L) * i / 13;
    frame.appendChild(svgEl("line", { x1: x, y1: tblTop, x2: x, y2: B, class: "frame-light" }));
  }
  [tblTop + 5, B - 11, B - 5.5].forEach(y => frame.appendChild(svgEl("line", { x1: L, y1: y, x2: xrefR, y2: y, class: "frame-light" })));
  // 機器符号表(右上)
  const devTop = tblTop, devBottom = tblTop + 28.5;
  frame.appendChild(svgEl("rect", { x: xrefR, y: devTop, width: R - xrefR, height: devBottom - devTop, class: "frame-line" }));
  const gw = (R - xrefR) / 2;
  [0, 1].forEach(gi => {
    const gx = xrefR + gi * gw;
    frame.appendChild(svgEl("line", { x1: gx + 11, y1: devTop, x2: gx + 11, y2: devBottom, class: "frame-light" }));
    frame.appendChild(svgEl("line", { x1: gx + gw - 4.5, y1: devTop, x2: gx + gw - 4.5, y2: devBottom, class: "frame-light" }));
    frame.appendChild(textEl("機器符号", gx + 5.5, devTop + 1.6, { fontSize: 1.7, anchor: "middle" }));
    frame.appendChild(textEl("機 器 符 号 内 容", gx + 11 + (gw - 15.5) / 2, devTop + 1.6, { fontSize: 1.7, anchor: "middle" }));
    frame.appendChild(textEl("頁", gx + gw - 2.25, devTop + 1.6, { fontSize: 1.7, anchor: "middle" }));
  });
  frame.appendChild(svgEl("line", { x1: xrefR + gw, y1: devTop, x2: xrefR + gw, y2: devBottom, class: "frame-line" }));
  for (let i = 1; i <= 10; i++) {
    const y = devTop + 2.6 + (devBottom - devTop - 2.6) * i / 10;
    frame.appendChild(svgEl("line", { x1: xrefR, y1: y, x2: R, y2: y, class: "frame-light" }));
  }
  // 表題欄(右下)
  const t1 = devBottom, t2 = t1 + 6, t3 = t2 + 8, t4 = B;
  frame.appendChild(svgEl("rect", { x: xrefR, y: t1, width: R - xrefR, height: t4 - t1, class: "frame-thick" }));
  frame.appendChild(svgEl("line", { x1: xrefR, y1: t2, x2: R, y2: t2, class: "frame-line" }));
  frame.appendChild(svgEl("line", { x1: xrefR, y1: t3, x2: R, y2: t3, class: "frame-line" }));
  frame.appendChild(svgEl("line", { x1: 137, y1: t1, x2: 137, y2: t2, class: "frame-line" }));
  frame.appendChild(textEl("客先機番", xrefR + 1.2, t1 + 1.8, { fontSize: 1.7 }));
  frame.appendChild(textEl(page.title.installation || "", (xrefR + 137) / 2, (t1 + t2) / 2 + 1, { fontSize: 2.4, anchor: "middle" }));
  frame.appendChild(textEl("装置区分", 138.2, t1 + 1.8, { fontSize: 1.7 }));
  frame.appendChild(textEl(page.title.facility || "", (137 + R) / 2, (t1 + t2) / 2 + 1, { fontSize: 2.4, anchor: "middle" }));
  frame.appendChild(svgEl("line", { x1: 110, y1: t2, x2: 110, y2: t4, class: "frame-line" }));
  frame.appendChild(svgEl("line", { x1: 177, y1: t2, x2: 177, y2: t3, class: "frame-line" }));
  frame.appendChild(textEl("内", 107.9, t2 + 2.6, { fontSize: 1.9, anchor: "middle" }));
  frame.appendChild(textEl("容", 107.9, t2 + 5.4, { fontSize: 1.9, anchor: "middle" }));
  frame.appendChild(textEl(page.title.title || "", (110 + 177) / 2, (t2 + t3) / 2, { fontSize: 3.2, anchor: "middle" }));
  frame.appendChild(textEl("頁", 184, t2 + 1.8, { fontSize: 1.7, anchor: "middle" }));
  frame.appendChild(textEl(page.title.page || "", 184, t3 - 2.4, { fontSize: 3.5, anchor: "middle" }));
  frame.appendChild(textEl("図", 107.9, t3 + 2.2, { fontSize: 1.9, anchor: "middle" }));
  frame.appendChild(textEl("番", 107.9, t3 + 4.8, { fontSize: 1.9, anchor: "middle" }));
  frame.appendChild(textEl(page.title.drawingNo || "−", (110 + R) / 2, (t3 + t4) / 2, { fontSize: 2.6, anchor: "middle" }));
  // 下部余白行
  frame.appendChild(textEl("汎用図番:", L, size.h - 20, { fontSize: 1.9 }));
  frame.appendChild(textEl("図番:", 55, size.h - 20, { fontSize: 1.9 }));
  frame.appendChild(textEl("出力日: " + (page.title.date || ""), 95, size.h - 20, { fontSize: 1.9 }));
  frame.appendChild(textEl("更新日: " + (state.project.date || ""), 125, size.h - 20, { fontSize: 1.9 }));
  frame.appendChild(textEl("自車 製造部 設備保全課 設備係", R, size.h - 20, { fontSize: 2.1, anchor: "end" }));
}
```

※ 下部余白行の y は `size.h - 20 = 277`(A4縦)。A4横/A3でも同式で破綻しないことを確認する。
※ `drawFrame()` 冒頭の既存二重枠(rect 2本)は ladder のときスキップし、上記のみ描く。
※ DXF: `dxfFrame()` にも ladder 分岐を追加し、同じ線分・文字を `dxfLine`/`dxfText`/`dxfRect` で出力。

---

## 6. ページテンプレート

右パネルのテンプレート群に2つ追加する(既存テンプレートは変更しない)。

### 6.1 「設備ラダー」ページ(scan-001 (1).pdf のリレー回路型)

`addFacilityLadderPage()`:

```text
ページ設定: A4縦 / frameVariant "ladder" / name "リレー回路"
レール:  P1 x=32.5、N1 x=146.5。y 30〜217 の縦配線(wire)
         両端に fork矢印(arrow, arrowStyle:"fork", 長さ4の短い線分を重ねる か
         レール wire の両端に別要素として配置)
         上端: polarityMark(+) を (32.5, 24) 中心に、label "P1"
               polarityMark(−) を (146.5, 24) 中心に、label "N1"
         "(DC24V)" テキストを (40, 25.5) 1.9mm
ラング:  y = 27 + 9.5*行番号。左レールとの交点に junction(r0.75)
```

### 6.2 「PLC入力回路」ページ(scan-001.pdf 全ページの型)

`addPlcInputCircuitPage()`(データ行 = アドレス/接点タグ/説明 の配列を持つ):

```text
ユニット列: plcBlock(plcStyle:"unit") x=130.5、y=行01の円が y36.5 になる位置
            (element.y = 36.5 - 4.75 = 31.75)、rows=16、
            pinText = "X060\nX061\n..."、label = "QX82(1/4)"
各行 i(行01〜行17、ピッチ9.5):
  y_i = 36.5 + 9.5*(i-1)
  - 左レール junction (32.5, y_i)
  - 接点 contactNO: 中心 x=48(element.x = 44, y = y_i - 2.2)、label=接点タグ、refNo=参照番号
  - 配線: (32.5,y_i)-(44,y_i)、(52,y_i)-(128.2,y_i)
  - 端子 terminal: 中心 (129.3, y_i)(円がユニット左縁に接する)、label=アドレス
    ※ラベルは配線上左側に出すため、terminal の label 表示位置は上-左(x-2)へ
  - 説明テキスト: (149.5, y_i) 左寄せ 2.3mm
ヘッダ: "制御盤" は page.name として図枠見出しに出る
```

### 6.3 インターロックページ(任意・後回し可)

- 盤枠: rect(実線)、外部装置枠: rect + `dash:"6 1.5 1.5 1.5"`(一点鎖線近似)。
  `installationBox`/`locationBox` の specificFields「枠線破線」プレースホルダに
  一点鎖線例 `6 1.5 1.5 1.5` を追記。
- 境界通過: 枠線上に terminal(小円)+上ラベル。
- 送り矢印: arrow(open)、受け側: arrow(solid)+ chevron。

---

## 7. index.html への統合手順(この順で実施)

各ステップ後に必ず「8.1 構文チェック」を実行し、受入条件を確認してから次へ。

| Step | 作業 | 受入条件 |
|---|---|---|
| 1 | 2.3 のレジストリ+レンダラ+`dxfArcLocal` を追加し、2.4 の3箇所へ接続(レジストリは空のまま) | 画面表示・DXF出力が従来と完全に同一 |
| 2 | 4.1〜4.3 を登録、defaultElement の contactNO/NC/thermalRelay を更新、`resizeGeoElementForOrientation` 導入、`refNo` を右パネル(labelFields か specificFields)に追加 | a接点=バー2本・b接点=+斜線・OL=○✕○。横配線上に置くと左右8mm間隔で配線分割。縦向きも正しく回転 |
| 3 | 4.4 thermalElement、4.11 pressureSwitch、4.9 positionMark、4.19 polarityMark の新タイプ追加(PALETTE/タグ接頭辞/centerPlaced/wireBreaking/paletteLabel)。positionMark と polarityMark は `supportsElectricalAttributes` の除外リストへ追加 | パレットから配置でき、検索・帳票・監査でエラーが出ない |
| 4 | 4.5 breaker、4.6 coil、4.7 lamp(+lampColor入力)、4.16 resistor/varistor を登録・更新 | 各記号がスキャン形状で描画、DXFも同形 |
| 5 | 4.8 pushButton(pbStyle)、4.10 limitSwitch、4.9 selectorSwitch を登録・更新 | PB標準/非常停止の切替が右パネルで可能 |
| 6 | 4.12 motor、4.13 ground、4.14 terminal、4.15 junction 半径、4.17 connectorPair | モータ円内タグ・接地ハッチ・小円端子。既存保存データ(旧terminal)も開ける |
| 7 | 4.18 arrow 4スタイル(SVG+DXF+右パネル) | fork/open/solid/chevron が選べる |
| 8 | 4.21 deviceBox 修正、4.22 plcBlock unitスタイル | 整流器箱(内部ピン番号)とPLCユニット列が再現 |
| 9 | 5章 ladder 図枠(SVG+DXF+frameVariant セレクト追加) | 行番号00-20・機器符号表・表題欄がスキャンと一致 |
| 10 | 6.1/6.2 テンプレート、4.23 ツイストペア生成、4.24 表斜線セル | ボタン一発で s1_p2A / s2_p7A 相当の骨組みが出る |
| 11 | `docs/manual.md`・`docs/implementation-plan.md`・`docs/scan-reproduction-checklist.md` の更新は**行わない**(本タスクでは index.html のみ) | — |

**禁止事項**: 既存の保存/読込・Undo・複数選択・整列・帳票・監査・印刷コードの変更
(必要最小限のフィールド追加を除く)。既存 frameVariant 4種の変更。ファイル全体の再フォーマット。

---

## 8. 検証手順

### 8.1 構文チェック(毎ステップ)

PowerShell:

```powershell
$html = Get-Content -Raw index.html
$s = $html.IndexOf('<script>') + 8
$e = $html.LastIndexOf('</script>')
$js = $html.Substring($s, $e - $s)
Set-Content -Encoding utf8 _check.js $js
node --check _check.js
Remove-Item _check.js
```

エラー0件であること。(`_check.js` は一時ファイル。作業後必ず削除)

### 8.2 目視チェック(シンボル単位)

ブラウザで index.html を開き、各シンボルを1個ずつ配置して以下を確認:

| 確認項目 | 合格基準 |
|---|---|
| a接点 | バー2本(白抜き)、高さ≈3.2mm(ズーム3.2でバーが約10px)、タグ上・参照番号下 |
| b接点 | +斜線が両バーを貫通 |
| 遮断器 | 円2+上アーク+段差トリップ。縦向きで90度回転形 |
| コイル/ランプ | コイル=無印円、ランプ=ヒゲ4本+色文字。**両者が区別できる** |
| モータ | タグが円内、左に小円端子3つ |
| 接地 | 縦線+斜めハッチ3本(水平バー3本になっていないこと) |
| 端子 | ⌀1.8 小円。配線上に置くと配線が円で途切れる |
| PLCユニット | 波形破断線+⌀7円+アドレス文字 |
| DXF | 同じ図面を DXF 出力し、内容(LINE/CIRCLE/ARC座標)がSVGと同位置 |

### 8.3 下絵オーバーレイ(ページ単位の最終確認)

1. 参照PDFの対象ページを PNG 化(ユーザーが用意。90度時計回り回転→左右分割の既存ルール)。
2. ツールの「2面下絵ページ」または「下絵画像」で読み込み、透明度0.35のまま重ねる。
3. その上へテンプレート(6.1/6.2)+シンボルを配置し、ズーム6以上で以下を照合:
   - 行番号位置・レール位置(±1mm)
   - 接点のバー間隔・円径(±0.3mm)
   - 図枠の表題欄罫線(±0.5mm)
4. 照合結果を `docs/scan-reproduction-checklist.md` の該当行に記録する(チェックは人が行う)。

### 8.4 ページ別・必要シンボル対応表(再現の受入基準)

| ページ | 必要な機能/シンボル(本書の節) |
|---|---|
| scan-001.pdf p1A〜p15B(入力/CC-LINK回路) | 4.1, 4.3, 4.10, 4.11, 4.14, 4.15, 4.18(chevron/solid), 4.19, 4.22, 5, 6.2 |
| scan-001.pdf p16A/B(センサ設定表) | 4.24(斜線セル)+ 既存の非等幅表、5 |
| scan-001 (1).pdf p1A/B(系統図) | 既存 rect/circle/text + 4.14(凡例○■□は rect/text で作図) |
| scan-001 (1).pdf p2A〜p4B(インターロック) | 4.1, 4.2, 4.14, 4.18(open/solid/chevron), 6.3, 一点鎖線枠 |
| scan-001 (1).pdf p5A〜p6B(AC電源・モータ) | 4.4, 4.5(3極+連動破線), 4.12, 4.13, 4.14, 4.16, 4.17, 4.21, 4.23, 5 |
| scan-001 (1).pdf p7A/B(非常停止) | 4.6, 4.8(emergency), 4.18, 4.20(dashed枠), 5, 6.1 |
| scan-001 (1).pdf p8A〜p9B(リレー回路) | 4.3, 4.6, 4.7, 4.8, 4.9(+positionMark), 4.17, 4.20, 5, 6.1 |
| scan-001 (1).pdf p10A〜p11B(GC-1000) | 4.1, 4.14, 4.22(波破断ユニット), 5, 6.1 |

---

## 9. 補足(将来課題・本タスク対象外)

- ブザー記号: 参照スキャン54ページ中に**ブザーは出現しない**。既存実装を維持し、照合対象から外す。
- 端子台(ねじ端子列)・ケーブルマーカー・端子箱: 今回の参照PDFには明確な出現なし。既存実装を維持。
- クロス参照表(5.1 左下表)への**自動データ流し込み**(コイルタグ→接点参照番号)は
  クロスリファレンス機能の拡張として次フェーズで検討。
- 一点鎖線の正確な JIS 線種(長短長)は SVG `stroke-dasharray "6 1.5 1.5 1.5"` 近似で可。
- 本書の寸法はスキャン実測(±0.3mm)。印刷比較で系統的なズレが見つかった場合のみ、
  **基本定数(3章)単位で**補正すること(個別シンボルを場当たりで変えない)。
