# -*- coding: utf-8 -*-
"""取扱説明書のシンボル比較図を実装座標から再生成する。"""

from __future__ import annotations

from pathlib import Path
from math import hypot

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


def dashed(draw, xy, fill=INK, width=3, dash=9, gap=7):
    x1, y1, x2, y2 = xy
    length = hypot(x2 - x1, y2 - y1)
    if not length:
        return
    ux, uy = (x2 - x1) / length, (y2 - y1) / length
    at = 0.0
    while at < length:
        end = min(length, at + dash)
        draw.line((x1 + ux * at, y1 + uy * at, x1 + ux * end, y1 + uy * end), fill=fill, width=width)
        at += dash + gap


def cell(draw, box, label: str, note: str = ""):
    x1, y1, x2, y2 = box
    draw.rounded_rectangle((x1 + 8, y1 + 8, x2 - 8, y2 - 8), radius=14, fill="#ffffffdd", outline="#cbd8dd", width=2)
    label_y = y2 - (68 if note else 47)
    draw.rounded_rectangle((x1 + 16, label_y, x2 - 16, y2 - 18), radius=10, fill="#f8fbfa", outline=ACCENT, width=2)
    draw.text(((x1 + x2) / 2, label_y + 8), label, font=font(18, True), fill="#173f3a", anchor="ma")
    if note:
        draw.text(((x1 + x2) / 2, y2 - 39), note, font=font(13), fill="#53626d", anchor="ma")


class SymbolCanvas:
    def __init__(self, draw, origin, scale):
        self.draw = draw
        self.ox, self.oy = origin
        self.s = scale
        self.width = max(2, round(scale * 0.18))

    def p(self, x, y):
        return self.ox + x * self.s, self.oy + y * self.s

    def line(self, x1, y1, x2, y2, dash=False, width=None, fill=INK):
        pts = (*self.p(x1, y1), *self.p(x2, y2))
        if dash:
            dashed(self.draw, pts, fill=fill, width=width or self.width, dash=max(5, self.s * .65), gap=max(4, self.s * .5))
        else:
            self.draw.line(pts, fill=fill, width=width or self.width)

    def pline(self, points, close=False, fill=INK):
        pts = [self.p(x, y) for x, y in points]
        if close:
            pts.append(pts[0])
        self.draw.line(pts, fill=fill, width=self.width, joint="curve")

    def circle(self, x, y, r, fill="white"):
        x1, y1 = self.p(x - r, y - r)
        x2, y2 = self.p(x + r, y + r)
        self.draw.ellipse((x1, y1, x2, y2), fill=fill, outline=INK, width=self.width)

    def rect(self, x, y, w, h, fill="white", outline=INK):
        self.draw.rectangle((*self.p(x, y), *self.p(x + w, y + h)), fill=fill, outline=outline, width=self.width if outline else 0)

    def arc(self, x, y, r, start, end):
        self.draw.arc((*self.p(x - r, y - r), *self.p(x + r, y + r)), start=start, end=end, fill=INK, width=self.width)

    def text(self, x, y, value, size=1.8, anchor="mm", bold=False):
        self.draw.text(self.p(x, y), value, font=font(max(12, round(size * self.s * .82)), bold), fill=INK, anchor=anchor)


def base_contact(c: SymbolCanvas, nc=False, y=2.2):
    c.line(0, y, 3.9, y)
    c.line(6.1, y, 10, y)
    if nc:
        c.line(3.9, y - 1.5, 3.9, y)
        c.line(6.1, y, 3.4, y - 1.7)
    else:
        c.line(6.1, y, 3.6, y + 1.6)


def timer(c: SymbolCanvas, nc=False, upward=False):
    base_contact(c, nc)
    if nc:
        xs = ((4.4, 1.13), (5.1, 1.57))
        center = 4.75
    else:
        xs = ((4.5, 3.22), (5.2, 2.78))
        center = 4.85
    end = 5.1 if upward else 7.5
    for x, y in xs:
        c.line(x, y, x, end)
    c.arc(center, 6.3, 1.25, 180 if upward else 0, 360 if upward else 180)


