"""生成 Android 图标与启动屏：深紫底 + 象牙轨道 + 珊瑚方块（天枢轨道标）。

用法：python tools/make_icons.py   （需要 Pillow）
覆盖 android/app/src/main/res 下的 mipmap-* 与 splash.png，保留原尺寸与文件结构。
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "android" / "app" / "src" / "main" / "res"

INK = (26, 16, 48, 255)        # #1A1030 深紫
IVORY = (244, 240, 230, 255)   # #F4F0E6 象牙白
CORAL = (255, 110, 91, 255)    # #FF6E5B 珊瑚

DENSITY = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}

# 32 单位坐标系里的比例，和 Web 端 logo 一致
CIRCLE_R = 12.5 / 32
STROKE = 2.0 / 32
SQUARE = 8.0 / 32


def draw_mark(size: int, scale: float, ink_alpha: int = 255) -> Image.Image:
    """透明底上画轨道标；scale 是内容占画布的比例（0.6~0.8）。"""
    ss = 4  # 超采样
    px = size * ss
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    unit = px * scale

    cx = cy = px / 2
    r = CIRCLE_R * unit
    w = max(2, int(round(STROKE * unit)))

    # 两段圆弧，对角留缺口
    box = [cx - r, cy - r, cx + r, cy + r]
    d.arc(box, start=196, end=324, fill=(*IVORY[:3], ink_alpha), width=w)
    d.arc(box, start=16, end=144, fill=(*IVORY[:3], ink_alpha), width=w)

    # 中心 45° 珊瑚方块
    half = SQUARE * unit / 2 * math.sqrt(2)
    pts = [(cx, cy - half), (cx + half, cy), (cx, cy + half), (cx - half, cy)]
    d.polygon(pts, fill=CORAL)

    return img.resize((size, size), Image.LANCZOS)


def rounded_mask(size: int, radius_ratio: float = 0.22) -> Image.Image:
    mask = Image.new("L", (size * 4, size * 4), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size * 4 - 1, size * 4 - 1],
                        radius=size * 4 * radius_ratio, fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def circle_mask(size: int) -> Image.Image:
    mask = Image.new("L", (size * 4, size * 4), 0)
    d = ImageDraw.Draw(mask)
    d.ellipse([0, 0, size * 4 - 1, size * 4 - 1], fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def legacy_icon(size: int, round_icon: bool = False) -> Image.Image:
    base = Image.new("RGBA", (size, size), INK)
    mark = draw_mark(size, scale=0.78)
    base.alpha_composite(mark)
    base.putalpha(circle_mask(size) if round_icon else rounded_mask(size))
    return base


def foreground(size: int) -> Image.Image:
    # adaptive icon 前景：内容留在中心 66% 安全区
    return draw_mark(size, scale=0.66)


def splash(size: tuple[int, int]) -> Image.Image:
    """象牙白底 + 深紫轨道标：启动屏用深色线条，避免在白底上看不见。"""
    img = Image.new("RGBA", size, IVORY)
    side = int(min(size) * 0.30)
    mark = draw_mark(side, scale=0.95)
    px = mark.load()
    # 把象牙白线条换成深紫（只改轨道像素，珊瑚方块保持原色）
    for y in range(side):
        for x in range(side):
            r, g, b, a = px[x, y]
            if a > 0 and not (r > 200 and g < 140 and b < 130):
                px[x, y] = (INK[0], INK[1], INK[2], a)
    img.alpha_composite(mark, ((size[0] - side) // 2, (size[1] - side) // 2))
    return img


def main() -> None:
    for name, factor in DENSITY.items():
        folder = RES / f"mipmap-{name}"
        folder.mkdir(parents=True, exist_ok=True)
        legacy = int(48 * factor)
        legacy_icon(legacy).save(folder / "ic_launcher.png")
        legacy_icon(legacy, round_icon=True).save(folder / "ic_launcher_round.png")
        foreground(int(108 * factor)).save(folder / "ic_launcher_foreground.png")
        print(f"mipmap-{name}: {legacy}px / fg {int(108 * factor)}px")

    # splash 保持原尺寸
    for path in sorted(RES.rglob("splash.png")):
        with Image.open(path) as im:
            size = im.size
        splash(size).convert("RGB").save(path)
        print(f"splash {path.parent.name}: {size[0]}x{size[1]}")


if __name__ == "__main__":
    main()
