#!/usr/bin/env python3
# 生成 PWA 图标（与 icon.svg 同一套视觉：蜜柚橙底 + 柚子切面）
from PIL import Image, ImageDraw
import math, os

OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 2048          # 4x 超采样
K = S / 512.0


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(size, c1, c2, diagonal=True):
    img = Image.new('RGB', (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = ((x + y) / (2 * size - 2)) if diagonal else (x / (size - 1))
            px[x, y] = lerp(c1, c2, t)
    return img


def rounded_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def main():
    base = gradient(S, (255, 209, 102), (242, 117, 31))
    canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    canvas.paste(base, (0, 0), rounded_mask(S, int(116 * K)))

    d = ImageDraw.Draw(canvas, 'RGBA')
    cx, cy = 256 * K, 272 * K

    # 白色外圈
    d.ellipse([cx - 140 * K, cy - 140 * K, cx + 140 * K, cy + 140 * K], fill=(255, 253, 246, 236))

    # 果肉：径向近似用两层叠加
    d.ellipse([cx - 124 * K, cy - 124 * K, cx + 124 * K, cy + 124 * K], fill=(255, 236, 186, 255))
    d.ellipse([cx - 100 * K, cy - 100 * K, cx + 100 * K, cy + 100 * K], fill=(255, 247, 219, 255))

    # 果瓣分割线（8 瓣）
    lw = int(8 * K)
    for i in range(8):
        a = math.radians(i * 45)
        r1, r2 = 22 * K, 104 * K
        d.line([cx + math.cos(a) * r1, cy + math.sin(a) * r1,
                cx + math.cos(a) * r2, cy + math.sin(a) * r2],
               fill=(240, 169, 60, 224), width=lw)

    # 中心
    d.ellipse([cx - 16 * K, cy - 16 * K, cx + 16 * K, cy + 16 * K], fill=(255, 253, 246, 242))

    # 叶子
    leaf = Image.new('RGBA', (int(168 * K), int(86 * K)), (0, 0, 0, 0))
    ld = ImageDraw.Draw(leaf)
    w, h = leaf.size
    ld.ellipse([0, h * 0.14, w, h * 0.86], fill=(95, 191, 138, 255))
    ld.ellipse([w * 0.08, h * 0.28, w * 0.92, h * 0.72], fill=(126, 208, 162, 255))
    leaf = leaf.rotate(30, expand=True, resample=Image.BICUBIC)
    canvas.alpha_composite(leaf, (int(268 * K), int(58 * K)))

    # 果柄
    d.line([cx, 136 * K, cx - 6 * K, 92 * K], fill=(76, 175, 125, 255), width=int(14 * K))

    for size, name in ((512, 'icon-512.png'), (192, 'icon-192.png'), (180, 'apple-touch-icon.png')):
        canvas.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name))
        print('wrote', name)


if __name__ == '__main__':
    main()