def selector(c: SymbolCanvas, nc=False, mode="jis", positions=None):
    if mode == "jis":
        c.line(0, 3.2, 3.9, 3.2); c.line(6.1, 3.2, 10, 3.2)
        if nc:
            c.line(6.1, 1.7, 6.1, 3.2); c.line(3.9, 3.2, 6.6, 1.5)
        else:
            c.line(3.9, 3.2, 6.4, 1.6)
        c.pline([(4.1, 3.9), (4.1, 4.8), (5.9, 4.8), (5.9, 5.7)])
        c.line(5, 2.5, 5, 4.8, dash=True)
    else:
        c.line(0, 3.2, 2.4, 3.2); c.line(7.05, 3.2, 10, 3.2)
        c.circle(3, 3.2, .6); c.circle(6.45, 3.2, .6)
        c.pline([(3.6, 3.2), (4.2, 3.2), (4.2, 1.95)])
        c.pline([(5.15, 1.95), (5.15, 3.2), (5.85, 3.2)])
        if mode == "three":
            c.line(4.68, 1.95, 4.68, .7); c.line(3.7, .7, 5.65, .7)
        if mode == "key":
            c.circle(4.675, .75, .6); c.line(4.675, 1.35, 4.675, 1.6)
    if positions:
        names, closed = positions
        for index, name in enumerate(names):
            x = 17.5 + index * 10
            c.line(x, .2, x, 4.8)
            c.text(x, -1.0, name, size=1.7)
            if index in closed:
                c.rect(x - 1, 2.1, 2, 2.2, fill=None)


def contactor(c: SymbolCanvas, nc=False):
    c.line(0, 2.2, 3.9, 2.2); c.line(6.1, 2.2, 10, 2.2)
    if nc:
        c.line(6.1, .7, 6.1, 2.2); c.line(3.9, 2.2, 6.6, .5); c.arc(7.0, 2.2, .7, 180, 360)
    else:
        c.line(3.9, 2.2, 6.4, .6); c.arc(6.8, 2.2, .7, 180, 360)


def breaker(c: SymbolCanvas, kind):
    if kind == "jis":
        c.line(0, 3, 4.4, 3); c.line(7.4, 3, 12.5, 3)
        c.line(4.4, 3, 7.2, 1.2); c.line(6.65, .7, 7.75, 1.8); c.line(7.75, .7, 6.65, 1.8)
        return
    c.line(0, 3, 1.9, 3); c.arc(4.75, 3, 2.25, 180, 360)
    c.circle(2.5, 3, .6); c.circle(7, 3, .6)
    if kind == "trip":
        c.line(7.6, 3, 8.4, 3)
        c.pline([(8.4, 3), (8.4, 1.9), (9.4, 1.9), (9.4, 4.1), (10.2, 4.1), (10.2, 3), (12.5, 3)])
    else:
        c.line(7.6, 3, 12.5, 3)


def outlet(c: SymbolCanvas, earth=False):
    c.line(0, 2, 2.5, 2); c.line(0, 12, 2.5, 12)
    if earth:
        c.rect(2.5, 0, 7.5, 13.5, fill="white", outline=None)
        c.line(2.5, 0, 10, 0); c.line(2.5, 13.5, 10, 13.5); c.line(2.5, 0, 2.5, 13.5)
        c.line(10, 0, 10, 6.35); c.line(10, 7.65, 10, 13.5)
    else:
        c.rect(2.5, 0, 7.5, 13.5)
    for x, y1, y2 in ((5.2, 1.8, 4.4), (7.2, 1.8, 4.0), (5.2, 7.4, 10), (7.2, 7.4, 9.6)):
        c.line(x, y1, x, y2)
    if earth:
        c.circle(10, 7, .65); c.line(10.65, 7, 12.5, 7)
    else:
        c.line(5.3, 12, 7.7, 12); c.line(5.8, 12.8, 7.2, 12.8)


