#!/usr/bin/env python3
"""Generate the PWA / home-screen icons for the SKRiMPAD web build.

No image libraries are needed on the build machine — this writes PNGs
directly (zlib + the four mandatory chunks), so the icons stay
reproducible from source instead of living in the repo as opaque blobs.

The mark is a 4x4 pad grid on the app's own background, using the pad
colours from the studio palette in index.html.

    python3 scripts/make-icons.py            # writes into web/icons/
"""

import os
import struct
import zlib

# Pad colours lifted from :root in the app's stylesheet, laid out as the
# grid reads on screen (kick / snare / hat / clap across the top row).
PADS = [
    ["#FF3B5C", "#FF8F00", "#FFD600", "#00E676"],
    ["#00BCD4", "#448AFF", "#AA00FF", "#F50057"],
    ["#76FF03", "#FF6D00", "#7C4DFF", "#00E5FF"],
    ["#FF1744", "#64DD17", "#AA00FF", "#FFAB00"],
]
BG = "#0A0B0F"      # --bg
SURF = "#12141A"    # --surf, the rounded plate behind the pads


def hex_rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def write_png(path, width, height, rows):
    """rows: list of `height` lists of `width` (r, g, b) tuples."""
    raw = b"".join(
        b"\x00" + bytes(channel for pixel in row for channel in pixel)
        for row in rows
    )

    def chunk(tag, data):
        body = tag + data
        return (
            struct.pack(">I", len(data))
            + body
            + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as handle:
        handle.write(png)


def rounded_hit(x, y, left, top, right, bottom, radius):
    """True when (x, y) falls inside the rounded rect, corners included."""
    if not (left <= x < right and top <= y < bottom):
        return False
    # Only the four corner boxes need the distance check.
    cx = left + radius if x < left + radius else (
        right - 1 - radius if x > right - 1 - radius else x
    )
    cy = top + radius if y < top + radius else (
        bottom - 1 - radius if y > bottom - 1 - radius else y
    )
    if cx == x and cy == y:
        return True
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


def render(size, maskable=False):
    """Draw the pad grid at `size`x`size`.

    maskable leaves a wider margin so Android's adaptive-icon mask can
    crop to a circle without clipping the pads.
    """
    bg = hex_rgb(BG)
    surf = hex_rgb(SURF)
    pads = [[hex_rgb(c) for c in row] for row in PADS]

    margin = int(size * (0.22 if maskable else 0.11))
    plate = size - margin * 2
    plate_radius = int(plate * 0.16)
    gap = max(1, int(plate * 0.045))
    cell = (plate - gap * 5) // 4
    pad_radius = max(1, int(cell * 0.22))

    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            colour = bg
            if rounded_hit(x, y, margin, margin, margin + plate,
                           margin + plate, plate_radius):
                colour = surf
                col = (x - margin - gap) // (cell + gap)
                rowi = (y - margin - gap) // (cell + gap)
                if 0 <= col < 4 and 0 <= rowi < 4:
                    px = margin + gap + col * (cell + gap)
                    py = margin + gap + rowi * (cell + gap)
                    if rounded_hit(x, y, px, py, px + cell, py + cell,
                                   pad_radius):
                        colour = pads[rowi][col]
            row.append(colour)
        rows.append(row)
    return rows


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(here, "web", "icons")
    os.makedirs(out, exist_ok=True)

    targets = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        # iOS composites its own rounded mask and never honours
        # transparency, so the touch icon is drawn edge-to-edge.
        ("apple-touch-icon-180.png", 180, False),
        ("icon-maskable-512.png", 512, True),
    ]
    for name, size, maskable in targets:
        path = os.path.join(out, name)
        write_png(path, size, size, render(size, maskable))
        print("wrote %s (%dx%d)" % (path, size, size))


if __name__ == "__main__":
    main()
