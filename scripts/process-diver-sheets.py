#!/usr/bin/env python3
"""Pack per-facing blob-barb composites into game-ready transparent PNGs.

Each source is a 5x6 grid on a medium-gray field (not a green screen):
idle, run, attack, die, roll. An edge flood turns that field into alpha.
White gloss highlights stay. Assembled sheets use the barbarian row order
E, SE, S, SW, W, NW, N, NE.
"""

from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw

FRAME = 96
ROWS = 8
FIGURE_HEIGHT = 56
FOOT_Y = 88
ANIM_ROWS = 5
ANIM_COLS = 6

SOURCE = Path(
    r"C:\Users\tomal\.cursor\projects\c-Users-tomal-Desktop-RARPG\assets"
)
OUT = Path(__file__).resolve().parents[1] / "public" / "assets" / "characters" / "diver"
PREVIEW = SOURCE / "sheet-rows"

DIRECTIONS = ("E", "SE", "S", "SW", "W", "NW", "N", "NE")
# dest, source row, columns, plant heads to that facing's idle line
ANIMS = (
    ("Idle.png", 0, 4, True),
    ("Run.png", 1, 6, True),
    ("Attack.png", 2, 6, True),
    ("Die.png", 3, 6, False),
    ("Rolling.png", 4, 6, False),
)


def is_field(r: int, g: int, b: int) -> bool:
    """Medium-gray backdrop only. Do not treat white gloss dots as field."""
    mx = r if r > g else g
    if b > mx:
        mx = b
    mn = r if r < g else g
    if b < mn:
        mn = b
    return 155 < mx < 215 and mn > 145 and (mx - mn) < 32