def motor(c: SymbolCanvas, two=False):
    c.circle(8, 8, 4.8)
    ys = (5.5, 10.5) if two else (3, 8, 13)
    for y in ys:
        c.circle(.9, y, .6)
    if two:
        c.line(1.47, 5.7, 3.47, 6.41); c.line(1.47, 10.3, 3.47, 9.59)
    else:
        c.line(1.39, 3.35, 4.07, 5.23); c.line(1.5, 8, 3.2, 8); c.line(1.39, 12.65, 4.07, 10.77)
    c.line(10.8, 11.9, 13.08, 15.05); c.circle(13.4, 15.5, .6); c.text(8, 8, "M", 2.5, bold=True)


def limit_switch(c: SymbolCanvas, nc=False):
    base_contact(c, nc)
    if nc:
        c.pline([(4.4, 1.885), (5.5, 1.193), (5.9, 1.828)], close=True)
    else:
        c.pline([(5.6, 2.52), (4.505, 3.221), (4.91, 3.853)], close=True)


def push_button(c: SymbolCanvas, kind):
    nc = kind == "nc"
    c.line(0, 3.5, 3.4, 3.5); c.line(6.6, 3.5, 10, 3.5)
    if nc:
        c.line(3.4, 3.5, 3.4, 5.15); c.line(6.6, 3.5, 3.4, 5.15)
    else:
        c.line(6.6, 3.5, 3.1, 5.3)
    if kind in ("no", "nc", "positive"):
        yy = 6.8 if nc else 6.6
        c.line(4.3, yy, 5.7, yy); c.line(5, yy, 5, yy - .6); c.line(5, yy - .6, 5, 4.4, dash=True)
    elif kind == "pull":
        c.pline([(4.2, 7), (4.2, 6.2), (5.8, 6.2), (5.8, 7)]); c.line(5, 6.2, 5, 4.45, dash=True)
    elif kind == "twist":
        c.pline([(4.2, 5.4), (4.2, 6.2), (5.8, 6.2), (5.8, 7)]); c.line(5, 6.2, 5, 4.45, dash=True)
    if kind == "positive":
        c.circle(1.5, 5.8, 1); c.line(.88, 5.8, 2.12, 5.8); c.pline([(1.8, 5.5), (2.12, 5.8), (1.8, 6.1)])


def coil(c: SymbolCanvas, kind):
    if kind == "coupled":
        for y in (2.7, 7.7):
            c.line(0, y, 3, y); c.line(7, y, 10, y)
        c.rect(3, .2, 4, 5); c.rect(3, 5.2, 4, 5)
        return
    c.line(0, 2.2, 3, 2.2); c.line(7, 2.2, 10, 2.2); c.rect(3, .2, 4, 4)
    if kind == "thermal":
        c.pline([(3, 2.2), (4.2, 2.2), (4.2, 1.2), (5.8, 1.2), (5.8, 2.2), (7, 2.2)])
    elif kind == "electric":
        c.line(4.13, 2.2, 6.18, 2.2); c.pline([(3.82, 1.64), (5, 2.2), (6.18, 1.64)]); c.line(5, 2.2, 5, 2.79)
    else:
        c.line(3, 2.2, 7, 2.2)


def proximity(c: SymbolCanvas, detector=False):
    if detector:
        c.line(0, 2.2, 3, 2.2); c.line(7, 2.2, 10, 2.2)
        c.pline([(3, 2.2), (5, .2), (7, 2.2), (5, 4.2)], close=True)
        c.line(3.54, 1.76, 6.46, 1.76); c.line(3.54, 2.64, 6.46, 2.64)
    else:
        base_contact(c); c.line(5, 3, 5, 4.6, dash=True)
        c.pline([(5, 4.6), (3.2, 6.3), (5, 8), (6.8, 6.3)], close=True)
        c.line(3.6, 5.96, 6.4, 5.96); c.line(3.6, 6.64, 6.4, 6.64)


