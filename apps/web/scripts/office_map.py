#!/usr/bin/env python3
"""Generates the Saga OS office: an original pixel-art tileset (public/office/tiles.png) and a Tiled-compatible map
(public/office/hq.json, orthogonal, 32 px tiles, embedded tileset). Open hq.json in Tiled to edit the layout.

Layers: floor, shadow, walls, decor (rugs, chairs: walkable), furniture (desks, tables: solid), and object layers
`zones` (department rooms), `seats` (where helpers sit; property `dept`), `spots` (meeting seats, approvals desk,
coffee), `interactive` (clickable objects with an `action`), `labels` (room names).

Run: python3 scripts/office_map.py   (needs Pillow)
"""
from __future__ import annotations

import json
import random
from pathlib import Path

from PIL import Image, ImageDraw

T = 32
COLS = 8
OUT = Path(__file__).resolve().parent.parent / "public" / "office"
rnd = random.Random(7)

# ------------------------------------------------------------------ palette (original, warm studio look)
P = {
    "ink": (38, 36, 52), "wall": (64, 68, 96), "wall_hi": (98, 104, 142), "wall_lo": (44, 46, 66),
    "wood": (222, 208, 186), "wood_ln": (206, 190, 166), "wood_dk": (210, 194, 170),
    "stone": (214, 214, 220), "stone_ln": (198, 199, 208),
    "desk": (190, 142, 98), "desk_hi": (214, 170, 124), "desk_lo": (146, 104, 68),
    "metal": (70, 74, 92), "metal_hi": (118, 124, 148), "screen": (34, 40, 62), "screen_hi": (84, 128, 210),
    "chair": (58, 62, 84), "chair_hi": (92, 98, 128),
    "leaf": (74, 160, 102), "leaf_hi": (124, 200, 132), "leaf_lo": (46, 112, 74), "pot": (214, 120, 84), "pot_lo": (170, 88, 62),
    "white": (250, 250, 252), "glass": (186, 214, 236),
}
CARPET = {  # muted on purpose: the helpers carry the colour, the rooms stay calm
    "leadership": (222, 216, 206), "marketing": (224, 214, 210), "sales": (212, 220, 210), "support": (208, 219, 222),
    "engineering": (212, 214, 224), "finance": (220, 214, 226), "meeting": (210, 218, 230), "studio": (224, 220, 210),
}

tiles: list[Image.Image] = []
props: dict[int, dict] = {}
names: dict[str, int] = {}


