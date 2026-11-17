"""生成 Android 图标与启动屏。

品牌标唯一来源：桌面端 `assets/app.ico`（深紫圆角方底 + 双色弧 + 珊瑚菱形）。
手机端不再自绘，保证两端图标完全一致；只有源文件缺失时才回退到旧的自绘逻辑。

用法：python tools/make_icons.py   （需要 Pillow）
覆盖 android/app/src/main/res 下的 mipmap-* 与 splash.png，保留原尺寸与文件结构。
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "android" / "app" / "src" / "main" / "res"
SOURCE = ROOT.parent / "assets" / "app.ico"   # 与桌面端共用

INK = (26, 16, 48, 255)        # #1A1030 深紫
IVORY = (244, 240, 230, 255)   # #F4F0E6 象牙白
CORAL = (255, 110, 91, 255)    # #FF6E5B 珊瑚

DENSITY = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}

# 自绘兜底用的比例（32 单位坐标系）
CIRCLE_R = 12.5 / 32
STROKE = 2.0 / 32
SQUARE = 8.0 / 32


def draw_mark(size: int, scale: float, ink_alpha: int = 255) -> Image.Image:
    """兜底：透明底上画轨道标。正常路径会直接用桌面 app.ico。"""
    ss = 4
    px = size * ss
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    unit = px * scale
    cx = cy = px / 2
    r = CIRCLE_R * unit
    w = max(2, int(round(STROKE * unit)))
    box = [cx - r, cy - r, cx + r, cy + r]
    d.arc(box, start=196, end=324, fill=(*IVORY[:3], ink_alpha), width=w)
    d.arc(box, start=16, end=144, fill=(*IVORY[:3], ink_alpha), width=w)
    half = SQUARE * unit / 2 * math.sqrt(2)
    pts = [(cx, cy - half), (cx + half, cy), (cx, cy + half), (cx - half, cy)]
    d.polygon(pts, fill=CORAL)
    return img.resize((size, size), Image.LANCZOS)


def source_image(size: int) -> Image.Image:
    """桌面端品牌图，统一缩放；没有源文件时才自绘。"""
    if SOURCE.exists():
        with Image.open(SOURCE) as im:
            return im.convert("RGBA").resize((size, size), Image.LANCZOS)
    return draw_mark(size, scale=0.78)


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
    img = source_image(size)
    if round_icon:
        img = img.copy()
        img.putalpha(circle_mask(size))
    return img


def foreground(size: int) -> Image.Image:
    # adaptive icon 前景：品牌图缩到中心 66% 安全区，四周透明
    inner = int(size * 0.66)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.alpha_composite(source_image(inner), ((size - inner) // 2, (size - inner) // 2))
    return out


def splash(size: tuple[int, int]) -> Image.Image:
    """象牙白底 + 品牌标居中，与桌面端同一张图。"""
    img = Image.new("RGBA", size, IVORY)
    side = int(min(size) * 0.30)
    img.alpha_composite(source_image(side), ((size[0] - side) // 2, (size[1] - side) // 2))
    return img


def main() -> None:
    print("品牌图来源:", SOURCE if SOURCE.exists() else "（缺失，回退自绘）")
    for name, factor in DENSITY.items():
        folder = RES / f"mipmap-{name}"
        folder.mkdir(parents=True, exist_ok=True)
        legacy = int(48 * factor)
        legacy_icon(legacy).save(folder / "ic_launcher.png")
        legacy_icon(legacy, round_icon=True).save(folder / "ic_launcher_round.png")
        foreground(int(108 * factor)).save(folder / "ic_launcher_foreground.png")
        print(f"mipmap-{name}: {legacy}px / fg {int(108 * factor)}px")

    for path in sorted(RES.rglob("splash.png")):
        with Image.open(path) as im:
            size = im.size
        splash(size).convert("RGB").save(path)
        print(f"splash {path.parent.name}: {size[0]}x{size[1]}")


if __name__ == "__main__":
    main()