def meter(c: SymbolCanvas, value):
    c.line(0, 2.2, 3.1, 2.2); c.line(6.9, 2.2, 10, 2.2); c.circle(5, 2.2, 1.9)
    c.text(5, 2.2, value, 2.3, bold=True)


def thermocouple(c: SymbolCanvas):
    c.line(0, 1.5, 8.4, 1.5); c.line(0, 6.5, 8.4, 6.5)
    c.line(8.4, 1.5, 11.8, 4); c.line(8.4, 6.5, 11.8, 4); c.circle(11.8, 4, .5, fill=INK)
    c.text(7.6, .25, "＋", 1.7); c.text(7.6, 7.55, "−", 1.7)


def photo_wired(c: SymbolCanvas, four=False):
    ys = (2.5, 7.5, 12.5, 17.5) if four else (2.5, 7.5, 12.5)
    names = ("+V", "0V", "NO", "NC") if four else ("+V", "0V", "OUT")
    for y, name in zip(ys, names):
        c.line(0, y, 4, y); c.text(4.8, y + .35, name, 1.35, anchor="lm")
    h = 20 if four else 15
    c.rect(4, 0, 11, h); c.circle(12, h / 2, 2.1)
    c.line(15, h / 2, 19.4, h / 2, dash=True); c.pline([(18.4, h/2-1), (19.6, h/2), (18.4, h/2+1)])


def light_wired(c: SymbolCanvas, receiver=False):
    if receiver:
        ys = (2.5, 7.5, 12.5, 17.5); names = ("+24V", "0V", "OSSD1", "OSSD2")
        c.rect(9, 0, 8, 20)
        for y, name in zip(ys, names):
            c.line(17, y, 21, y); c.text(16.3, y + .35, name, 1.25, anchor="rm")
            c.line(1.4, y, 8.8, y, dash=True); c.pline([(7.8, y-1), (9, y), (7.8, y+1)])
        c.text(13, 22.2, "受光器", 1.55)
    else:
        ys = (5, 10, 15); names = ("+24V", "0V", "TEST")
        c.rect(4, 0, 8, 20)
        for y, name in zip(ys, names):
            c.line(0, y, 4, y); c.text(4.7, y + .35, name, 1.25, anchor="lm")
        for y in (2.5, 7.5, 12.5, 17.5):
            c.line(12, y, 19.4, y, dash=True); c.pline([(18.4, y-1), (19.6, y), (18.4, y+1)])
        c.text(8, 22.2, "投光器", 1.55)


def photo_detector(c: SymbolCanvas, nc=False):
    base_contact(c, nc)
    mid = 4.75 if nc else 4.85
    c.line(mid, 1.35 if nc else 3, mid, 5, dash=True)
    c.rect(mid - 1.5, 5, 3, 2.4)
    for x in (mid + 2.45, mid + 1.25):
        c.line(x, 9.4, x - 2, 7.4); c.pline([(x-.8, 7.72), (x-2, 7.4), (x-1.68, 8.2)])


def light_contacts(c: SymbolCanvas):
    for y in (2.5, 12.5):
        c.line(0, y, 14.2, y); c.line(16.4, y, 25, y); c.line(16.4, y, 13.9, y + 1.6)
    c.line(15.15, 3.3, 15.15, 15, dash=True); c.rect(13.65, 15, 3, 2.4)
    for x in (17.2, 16):
        c.line(x, 19.4, x - 2, 17.4); c.pline([(x-.8, 17.72), (x-2, 17.4), (x-1.68, 18.2)])
    c.text(13.4, 1.4, "OSSD1", 1.4, anchor="rm"); c.text(13.4, 11.4, "OSSD2", 1.4, anchor="rm")


