# -*- coding: utf-8 -*-
"""取扱説明書の図74(パレット・図枠・文字表示の説明図)を描く。

シンボルの一覧図(図59・66・70〜73・75〜84)はアプリ本体の描画から
docs/tools/capture-symbol-figures.js が生成する。ここで別途描き起こすと実装とずれるため、
このスクリプトはシンボル図を扱わない。
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "images" / "manual"
FONT_PATH = Path(r"C:\Windows\Fonts\meiryo.ttc")
BOLD_PATH = Path(r"C:\Windows\Fonts\meiryob.ttc")

INK = "#34414b"
ACCENT = "#0f6f63"
GRID = "#e8eef2"
GRID_MAJOR = "#d9e3e9"
PANEL = "#f7fafb"


def font(size: int, bold: bool = False):
    path = BOLD_PATH if bold and BOLD_PATH.exists() else FONT_PATH
    return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.load_default()


def base_image(width: int, height: int, title: str):
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    for x in range(0, width, 20):
        draw.line((x, 0, x, height), fill=GRID_MAJOR if x % 100 == 0 else GRID, width=1)
    for y in range(0, height, 20):
        draw.line((0, y, width, y), fill=GRID_MAJOR if y % 100 == 0 else GRID, width=1)
    draw.rectangle((0, 0, width, 56), fill="#eef5f4")
    draw.text((28, 14), title, font=font(27, True), fill="#173f3a")
    return image, draw


def save_ui_terms():
    image, draw = base_image(1600, 600, "更新後のパレット・図枠・文字表示")
    # 左: パレットの並び
    draw.rounded_rectangle((32, 88, 505, 565), radius=16, fill=PANEL, outline="#c4d1d8", width=2)
    draw.text((58, 110), "接点・スイッチ", font=font(24, True), fill="#173f3a")
    labels = ["a接点", "b接点", "限時a接点", "限時b接点", "電磁接触器", "近接スイッチ", "熱電対"]
    for i, name in enumerate(labels):
        x = 58 + (i % 2) * 210; y = 160 + (i // 2) * 82
        draw.rounded_rectangle((x, y, x + 190, y + 62), radius=9, fill="white", outline="#b9c9cf", width=2)
        draw.text((x + 95, y + 31), name, font=font(18, i >= 4), fill=INK, anchor="mm")
    # 中: 図枠セレクト
    draw.rounded_rectangle((548, 88, 1050, 565), radius=16, fill=PANEL, outline="#c4d1d8", width=2)
    draw.text((576, 112), "図枠/表題欄", font=font(24, True), fill="#173f3a")
    draw.rounded_rectangle((578, 164, 1020, 224), radius=8, fill="white", outline=ACCENT, width=3)
    draw.text((598, 194), "ラダー: 行番号+機器符号表", font=font(21, True), fill=INK, anchor="lm")
    draw.text((578, 264), "旧称は使用しません", font=font(18), fill="#6b4650")
    draw.text((578, 314), "行番号 00〜20 / ピッチ9.5mm", font=font(18), fill=INK)
    draw.text((578, 354), "左下: クロス参照表", font=font(18), fill=INK)
    draw.text((578, 394), "右下: 機器符号表＋表題欄", font=font(18), fill=INK)
    # 右: 文字スタイル
    draw.rounded_rectangle((1092, 88, 1568, 565), radius=16, fill=PANEL, outline="#c4d1d8", width=2)
    draw.text((1120, 112), "文字スタイル", font=font(24, True), fill="#173f3a")
    draw.text((1120, 172), "文字サイズ mm", font=font(18), fill=INK)
    draw.rounded_rectangle((1120, 205, 1538, 265), radius=8, fill="white", outline=ACCENT, width=3)
    draw.text((1144, 235), "2.2", font=font(26, True), fill=INK, anchor="lm")
    draw.text((1330, 340), "MC1", font=font(44, True), fill=INK, anchor="mm")
    draw.line((1230, 390, 1430, 390), fill=INK, width=4)
    draw.text((1330, 436), "シンボルラベルは既定2.2mm", font=font(17), fill=INK, anchor="mm")
    draw.text((1330, 478), "直線・機械連動線だけ2.4mm", font=font(17), fill=INK, anchor="mm")
    image.save(OUT / "74-palette-frame-label.png")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    save_ui_terms()
    print(OUT / "74-palette-frame-label.png")


if __name__ == "__main__":
    main()