def new() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    im = Image.new("RGBA", (T, T), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


def add(name: str, im: Image.Image, **p) -> int:
    names[name] = len(tiles)
    tiles.append(im)
    if p:
        props[len(tiles) - 1] = p
    return names[name]


def shade(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c[:3])


def add_multi(name: str, w: int, h: int, draw, **p) -> None:
    """Draw a w×h-tile piece on one canvas, then slice it into tiles name_x_y."""
    big = Image.new("RGBA", (w * T, h * T), (0, 0, 0, 0))
    draw(ImageDraw.Draw(big), big)
    for y in range(h):
        for x in range(w):
            add(f"{name}_{x}_{y}", big.crop((x * T, y * T, (x + 1) * T, (y + 1) * T)), **p)


# ------------------------------------------------------------------ floors
def floor_wood(dark=False):
    im, d = new()
    base = P["wood_dk"] if dark else P["wood"]
    d.rectangle([0, 0, T, T], fill=base)
    for row in range(4):
        y = row * 8
        d.line([0, y, T, y], fill=shade(base, 0.93))
        off = (row * 11) % T
        d.line([off, y, off, y + 7], fill=shade(base, 0.9))
        for _ in range(2):
            x = rnd.randrange(T)
            d.point((x, y + rnd.randrange(2, 7)), fill=shade(base, 0.96))
    return im


def floor_carpet(c):
    im, d = new()
    d.rectangle([0, 0, T, T], fill=c)
    for y in range(0, T, 4):
        for x in range((y // 4) % 2 * 2, T, 4):
            d.point((x, y), fill=shade(c, 0.95))
    return im


def floor_stone():
    im, d = new()
    d.rectangle([0, 0, T, T], fill=P["stone"])
    d.line([0, 0, T, 0], fill=P["stone_ln"])
    d.line([0, 16, T, 16], fill=P["stone_ln"])
    d.line([0, 0, 0, 15], fill=P["stone_ln"])
    d.line([16, 16, 16, 31], fill=P["stone_ln"])
    return im


add("wood", floor_wood())
add("wood2", floor_wood(True))
add("stone", floor_stone())
for k, c in CARPET.items():
    add(f"carpet_{k}", floor_carpet(c))


# ------------------------------------------------------------------ walls and shadow
def wall():
    im, d = new()
    d.rectangle([0, 0, T, T], fill=P["wall"])
    d.rectangle([0, 0, T, 3], fill=P["wall_hi"])
    d.rectangle([0, T - 4, T, T], fill=P["wall_lo"])
    d.line([0, 14, T, 14], fill=shade(P["wall"], 0.9))
    return im


def glass(vertical: bool):
    im, d = new()
    if vertical:
        d.rectangle([12, 0, 19, T], fill=(*P["glass"], 210))
        d.line([12, 0, 12, T], fill=P["metal_hi"])
        d.line([19, 0, 19, T], fill=P["metal_hi"])
        d.line([15, 4, 15, 12], fill=(255, 255, 255, 200))
    else:
        d.rectangle([0, 12, T, 19], fill=(*P["glass"], 210))
        d.line([0, 12, T, 12], fill=P["metal_hi"])
        d.line([0, 19, T, 19], fill=P["metal_hi"])
        d.line([4, 15, 12, 15], fill=(255, 255, 255, 200))
    return im


def shadow():
    im = Image.new("RGBA", (T, T), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for y in range(10):
        d.line([0, y, T, y], fill=(30, 28, 50, int(70 * (1 - y / 10))))
    return im


add("wall", wall(), collides=True)
add("glass_v", glass(True), collides=True)
add("glass_h", glass(False), collides=True)
add("shadow", shadow())


# ------------------------------------------------------------------ furniture
def desk(d: ImageDraw.ImageDraw, _im):
    # a 2×1 desk seen from above, monitor and keyboard on it; the chair sits in the tile below
    d.rounded_rectangle([2, 4, 2 * T - 3, T - 2], 4, fill=P["desk_lo"])
    d.rounded_rectangle([2, 3, 2 * T - 3, T - 5], 4, fill=P["desk"])
    d.line([6, 5, 2 * T - 7, 5], fill=P["desk_hi"])
    # one monitor + keyboard per seat (the left and the right half)
    for cx in (T // 2, T + T // 2):
        d.rectangle([cx - 3, 14, cx + 2, 17], fill=P["metal"])
        d.rounded_rectangle([cx - 12, 4, cx + 11, 15], 2, fill=P["metal"])
        d.rectangle([cx - 10, 6, cx + 9, 13], fill=P["screen"])
        d.line([cx - 8, 7, cx - 2, 7], fill=shade(P["screen_hi"], 0.8))
        d.rounded_rectangle([cx - 8, 20, cx + 7, 24], 1, fill=P["white"])
        d.line([cx - 6, 22, cx + 5, 22], fill=(200, 202, 212))
    d.ellipse([T - 4, 17, T + 2, 23], fill=P["white"])
    d.ellipse([T - 3, 18, T + 1, 21], fill=(130, 84, 54))


def chair(up=True):
    im, d = new()
    # seen from above, backrest towards the bottom (helper faces the desk above)
    d.ellipse([8, 6, 24, 22], fill=P["chair"])
    d.ellipse([10, 8, 22, 19], fill=P["chair_hi"])
    if up:
        d.rounded_rectangle([7, 21, 25, 27], 3, fill=P["chair"])
    else:
        d.rounded_rectangle([7, 2, 25, 8], 3, fill=P["chair"])
    return im


def plant():
    im, d = new()
    d.ellipse([7, 23, 25, 30], fill=(0, 0, 0, 40))
    d.rounded_rectangle([10, 17, 22, 28], 3, fill=P["pot"])
    d.rectangle([10, 17, 22, 19], fill=P["pot_lo"])
    for (x, y, r) in [(16, 10, 8), (10, 13, 6), (22, 13, 6), (16, 5, 5)]:
        d.ellipse([x - r, y - r, x + r, y + r], fill=P["leaf_lo"])
    for (x, y, r) in [(15, 9, 6), (10, 12, 4), (21, 12, 4), (17, 4, 3)]:
        d.ellipse([x - r, y - r, x + r, y + r], fill=P["leaf"])
    d.ellipse([13, 6, 17, 9], fill=P["leaf_hi"])
    return im


def shelf(d: ImageDraw.ImageDraw, _im):
    d.rectangle([0, 2, 2 * T - 1, T - 3], fill=(120, 84, 58))
    d.rectangle([2, 4, 2 * T - 3, T - 6], fill=(92, 62, 42))
    colors = [(214, 92, 84), (82, 140, 214), (240, 196, 92), (98, 178, 132), (160, 112, 200), (240, 140, 90), (90, 190, 200)]
    x = 4
    while x < 2 * T - 6:
        w = rnd.choice([3, 4, 5])
        h = rnd.choice([16, 18, 20])
        d.rectangle([x, T - 6 - h, x + w - 1, T - 7], fill=rnd.choice(colors))
        x += w + rnd.choice([0, 1])
    d.line([0, T - 3, 2 * T, T - 3], fill=(80, 54, 36))


def table(d: ImageDraw.ImageDraw, _im, w=4, h=2):
    d.rounded_rectangle([4, 6, w * T - 5, h * T - 3], 14, fill=shade(P["desk"], 0.78))
    d.rounded_rectangle([4, 4, w * T - 5, h * T - 6], 14, fill=(206, 168, 122))
    d.rounded_rectangle([10, 9, w * T - 11, h * T - 12], 10, outline=(222, 188, 146))
    # laptops and papers on the table
    for i, x in enumerate([22, w * T - 42]):
        d.rounded_rectangle([x, 14 + i * 22, x + 20, 27 + i * 22], 2, fill=(200, 204, 216))
        d.rectangle([x + 2, 16 + i * 22, x + 18, 24 + i * 22], fill=P["screen"])
    d.rectangle([w * T // 2 - 10, h * T // 2 - 6, w * T // 2 + 8, h * T // 2 + 6], fill=P["white"])


def whiteboard(d: ImageDraw.ImageDraw, _im):
    d.rectangle([2, 4, 2 * T - 3, T - 6], fill=P["metal_hi"])
    d.rectangle([4, 6, 2 * T - 5, T - 9], fill=P["white"])
    d.line([8, 10, 26, 10], fill=(82, 140, 214), width=2)
    d.line([8, 15, 40, 15], fill=(214, 92, 84), width=1)
    d.rectangle([44, 9, 54, 17], outline=(98, 178, 132))
    d.line([2, T - 5, 2 * T - 3, T - 5], fill=P["metal"])


def plan_board(d: ImageDraw.ImageDraw, _im):
    d.rectangle([2, 3, 2 * T - 3, T - 4], fill=(150, 108, 72))
    d.rectangle([4, 5, 2 * T - 5, T - 7], fill=(206, 164, 112))
    notes = [(252, 226, 120), (160, 214, 250), (250, 170, 180), (170, 230, 170)]
    for i in range(6):
        x, y = 7 + (i % 3) * 18, 7 + (i // 3) * 10
        d.rectangle([x, y, x + 12, y + 7], fill=notes[i % 4])
        d.point((x + 6, y), fill=(200, 60, 60))


def kiosk(d: ImageDraw.ImageDraw, _im):
    # the approvals desk: a counter with an inbox tray and a stamp
    d.rounded_rectangle([2, 6, 2 * T - 3, T - 2], 5, fill=(70, 72, 140))
    d.rounded_rectangle([2, 4, 2 * T - 3, T - 6], 5, fill=(99, 102, 241))
    d.line([8, 6, 2 * T - 9, 6], fill=(140, 144, 250))
    d.rectangle([8, 9, 26, 22], fill=(236, 238, 250))
    d.rectangle([10, 11, 24, 13], fill=P["white"])
    d.rectangle([10, 15, 24, 17], fill=P["white"])
    d.ellipse([38, 10, 50, 22], fill=(240, 196, 92))
    d.ellipse([41, 13, 47, 19], fill=(214, 160, 60))


def rack():
    im, d = new()
    d.rectangle([4, 1, 27, 30], fill=(42, 44, 60))
    for y in range(4, 28, 6):
        d.rectangle([7, y, 24, y + 4], fill=(62, 66, 88))
        d.point((10, y + 2), fill=(90, 220, 140))
        d.point((13, y + 2), fill=(90, 160, 250))
    return im


def coffee():
    im, d = new()
    d.rounded_rectangle([3, 8, 28, 28], 3, fill=(160, 120, 90))
    d.rectangle([7, 3, 24, 20], fill=(58, 62, 84))
    d.rectangle([10, 6, 21, 10], fill=(120, 200, 230))
    d.ellipse([12, 14, 19, 20], fill=P["white"])
    return im


def cooler():
    im, d = new()
    d.rounded_rectangle([9, 12, 23, 29], 3, fill=(220, 224, 234))
    d.ellipse([9, 2, 23, 15], fill=(150, 200, 240))
    d.ellipse([12, 4, 18, 9], fill=(200, 230, 250))
    return im


def couch(d: ImageDraw.ImageDraw, _im):
    c, hi = (110, 128, 196), (140, 158, 220)
    d.rounded_rectangle([2, 4, 3 * T - 3, T - 3], 6, fill=c)
    d.rounded_rectangle([2, 2, 3 * T - 3, 10], 4, fill=shade(c, 0.85))
    for i in range(3):
        d.rounded_rectangle([6 + i * 30, 11, 30 + i * 30, T - 7], 4, fill=hi)


def rug(d: ImageDraw.ImageDraw, _im):
    d.rounded_rectangle([2, 2, 3 * T - 3, 2 * T - 3], 10, fill=(240, 196, 140))
    d.rounded_rectangle([8, 8, 3 * T - 9, 2 * T - 9], 6, outline=(214, 150, 96), width=2)


def door_mat():
    im, d = new()
    d.rounded_rectangle([3, 8, 28, 24], 3, fill=(176, 160, 140))
    for x in range(6, 27, 3):
        d.line([x, 10, x, 22], fill=(150, 134, 116))
    return im


def cabinet():
    im, d = new()
    d.rectangle([3, 4, 28, 29], fill=(176, 182, 198))
    d.rectangle([3, 4, 28, 7], fill=(206, 210, 222))
    for y in (10, 19):
        d.rectangle([6, y, 25, y + 7], fill=(160, 166, 184))
        d.rectangle([13, y + 3, 18, y + 4], fill=(110, 116, 138))
    return im


def lamp():
    im, d = new()
    d.ellipse([9, 22, 23, 30], fill=(0, 0, 0, 40))
    d.rectangle([15, 10, 17, 27], fill=P["metal"])
    d.ellipse([8, 2, 24, 14], fill=(250, 226, 160))
    d.ellipse([11, 4, 21, 11], fill=(255, 244, 206))
    return im


def pod_rug(d: ImageDraw.ImageDraw, _im):
    d.rounded_rectangle([3, 3, 4 * T - 4, 3 * T - 4], 8, fill=(255, 255, 255, 70))
    d.rounded_rectangle([3, 3, 4 * T - 4, 3 * T - 4], 8, outline=(255, 255, 255, 140), width=2)


add_multi("desk", 2, 1, desk, collides=True)
add("cabinet", cabinet(), collides=True)
add("lamp", lamp(), collides=True)
add_multi("podrug", 4, 3, pod_rug)
add("chair", chair(True))
add("chair_down", chair(False))
add("plant", plant(), collides=True)
add_multi("shelf", 2, 1, shelf, collides=True)
add_multi("table", 4, 2, table, collides=True)
add_multi("whiteboard", 2, 1, whiteboard, collides=True)
add_multi("planboard", 2, 1, plan_board, collides=True)
add_multi("kiosk", 2, 1, kiosk, collides=True)
add("rack", rack(), collides=True)
add("coffee", coffee(), collides=True)
add("cooler", cooler(), collides=True)
add_multi("couch", 3, 1, couch, collides=True)
add_multi("rug", 3, 2, rug)
add("mat", door_mat())

# ------------------------------------------------------------------ write the tileset image
# each tile is extruded by 1 px (margin 1, spacing 2), so scaled rendering never bleeds the neighbour tile into seams
rows = (len(tiles) + COLS - 1) // COLS
M, SP = 1, 2
sheet = Image.new("RGBA", (M * 2 + COLS * T + (COLS - 1) * SP, M * 2 + rows * T + (rows - 1) * SP), (0, 0, 0, 0))
for i, im in enumerate(tiles):
    x, y = M + (i % COLS) * (T + SP), M + (i // COLS) * (T + SP)
    sheet.paste(im, (x, y))
    sheet.paste(im.crop((0, 0, T, 1)), (x, y - 1)); sheet.paste(im.crop((0, T - 1, T, T)), (x, y + T))
    sheet.paste(im.crop((0, 0, 1, T)), (x - 1, y)); sheet.paste(im.crop((T - 1, 0, T, T)), (x + T, y))
    for cx, cy, px, py in ((0, 0, -1, -1), (T - 1, 0, T, -1), (0, T - 1, -1, T), (T - 1, T - 1, T, T)):
        sheet.putpixel((x + px, y + py), im.getpixel((cx, cy)))
OUT.mkdir(parents=True, exist_ok=True)
sheet.save(OUT / "tiles.png")

# ------------------------------------------------------------------ the map
W, H = 48, 32
layers = {k: [[0] * W for _ in range(H)] for k in ("floor", "rugs", "shadow", "walls", "decor", "furniture")}
gid = lambda name: names[name] + 1  # noqa: E731
objects: dict[str, list[dict]] = {k: [] for k in ("zones", "seats", "spots", "interactive", "labels")}
oid = [1]


def obj(layer: str, name: str, x: float, y: float, w: float = 0, h: float = 0, point=False, **p):
    o = {"id": oid[0], "name": name, "type": layer[:-1], "x": x, "y": y, "width": w, "height": h, "rotation": 0, "visible": True,
         "properties": [{"name": k, "type": "int" if isinstance(v, int) else "string", "value": v} for k, v in p.items()]}
    if point:
        o["point"] = True
    oid[0] += 1
    objects[layer].append(o)


def fill(layer, x0, y0, x1, y1, name):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            layers[layer][y][x] = gid(name)


def put(layer, x, y, name):
    layers[layer][y][x] = gid(name)


def put_multi(layer, x, y, name, w, h):
    for dy in range(h):
        for dx in range(w):
            layers[layer][y + dy][x + dx] = gid(f"{name}_{dx}_{dy}")


# base floor: wood everywhere, a stone corridor across the middle
fill("floor", 0, 0, W - 1, H - 1, "wood")
for y in range(H):
    for x in range(W):
        if (x * 7 + y * 3) % 11 == 0:
            layers["floor"][y][x] = gid("wood2")
fill("floor", 1, 13, W - 2, 16, "stone")

ROOMS = [  # id, title, x0, y0, x1, y1 (inner floor), door x range on corridor side
    ("leadership", "Leadership", 1, 1, 11, 11),
    ("marketing", "Marketing", 13, 1, 23, 11),
    ("sales", "Sales", 25, 1, 35, 11),
    ("meeting", "Huddle room", 37, 1, 46, 11),
    ("support", "Support", 1, 18, 11, 30),
    ("engineering", "Engineering & Ops", 13, 18, 23, 30),
    ("finance", "Finance", 25, 18, 35, 30),
    ("studio", "Studio & lounge", 37, 18, 46, 30),
]
# outer walls
fill("floor", 0, 12, W - 1, 17, "stone")
fill("walls", 0, 0, W - 1, 0, "wall")
fill("walls", 0, H - 1, W - 1, H - 1, "wall")
fill("walls", 0, 0, 0, H - 1, "wall")
fill("walls", W - 1, 0, W - 1, H - 1, "wall")
for rid, title, x0, y0, x1, y1 in ROOMS:
    fill("floor", x0, y0, x1, y1, f"carpet_{rid}")
    top = y0 < 13
    wy = y1 + 1 if top else y0 - 1  # the wall facing the corridor
    door = list(range((x0 + x1) // 2 - 1, (x0 + x1) // 2 + 2))
    for x in range(x0 - 1, x1 + 2):
        if x not in door:
            put("walls", x, wy, "glass_h" if rid == "meeting" else "wall")
        else:
            put("decor", x, wy, "mat")
            layers["floor"][wy][x] = gid("stone")
    for x in (x0 - 1, x1 + 1):  # side walls
        for y in range(y0, y1 + 1):
            put("walls", x, y, "glass_v" if rid == "meeting" and x == x0 - 1 else "wall")
    for x in range(x0, x1 + 1):  # soft shadow under the wall above
        if layers["walls"][y0 - 1][x]:
            put("shadow", x, y0, "shadow")
    obj("zones", rid, x0 * T, y0 * T, (x1 - x0 + 1) * T, (y1 - y0 + 1) * T, title=title, door_x=door[1], door_y=wy)
    obj("labels", title, x0 * T + 10, y0 * T + 8, point=True, zone=rid)
for x in range(1, W - 1):
    if layers["walls"][12][x] and not layers["walls"][13][x]:
        put("shadow", x, 13, "shadow")

# desks: two pods of 2×2 desks per department room; the seat is the chair below each desk
DEPT_ROOMS = [r for r in ROOMS if r[0] not in ("meeting",)]
for rid, title, x0, y0, x1, y1 in DEPT_ROOMS:
    top = y0 < 13
    base_y = y0 + 2 if top else y0 + 3
    n = 0
    for row in range(1 if rid == "studio" else 2):
        dy = base_y + row * 4
        for col in range(2 if rid != "leadership" else 1):
            dx = x0 + 1 + col * 5 if rid != "leadership" else x0 + 1
            if dx - 1 >= x0:
                put_multi("rugs", dx - 1, dy - 1 if dy - 1 >= y0 else dy, "podrug", 4, 3)
            put_multi("furniture", dx, dy, "desk", 2, 1)
            put("decor", dx, dy + 1, "chair")
            obj("seats", f"{rid}-{n}", dx * T + T / 2, (dy + 1) * T + T / 2, point=True, dept=rid, monitor_x=int(dx * T + T / 2), monitor_y=int(dy * T + 10))
            n += 1
            put("decor", dx + 1, dy + 1, "chair")
            obj("seats", f"{rid}-{n}", (dx + 1) * T + T / 2, (dy + 1) * T + T / 2, point=True, dept=rid, monitor_x=int((dx + 1) * T + T / 2), monitor_y=int(dy * T + 10))
            n += 1
    # room dressing
    if top:
        put_multi("furniture", x1 - 1, y0, "shelf", 2, 1)
        put("furniture", x1, y1 - 1, "plant")
    else:
        put_multi("furniture", x1 - 1, y1, "shelf", 2, 1)
        put("furniture", x1, y0, "plant")
    put("furniture", x0, y1 if top else y1, "plant")

DRESS = {"marketing": [("whiteboard", 2, 13 + 6, 1)], "sales": [("whiteboard", 2, 25 + 6, 1)], "support": [("cabinet", 1, 6, 29)],
         "engineering": [("rack", 1, 22, 29), ("rack", 1, 21, 29)], "finance": [("cabinet", 1, 30, 29), ("cabinet", 1, 31, 29)]}
for rid, items in DRESS.items():
    for name, w, x, y in items:
        if w == 2:
            put_multi("furniture", x, y, name, 2, 1)
        else:
            put("furniture", x, y, name)
for (x, y) in [(12 - 1, 6), (13, 6), (35, 6), (25, 6), (1, 24), (23, 24), (13, 24), (35, 24), (25, 24)]:
    if not layers["furniture"][y][x] and not layers["walls"][y][x]:
        put("furniture", x, y, "lamp")

# lounge spots (rugs in front of the sofas): where idle helpers take a short break
for (lx, ly) in [(6, 8), (7, 9), (8, 8), (39, 26), (40, 27), (41, 26)]:
    obj("spots", f"lounge-{lx}-{ly}", lx * T + T / 2, ly * T + T / 2, point=True, kind="lounge")

# leadership: a corner sofa and a whiteboard
put_multi("rugs", 6, 8, "rug", 3, 2)
put_multi("furniture", 6, 10, "couch", 3, 1)
put_multi("furniture", 8, 1, "whiteboard", 2, 1)

# huddle room: a big table with chairs around it; meeting seats are spots
put_multi("furniture", 40, 5, "table", 4, 2)
seat_xy = [(40, 4), (41, 4), (42, 4), (43, 4), (40, 7), (41, 7), (42, 7), (43, 7), (39, 5), (44, 6)]
for i, (sx, sy) in enumerate(seat_xy):
    put("decor", sx, sy, "chair_down" if sy == 4 else "chair")
    obj("spots", f"meeting-{i}", sx * T + T / 2, sy * T + T / 2, point=True, kind="meeting")
put_multi("furniture", 41, 1, "whiteboard", 2, 1)
put("furniture", 46, 1, "plant")
put("furniture", 37, 1, "plant")

# corridor: approvals desk, plan board, docs library, coffee point
put_multi("furniture", 22, 13, "kiosk", 2, 1)
obj("interactive", "Approvals desk", 22 * T, 13 * T, 2 * T, T, action="/", label="Approvals desk", hint="What waits on you")
obj("spots", "approvals", 23 * T, 14 * T + T / 2, point=True, kind="approvals")
put_multi("furniture", 6, 13, "planboard", 2, 1)
obj("interactive", "Plan board", 6 * T, 13 * T, 2 * T, T, action="/plan/", label="Plan board", hint="Goals and the work for them")
put_multi("furniture", 33, 13, "shelf", 2, 1)
obj("interactive", "Docs library", 33 * T, 13 * T, 2 * T, T, action="/docs/", label="Docs library", hint="Shared notes and memory")
put("furniture", 45, 13, "coffee")
put("furniture", 46, 13, "cooler")
obj("spots", "coffee", 45 * T + T / 2, 14 * T + T / 2, point=True, kind="coffee")
for x in (2, 13, 29, 40):
    put("furniture", x, 16, "plant")

# studio: open desks are the seats above; a server corner = the Claude Code pool
for i, y in enumerate((26, 27, 28)):
    put("furniture", 46, y, "rack")
obj("interactive", "Server corner", 46 * T, 26 * T, T, 3 * T, action="/harness/", label="Server corner", hint="The Claude Code pool")
put_multi("rugs", 39, 26, "rug", 3, 2)
put_multi("furniture", 39, 29, "couch", 3, 1)
put_multi("furniture", 10, 13, "whiteboard", 2, 1)
obj("interactive", "Team board", 10 * T, 13 * T, 2 * T, T, action="/staff/", label="Team board", hint="Hire and manage helpers")
put("furniture", 1, 13, "plant")


def tile_layer(i, name, data, visible=True):
    return {"id": i, "name": name, "type": "tilelayer", "x": 0, "y": 0, "width": W, "height": H, "opacity": 1, "visible": visible,
            "data": [v for row in data for v in row]}


def obj_layer(i, name):
    return {"id": i, "name": name, "type": "objectgroup", "draworder": "topdown", "opacity": 1, "visible": True, "x": 0, "y": 0, "objects": objects[name]}


tileset = {
    "firstgid": 1, "name": "saga-office", "image": "tiles.png", "imagewidth": sheet.width, "imageheight": sheet.height,
    "tilewidth": T, "tileheight": T, "tilecount": len(tiles), "columns": COLS, "margin": M, "spacing": SP,
    "tiles": [{"id": i, "properties": [{"name": k, "type": "bool", "value": v} for k, v in p.items()]} for i, p in sorted(props.items())],
}
tmap = {
    "type": "map", "version": "1.10", "tiledversion": "1.10.2", "orientation": "orthogonal", "renderorder": "right-down",
    "width": W, "height": H, "tilewidth": T, "tileheight": T, "infinite": False, "nextlayerid": 12, "nextobjectid": oid[0],
    "properties": [{"name": "title", "type": "string", "value": "Saga HQ"}],
    "layers": [tile_layer(1, "floor", layers["floor"]), tile_layer(11, "rugs", layers["rugs"]), tile_layer(2, "shadow", layers["shadow"]),
               tile_layer(3, "walls", layers["walls"]), tile_layer(4, "decor", layers["decor"]), tile_layer(5, "furniture", layers["furniture"]),
               obj_layer(6, "zones"), obj_layer(7, "seats"), obj_layer(8, "spots"), obj_layer(9, "interactive"), obj_layer(10, "labels")],
    "tilesets": [tileset],
}
(OUT / "hq.json").write_text(json.dumps(tmap, separators=(",", ":")))
print(f"{len(tiles)} tiles, {len(objects['seats'])} seats, {len(objects['interactive'])} interactive objects -> {OUT}")