def save_timer():
    image, draw = base_image(1600, 430, "限時接点（JIS 07-05-01〜04）")
    labels = [("07-05-01  メーク・限時閉路", False, False), ("07-05-02  メーク・限時開路", False, True),
              ("07-05-03  ブレーク・限時開路", True, False), ("07-05-04  ブレーク・限時閉路", True, True)]
    for i, (label, nc, up) in enumerate(labels):
        box = (i * 400, 56, (i + 1) * 400, 430); cell(draw, box, label, "可動線中央から二重線")
        timer(SymbolCanvas(draw, (box[0] + 95, 110), 20), nc, up)
    image.save(OUT / "66-timer-contact-jis.png")


def save_switching():
    image, draw = base_image(1600, 990, "接点・切替・遮断器の追加デザイン")
    variants = [
        ("2位置 a接点", lambda c: selector(c)), ("2位置 b接点", lambda c: selector(c, True)),
        ("2位置 a＋切/入", lambda c: selector(c, positions=(("切", "入"), (1,)))),
        ("2位置 b＋切/入", lambda c: selector(c, True, positions=(("切", "入"), (0,)))),
        ("3位置", lambda c: selector(c, mode="three")),
        ("3位置＋入1/切/入2", lambda c: selector(c, mode="three", positions=(("入1", "切", "入2"), (0, 2)))),
        ("鍵付き", lambda c: selector(c, mode="key")),
        ("鍵付き＋切/入", lambda c: selector(c, mode="key", positions=(("切", "入"), (1,)))),
    ]
    for i, (label, fn) in enumerate(variants):
        row, col = divmod(i, 4); box = (col * 400, 56 + row * 300, (col + 1) * 400, 56 + (row + 1) * 300)
        cell(draw, box, label); fn(SymbolCanvas(draw, (box[0] + 72, box[1] + 92), 8.2 if "＋" in label else 16))
    last = [("電磁接触器 a", lambda c: contactor(c)), ("電磁接触器 b", lambda c: contactor(c, True)),
            ("遮断器 JIS", lambda c: breaker(c, "jis")), ("円＋アーク＋トリップ", lambda c: breaker(c, "trip")),
            ("円＋アーク", lambda c: breaker(c, "arc"))]
    for i, (label, fn) in enumerate(last):
        box = (i * 320, 656, (i + 1) * 320, 990); cell(draw, box, label)
        fn(SymbolCanvas(draw, (box[0] + 58, 740), 16))
    image.save(OUT / "70-switch-contactor-breaker.png")


def save_connections():
    image, draw = base_image(1600, 540, "盤内コンセントと回転機の接続点")
    items = [("箱形2口（受電2点）", lambda c: outlet(c)), ("箱形2口＋接地端子（3点）", lambda c: outlet(c, True)),
             ("回転機 3相＋接地（4点）", lambda c: motor(c)), ("回転機 2相＋接地（3点）", lambda c: motor(c, True))]
    for i, (label, fn) in enumerate(items):
        box = (i * 400, 56, (i + 1) * 400, 540); cell(draw, box, label, "○が配線接続点")
        fn(SymbolCanvas(draw, (box[0] + 88, 105), 18))
    image.save(OUT / "71-outlet-motor-variants.png")