def white_to_alpha(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    pix = im.load()
    seen = bytearray(w * h)
    q: deque[tuple[int, int]] = deque()

    def enqueue(x: int, y: int) -> None:
        i = y * w + x
        if seen[i]:
            return
        r, g, b, a = pix[x, y]
        if a == 0 or not is_field(r, g, b):
            return
        seen[i] = 1
        q.append((x, y))

    for x in range(w):
        enqueue(x, 0)
        enqueue(x, h - 1)
    for y in range(h):
        enqueue(0, y)
        enqueue(w - 1, y)

    while q:
        x, y = q.popleft()
        pix[x, y] = (0, 0, 0, 0)
        if x:
            enqueue(x - 1, y)
        if x + 1 < w:
            enqueue(x + 1, y)
        if y:
            enqueue(x, y - 1)
        if y + 1 < h:
            enqueue(x, y + 1)

    for y in range(h):
        for x in range(w):
            r, g, b, a = pix[x, y]
            if a and is_field(r, g, b):
                pix[x, y] = (0, 0, 0, 0)
    return im


def occupancy(im: Image.Image, axis: str) -> list[float]:
    pix = im.load()
    w, h = im.size
    if axis == "row":
        return [
            sum(1 for x in range(0, w, 2) if pix[x, y][3] > 30) / (w / 2)
            for y in range(h)
        ]
    return [
        sum(1 for y in range(0, h, 2) if pix[x, y][3] > 30) / (h / 2)
        for x in range(w)
    ]


def bands(occ: list[float], thresh: float, min_span: int) -> list[tuple[int, int]]:
    found: list[tuple[int, int]] = []
    inside = False
    start = 0
    for i, v in enumerate(occ):
        if v > thresh and not inside:
            inside = True
            start = i
        elif v <= thresh and inside:
            inside = False
            if i - start >= min_span:
                found.append((start, i))
    if inside and len(occ) - start >= min_span:
        found.append((start, len(occ)))
    return found


def even_bands(length: int, count: int, inset: int) -> list[tuple[int, int]]:
    step = length / count
    return [
        (int(i * step) + inset, int((i + 1) * step) - inset) for i in range(count)
    ]


def pick_columns(col_bands: list[tuple[int, int]], needed: int) -> list[tuple[int, int]]:
    """Keep a stable left-to-right set. Extra AI frames are dropped from the end."""
    if len(col_bands) >= needed:
        return col_bands[:needed]
    return col_bands


def slice_strip(path: Path, cols: int) -> list[Image.Image]:
    keyed = white_to_alpha(Image.open(path))
    w, h = keyed.size
    col_bands = bands(occupancy(keyed, "col"), 0.02, 18)
    if len(col_bands) < cols:
        col_bands = even_bands(w, cols, 8)
    else:
        col_bands = pick_columns(col_bands, cols)
    frames: list[Image.Image] = []
    for x0, x1 in col_bands:
        pad_x = max(4, (x1 - x0) // 8)
        frames.append(
            keyed.crop((max(0, x0 - pad_x), 0, min(w, x1 + pad_x), h))
        )
    return frames


def slice_facing(path: Path) -> list[list[Image.Image]]:
    keyed = white_to_alpha(Image.open(path))
    w, h = keyed.size
    row_bands = bands(occupancy(keyed, "row"), 0.012, 36)
    if len(row_bands) != ANIM_ROWS:
        row_bands = even_bands(h, ANIM_ROWS, 8)
    grid: list[list[Image.Image]] = []
    for y0, y1 in row_bands:
        pad_y = max(4, (y1 - y0) // 12)
        strip = keyed.crop((0, max(0, y0 - pad_y), w, min(h, y1 + pad_y)))
        col_bands = bands(occupancy(strip, "col"), 0.02, 18)
        if len(col_bands) < ANIM_COLS:
            col_bands = even_bands(w, ANIM_COLS, 8)
        else:
            col_bands = pick_columns(col_bands, ANIM_COLS)
        row: list[Image.Image] = []
        for x0, x1 in col_bands:
            pad_x = max(4, (x1 - x0) // 8)
            row.append(
                keyed.crop(
                    (
                        max(0, x0 - pad_x),
                        max(0, y0 - pad_y),
                        min(w, x1 + pad_x),
                        min(h, y1 + pad_y),
                    )
                )
            )
        grid.append(row)
    return grid


def solid_rows(im: Image.Image, min_count: int = 4) -> list[int]:
    pix = im.load()
    w, h = im.size
    found: list[int] = []
    for y in range(h):
        n = 0
        for x in range(0, w, 1):
            r, g, b, a = pix[x, y]
            if a > 160 and (r + g + b) > 70:
                n += 1
                if n >= min_count:
                    found.append(y)
                    break
    return found


def lowest_contact(im: Image.Image) -> int | None:
    pix = im.load()
    w, h = im.size
    for y in range(h - 1, -1, -1):
        n = sum(1 for x in range(w) if is_cyan(*pix[x, y]))
        if n >= 3:
            return y
    rows = solid_rows(im)
    return rows[-1] if rows else None


def head_top(im: Image.Image) -> int | None:
    rows = solid_rows(im)
    return rows[0] if rows else None


def is_cyan(r: int, g: int, b: int, a: int) -> bool:
    return a > 160 and b > r + 8 and b > 70


def head_diameter(im: Image.Image) -> int:
    """Largest cyan blob, which is the head sphere on this character."""
    pix = im.load()
    w, h = im.size
    seen = bytearray(w * h)
    best = 0
    for y in range(h):
        for x in range(w):
            i = y * w + x
            if seen[i] or not is_cyan(*pix[x, y]):
                continue
            q: deque[tuple[int, int]] = deque([(x, y)])
            seen[i] = 1
            min_x = max_x = x
            min_y = max_y = y
            area = 0
            while q:
                cx, cy = q.popleft()
                area += 1
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if nx < 0 or ny < 0 or nx >= w or ny >= h:
                        continue
                    j = ny * w + nx
                    if seen[j] or not is_cyan(*pix[nx, ny]):
                        continue
                    seen[j] = 1
                    q.append((nx, ny))
                    if nx < min_x:
                        min_x = nx
                    if nx > max_x:
                        max_x = nx
                    if ny < min_y:
                        min_y = ny
                    if ny > max_y:
                        max_y = ny
            if area >= 40:
                best = max(best, max(max_x - min_x + 1, max_y - min_y + 1))
    return best


def median_int(values: list[int], fallback: int) -> int:
    if not values:
        return fallback
    ordered = sorted(values)
    return ordered[len(ordered) // 2]


def shift_frame(im: Image.Image, dy: int) -> Image.Image:
    if dy == 0:
        return im
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    out.paste(im, (0, dy), im)
    return out


def plant_heads(frames: list[Image.Image], target_top: int) -> list[Image.Image]:
    """Shift a pose down so the head cannot rise above the idle line."""
    planted: list[Image.Image] = []
    for frame in frames:
        top = head_top(frame)
        if top is None or top >= target_top:
            planted.append(frame)
            continue
        planted.append(shift_frame(frame, target_top - top))
    return planted


def stamp_shadow(im: Image.Image) -> Image.Image:
    shadow = Image.new("RGBA", im.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(shadow)
    cx = im.size[0] // 2
    draw.ellipse((cx - 12, FOOT_Y - 4, cx + 12, FOOT_Y + 3), fill=(18, 14, 10, 80))
    out = Image.alpha_composite(shadow, im)
    return out


def fit_square(im: Image.Image, size: int, scale: float) -> Image.Image:
    bbox = im.split()[-1].getbbox()
    if bbox is None:
        return Image.new("RGBA", (size, size), (0, 0, 0, 0))
    crop = im.crop(bbox)
    contact = lowest_contact(crop)
    if contact is None:
        contact = crop.size[1] - 1
    cw, ch = crop.size
    nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
    scaled = crop.resize((nw, nh), Image.Resampling.LANCZOS)
    foot = max(0, min(nh - 1, int(round(contact * (nh / ch)))))
    x = (size - nw) // 2
    y = FOOT_Y - foot
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    src_x = 0
    src_y = 0
    dest_w, dest_h = nw, nh
    if x < 0:
        src_x = -x
        dest_w += x
        x = 0
    if y < 0:
        src_y = -y
        dest_h += y
        y = 0
    if x + dest_w > size:
        dest_w = size - x
    if y + dest_h > size:
        dest_h = size - y
    if dest_w > 0 and dest_h > 0:
        piece = scaled.crop((src_x, src_y, src_x + dest_w, src_y + dest_h))
        out.paste(piece, (x, y), piece)
    return out


def typical_height(cells: list[Image.Image]) -> int:
    heights: list[int] = []
    for cell in cells:
        bbox = cell.split()[-1].getbbox()
        if bbox is not None and bbox[3] - bbox[1] > 20:
            heights.append(bbox[3] - bbox[1])
    heights.sort()
    return heights[len(heights) // 2] if heights else FIGURE_HEIGHT


def assemble(rows: list[list[Image.Image]]) -> Image.Image:
    cols = len(rows[0])
    sheet = Image.new("RGBA", (FRAME * cols, FRAME * ROWS), (0, 0, 0, 0))
    for r, frames in enumerate(rows):
        for c, frame in enumerate(frames):
            sheet.paste(frame, (c * FRAME, r * FRAME), frame)
    return sheet


def preview(rows: list[list[Image.Image]], name: str) -> None:
    PREVIEW.mkdir(exist_ok=True)
    strip = Image.new("RGBA", (FRAME * 2 * 8, FRAME * 2), (90, 100, 70, 255))
    for i, frames in enumerate(rows[:8]):
        big = frames[0].resize((FRAME * 2, FRAME * 2), Image.Resampling.NEAREST)
        strip.paste(big, (i * FRAME * 2, 0), big)
    strip.save(PREVIEW / f"{name}-8dir.png")


def leftover_field(im: Image.Image) -> int:
    pix = im.load()
    w, h = im.size
    n = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = pix[x, y]
            if a and is_field(r, g, b):
                n += 1
    return n


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    facings: list[list[list[Image.Image]]] = []
    for name in DIRECTIONS:
        grid = slice_facing(SOURCE / f"blob-v4-{name}.png")
        if len(grid) != ANIM_ROWS or any(len(row) != ANIM_COLS for row in grid):
            raise SystemExit(
                f"{name}: expected {ANIM_ROWS}x{ANIM_COLS}, got "
                f"{len(grid)}x{len(grid[0]) if grid else 0}"
            )
        override = SOURCE / f"blob-v4-{name}-run.png"
        if override.exists():
            grid[1] = slice_strip(override, ANIM_COLS)
            if len(grid[1]) != ANIM_COLS:
                raise SystemExit(f"{name} run override: expected {ANIM_COLS}")
            print("overrode run", name)
        facings.append(grid)
        print("sliced", name, "x".join(str(len(row)) for row in grid))

    south_idle = facings[2][0][:4]
    south_source_head = median_int(
        [head_diameter(cell) for cell in south_idle],
        80,
    )
    gold_head = max(
        1,
        round(south_source_head * FIGURE_HEIGHT / typical_height(south_idle)),
    )
    print("gold packed head", gold_head, "from source", south_source_head)

    facing_idle_heads = [
        median_int([head_diameter(cell) for cell in grid[0][:4]], gold_head)
        for grid in facings
    ]
    print("idle heads", facing_idle_heads)

    def cell_scale(cell: Image.Image, facing_head: int) -> float:
        found = head_diameter(cell)
        expected = gold_head / max(facing_head, 1)
        if found < 24:
            return expected
        raw = gold_head / found
        # Override strips are painted larger than the 5x6 sheets; do not
        # clamp them back toward the smaller idle source scale.
        if found > facing_head * 1.15:
            return raw
        low, high = expected * 0.92, expected * 1.08
        return min(high, max(low, raw))

    idle_tops: list[int] = []
    for grid, facing_head in zip(facings, facing_idle_heads, strict=True):
        packed = [
            fit_square(cell, FRAME, cell_scale(cell, facing_head))
            for cell in grid[0][:4]
        ]
        tops = [top for frame in packed if (top := head_top(frame)) is not None]
        idle_tops.append(median_int(tops, 34))
    print("idle head tops", idle_tops)

    for dest_name, anim_row, cols, plant in ANIMS:
        packed_rows: list[list[Image.Image]] = []
        for grid, facing_head, idle_top in zip(
            facings,
            facing_idle_heads,
            idle_tops,
            strict=True,
        ):
            frames = [
                fit_square(cell, FRAME, cell_scale(cell, facing_head))
                for cell in grid[anim_row][:cols]
            ]
            if plant:
                frames = plant_heads(frames, idle_top)
            frames = [stamp_shadow(frame) for frame in frames]
            packed_rows.append(frames)
        sheet = assemble(packed_rows)
        sheet.save(OUT / dest_name)
        preview(packed_rows, dest_name.replace(".png", "").lower())
        print(
            "wrote",
            dest_name,
            sheet.size,
            sheet.mode,
            "leftover-field",
            leftover_field(sheet),
        )


if __name__ == "__main__":
    main()