def save_jis_additions():
    image, draw = base_image(1600, 940, "JIS C 0617の追加・是正デザイン")
    items = [
        ("位置SW a 07-08-01", lambda c: limit_switch(c)), ("位置SW b 07-08-02", lambda c: limit_switch(c, True)),
        ("押し 07-07-02", lambda c: push_button(c, "no")), ("引き 07-07-03", lambda c: push_button(c, "pull")),
        ("ひねり 07-07-04", lambda c: push_button(c, "twist")), ("確実動作 07-07-05", lambda c: push_button(c, "positive")),
        ("コイル 07-15-01", lambda c: coil(c, "box")), ("結合表示 07-15-02", lambda c: coil(c, "coupled")),
        ("熱動 07-15-21", lambda c: coil(c, "thermal")), ("電気式 07-15-22", lambda c: coil(c, "electric")),
        ("近接センサ 07-19-01", lambda c: proximity(c, True)), ("近接検出装置 07-20-02", lambda c: proximity(c)),
        ("電圧計 08-02-01", lambda c: meter(c, "V")), ("電流計 08-02-02", lambda c: meter(c, "A")),
        ("熱電対 08-06-01", lambda c: thermocouple(c)), ("ラベル既定 2.2mm", lambda c: (meter(c, "V"), c.text(5, -2.1, "PV1", 2.2, bold=True))),
        ("限定図記号・回転", lambda c: (c.pline([(1.5, 5), (1.5, 2.5), (6.5, 2.5), (6.5, 0)]), c.line(4, 2.5, 4, 8))),
        ("限定図記号・確実動作", lambda c: (c.circle(4, 3, 2.1), c.line(2.7, 3, 5.3, 3), c.pline([(4.7, 2.3), (5.3, 3), (4.7, 3.7)]), c.line(4, 5.1, 4, 8))),
    ]
    for i, (label, fn) in enumerate(items):
        row, col = divmod(i, 6); box = (col * 266.666, 56 + row * 294.6, (col + 1) * 266.666, 56 + (row + 1) * 294.6)
        cell(draw, box, label)
        fn(SymbolCanvas(draw, (box[0] + 53, box[1] + 92), 16))
    image.save(OUT / "72-jis-added-symbols.png")


def save_photo():
    image, draw = base_image(1600, 760, "光電スイッチ・ライトカーテンの多端子形と接点表現")
    items = [
        ("光電 3線式", lambda c: photo_wired(c)), ("光電 4線式", lambda c: photo_wired(c, True)),
        ("投光器 3線式", lambda c: light_wired(c)), ("受光器 4線式", lambda c: light_wired(c, True)),
        ("光電検出 a接点", lambda c: photo_detector(c)), ("光電検出 b接点", lambda c: photo_detector(c, True)),
        ("ライトカーテン OSSD2接点", lambda c: light_contacts(c)),
        ("投光器＋受光器の1組", None),
    ]
    for i, (label, fn) in enumerate(items):
        row, col = divmod(i, 4); box = (col * 400, 56 + row * 352, (col + 1) * 400, 56 + (row + 1) * 352)
        cell(draw, box, label, "端子は5mmピッチ")
        if fn:
            fn(SymbolCanvas(draw, (box[0] + 72, box[1] + 42), 10))
        else:
            light_wired(SymbolCanvas(draw, (box[0] + 32, box[1] + 58), 6.2))
            light_wired(SymbolCanvas(draw, (box[0] + 222, box[1] + 58), 6.2), True)
    image.save(OUT / "73-photo-light-curtain-variants.png")


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


def operator_symbol(c: SymbolCanvas, kind: str):
    if kind == "dc":
        c.line(1.5, 3, 6.5, 3); c.line(2, 4.1, 6, 4.1, dash=True); return
    if kind == "ac":
        c.text(4, 3.2, "〜", 3.0, bold=True); return
    if kind == "acdc":
        c.text(4, 2.4, "〜", 2.7, bold=True); c.line(2, 4.5, 6, 4.5); c.line(2.3, 5.3, 5.7, 5.3, dash=True); return
    if kind == "three":
        c.text(2.2, 3.2, "3", 2.0); c.text(5.2, 3.2, "〜", 2.8, bold=True); return
    if kind == "positive":
        c.circle(4, 3, 2.0); c.line(2.7, 3, 5.3, 3); c.pline([(4.7, 2.3), (5.3, 3), (4.7, 3.7)]); c.line(4, 5, 4, 8); return
    if kind == "manual":
        c.line(1.5, 2.5, 6.5, 2.5); c.line(4, 2.5, 4, 8); return
    if kind == "push":
        c.pline([(1.5, 0), (1.5, 2.5), (6.5, 2.5), (6.5, 0)]); c.line(4, 2.5, 4, 8); return
    if kind == "pull":
        c.pline([(1.5, 5), (1.5, 2.5), (6.5, 2.5), (6.5, 5)]); c.line(4, 2.5, 4, 8); return
    if kind == "rotate":
        c.pline([(1.5, 5), (1.5, 2.5), (6.5, 2.5), (6.5, 0)]); c.line(4, 2.5, 4, 8); return
    if kind == "key":
        c.circle(3, 2.5, 1.0); c.line(4, 2.5, 6, 2.5); c.line(4.5, 2.5, 4.5, 3.3); c.line(4, 2.5, 4, 8); return
    if kind == "roller":
        c.circle(4, 2, 1.1); c.line(4, 3.1, 4, 8); return
    if kind == "foot":
        c.pline([(1, 1), (3.6, 3.8), (7, .5)]); c.line(4, 3.4, 4, 8); return
    if kind == "emergency":
        c.arc(4, 3, 2, 180, 360); c.line(2, 3, 6, 3); c.line(4, 3, 4, 8); return
    if kind == "electromagnetic":
        c.rect(1.5, 1.5, 5, 2.5); c.line(.8, 2.75, 7.2, 2.75); c.line(4, 4, 4, 8); return
    if kind == "proximity":
        c.pline([(4, .6), (6.2, 2.7), (4, 4.8), (1.8, 2.7)], close=True); c.line(2.5, 2.2, 5.5, 2.2); c.line(2.5, 3.2, 5.5, 3.2); c.line(4, 4.8, 4, 8); return
    if kind == "touch":
        c.pline([(4, .6), (6.2, 2.7), (4, 4.8), (1.8, 2.7)], close=True); c.line(1.8, 2.7, 6.2, 2.7); c.line(4, 4.8, 4, 8); return
    if kind == "motor":
        c.circle(4, 2.5, 1.5); c.text(4, 2.5, "M", 1.4, bold=True); c.line(4, 4, 4, 8); return
    if kind == "thermal":
        c.pline([(1.5, 2.5), (1.5, 1), (3, 1), (3, 2.5), (4.5, 2.5), (4.5, 1), (6, 1), (6, 2.5)]); c.line(4, 2.5, 4, 8)


def save_operator_list():
    image, draw = base_image(1600, 900, "電流種別・操作機構の限定図記号")
    items = [("直流", "dc"), ("交流", "ac"), ("交直流", "acdc"), ("三相交流", "three"),
             ("手動", "manual"), ("確実動作", "positive"),
             ("押し", "push"), ("引き", "pull"), ("回転", "rotate"), ("キー", "key"),
             ("ローラ", "roller"), ("足踏み", "foot"),
             ("非常停止", "emergency"), ("電磁", "electromagnetic"), ("近接効果", "proximity"),
             ("接触", "touch"), ("電動機", "motor"), ("熱", "thermal")]
    for i, (label, kind) in enumerate(items):
        row, col = divmod(i, 6); box = (col * 266.666, 56 + row * 281.3, (col + 1) * 266.666, 56 + (row + 1) * 281.3)
        cell(draw, box, label)
        operator_symbol(SymbolCanvas(draw, (box[0] + 70, box[1] + 80), 16), kind)
    image.save(OUT / "59-jis-qualifier-operator.png")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    save_timer()
    save_switching()
    save_connections()
    save_jis_additions()
    save_photo()
    save_ui_terms()
    save_operator_list()
    print("manual symbol figures written:")
    for name in ("66-timer-contact-jis.png", "70-switch-contactor-breaker.png", "71-outlet-motor-variants.png",
                 "72-jis-added-symbols.png", "73-photo-light-curtain-variants.png", "74-palette-frame-label.png",
                 "59-jis-qualifier-operator.png"):
        print(OUT / name)


if __name__ == "__main__":
    main()
