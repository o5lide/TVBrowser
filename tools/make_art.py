#!/usr/bin/env python3
"""Gera o ícone e a arte do TV Browser para a biblioteca do Steam (precisa do Pillow).

    python tools/make_art.py

Mesmo tema da tela inicial (extension/home/home.css): orbe verde, teia, recortes inclinados.
Saída em assets/:
    icon.ico, icon.png        ícone do atalho e do Steam
    steam/capsule.png         600x900   capa em pé da biblioteca
    steam/wide.png            920x430   capa deitada (jogos recentes)
    steam/hero.png            1920x620  fundo da página do jogo
    steam/logo.png            logo transparente que o Steam põe em cima do fundo
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ASSETS = Path(__file__).resolve().parent.parent / "assets"
HOT, LINE, TEXT, INK = (216, 245, 42), (141, 255, 74), (223, 255, 200), (6, 26, 6)
BACKDROP = [(0, (23, 92, 20)), (0.26, (11, 48, 11)), (0.58, (4, 20, 4)), (1, (1, 6, 1))]
CORE = [(0, (251, 255, 176)), (0.18, (228, 245, 49)), (0.42, (155, 226, 31)), (0.68, (47, 154, 20)), (1, (11, 74, 12))]
FONTS = ["C:/Windows/Fonts/impact.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf"]
SS = 2  # tudo é desenhado no dobro do tamanho e reduzido, pra borda sair lisa


def font(size):
    for path in FONTS:
        if Path(path).is_file():
            return ImageFont.truetype(path, round(size))
    return ImageFont.load_default(round(size))


def mix(stops, t):
    t = min(max(t, stops[0][0]), stops[-1][0])
    for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
        if t <= p1:
            k = (t - p0) / (p1 - p0)
            return tuple(round(a + (b - a) * k) for a, b in zip(c0, c1))
    return stops[-1][1]


def radial(width, height, center, radius, stops):
    """Degradê radial, calculado numa grade pequena e ampliado (rápido e sem degraus)."""
    step = max(1, min(width, height) // 160)
    small = Image.new("RGB", (max(2, width // step), max(2, height // step)))
    pixels = small.load()
    for y in range(small.height):
        for x in range(small.width):
            distance = math.hypot((x + 0.5) * step - center[0], (y + 0.5) * step - center[1])
            pixels[x, y] = mix(stops, distance / radius)
    return small.resize((width, height), Image.BICUBIC)


def layer(size):
    return Image.new("RGBA", size, (0, 0, 0, 0))


def italic(text, size, fill, slant=0.2):
    """Texto inclinado: a Impact não tem itálico, então a imagem do texto é cisalhada."""
    face = font(size)
    left, top, right, bottom = face.getbbox(text)
    width, height = right - left, bottom - top
    image = layer((width + round(height * slant) + 4, height + 4))
    ImageDraw.Draw(image).text((2 - left, 2 - top), text, font=face, fill=fill)
    return image.transform(image.size, Image.AFFINE, (1, slant, -slant * height, 0, 1, 0), resample=Image.BICUBIC)


def backdrop(width, height, cx, cy, radius, slab_side):
    """Fundo: clarão verde saindo do orbe, teia de círculos e raios, e a faixa escura pontilhada."""
    far = max(math.hypot(cx - x, cy - y) for x in (0, width) for y in (0, height))
    image = radial(width, height, (cx, cy), far, BACKDROP).convert("RGBA")

    web = layer(image.size)
    draw = ImageDraw.Draw(web)
    rings = [radius * k for k in (1.06, 1.68, 2.38, 3.18, 4.06, 5.03, 6.09, 7.24, 8.47)]
    for r in rings:
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=LINE + (56,), width=SS)
    for angle in range(0, 360, 10):
        dx, dy = math.cos(math.radians(angle)), math.sin(math.radians(angle))
        draw.line([cx + dx * rings[0], cy + dy * rings[0], cx + dx * rings[-1], cy + dy * rings[-1]], fill=LINE + (56,), width=SS)
    image.alpha_composite(web)

    if slab_side:
        edge = [(0.61, 0), (1, 0), (1, 1), (0.43, 1)] if slab_side == "right" else [(0, 0), (0.39, 0), (0.57, 1), (0, 1)]
        mask = Image.new("L", image.size, 0)
        ImageDraw.Draw(mask).polygon([(x * width, y * height) for x, y in edge], fill=255)
        slab = Image.new("RGBA", image.size, (1, 6, 1, 184))
        dots = ImageDraw.Draw(slab)
        gap = round(height * 0.017) or 1
        for y in range(0, height, gap):
            for x in range(0, width, gap):
                dots.ellipse([x, y, x + SS, y + SS], fill=(22, 44, 14, 220))
        image.paste(Image.alpha_composite(image, slab), (0, 0), mask)
    return image


def orb(radius, mark="TV"):
    """O orbe da tela inicial: clarão, gomos girando, núcleo, anéis e a marca no meio."""
    size = round(radius * 5.2)
    c = size / 2
    image = layer((size, size))

    halo = radial(size, size, (c, c), radius * 2.47, [(0, (107, 107, 107)), (0.42, (36, 36, 36)), (0.68, (0, 0, 0))])
    glow = Image.new("RGBA", (size, size), (150, 250, 60, 255))
    glow.putalpha(halo.convert("L"))
    image.alpha_composite(glow)

    for angle in (20, 80, 140):
        lobe = layer((size, size))
        box = [c - radius * 1.38, c - radius * 0.62, c + radius * 1.38, c + radius * 0.62]
        ImageDraw.Draw(lobe).ellipse(box, fill=(150, 255, 70, 30), outline=(170, 255, 90, 120), width=round(radius * 0.022))
        image.alpha_composite(lobe.rotate(angle, resample=Image.BICUBIC))

    shine = layer((size, size))
    ImageDraw.Draw(shine).ellipse([c - radius * 1.05, c - radius * 1.05, c + radius * 1.05, c + radius * 1.05], fill=(170, 255, 60, 150))
    image.alpha_composite(shine.filter(ImageFilter.GaussianBlur(radius * 0.2)))

    box = round(radius * 2)
    core = radial(box, box, (box * 0.42, box * 0.38), box * 0.85, CORE).convert("RGBA")
    mask = Image.new("L", (box, box), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, box - 1, box - 1], fill=255)
    image.paste(core, (round(c - radius), round(c - radius)), mask)

    draw = ImageDraw.Draw(image)
    for r, width, alpha, start, end in ((1.59, 0.018, 140, -130, 40), (1.76, 0.01, 100, 50, 215)):
        draw.arc([c - radius * r, c - radius * r, c + radius * r, c + radius * r], start, end, fill=(170, 255, 90, alpha), width=max(1, round(radius * width)))

    if mark:
        letters = italic(mark, radius * 1.05, INK + (255,))
        shadow = italic(mark, radius * 1.05, (255, 255, 255, 105))
        stamp = layer((letters.width + round(radius * 0.1), letters.height + round(radius * 0.1)))
        stamp.alpha_composite(shadow, (round(radius * 0.04), round(radius * 0.04)))
        stamp.alpha_composite(letters)
        stamp = stamp.rotate(8, resample=Image.BICUBIC, expand=True)
        image.alpha_composite(stamp, (round(c - stamp.width / 2), round(c - stamp.height / 2)))
    return image


def title(height):
    """"TV BROWSER" no recorte preto, com o "TV" num bloco verde-limão (igual ao cabeçalho da tela inicial)."""
    size = height * 0.5
    tv, rest = italic("TV", size, INK + (255,)), italic("BROWSER", size, TEXT + (255,))
    pad = round(size * 0.34)
    width = pad * 5 + tv.width + rest.width
    image = layer((width, height))
    draw = ImageDraw.Draw(image)
    draw.polygon([(0, height * 0.14), (width * 0.97, 0), (width, height * 0.82), (width * 0.03, height)], fill=(1, 5, 1, 255))
    top, bottom = (height - tv.height) / 2 - pad * 0.45, (height + tv.height) / 2 + pad * 0.45
    lean = (bottom - top) * 0.18
    draw.polygon([(pad + lean, top), (pad * 2.6 + tv.width + lean, top), (pad * 2.6 + tv.width, bottom), (pad, bottom)], fill=HOT + (255,))
    image.alpha_composite(tv, (round(pad * 1.7), round((height - tv.height) / 2)))
    image.alpha_composite(rest, (round(pad * 3.5 + tv.width), round((height - rest.height) / 2)))
    return image.rotate(4, resample=Image.BICUBIC, expand=True)


def band(width, height):
    """Faixa inclinada com o nome repetido, como as que passam na tela inicial."""
    image = Image.new("RGBA", (width, height), (2, 10, 2, 220))
    draw = ImageDraw.Draw(image)
    line = max(1, round(height * 0.05))
    draw.rectangle([0, 0, width, line], fill=LINE + (115,))
    draw.rectangle([0, height - line, width, height], fill=LINE + (115,))
    x, index = 0, 0
    while x < width:
        bright = index % 3 == 2
        word = italic("TV BROWSER", height * 0.5, (INK if bright else LINE) + (255,))
        chip = word.width + round(height * 0.9)
        if bright:
            draw.rectangle([x, line, x + chip, height - line], fill=HOT + (255,))
        image.alpha_composite(word, (x + round(height * 0.45), round((height - word.height) / 2)))
        x += chip
        index += 1
    return image


def compose(width, height, orb_at, orb_radius, slab_side="right", bands=(), title_at=None, title_height=0, mark="TV"):
    W, H = width * SS, height * SS
    cx, cy, radius = orb_at[0] * SS, orb_at[1] * SS, orb_radius * SS
    image = backdrop(W, H, cx, cy, radius, slab_side)
    for y in bands:
        strip = band(round(W * 1.3), round(H * 0.055) if H > W else round(H * 0.09)).rotate(4, resample=Image.BICUBIC, expand=True)
        image.alpha_composite(strip, (round(-W * 0.15), round(y * H - strip.height / 2)))
    sphere = orb(radius, mark)
    image.alpha_composite(sphere, (round(cx - sphere.width / 2), round(cy - sphere.height / 2)))
    if title_at:
        lockup = title(title_height * SS)
        image.alpha_composite(lockup, (round(title_at[0] * SS - lockup.width / 2), round(title_at[1] * SS - lockup.height / 2)))
    return image.resize((width, height), Image.LANCZOS)


def icon(size=512):
    art = compose(size, size, (size / 2, size / 2), size * 0.3, slab_side=None)
    mask = Image.new("L", (size * SS, size * SS), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size * SS - 1, size * SS - 1], radius=size * SS * 0.22, fill=255)
    art.putalpha(mask.resize((size, size), Image.LANCZOS))
    return art


def logo():
    lockup = title(260 * SS)
    return lockup.resize((lockup.width // SS, lockup.height // SS), Image.LANCZOS)


def main():
    (ASSETS / "steam").mkdir(parents=True, exist_ok=True)
    mark = icon()
    mark.save(ASSETS / "icon.png")
    mark.save(ASSETS / "icon.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    compose(600, 900, (300, 350), 150, bands=(0.1, 0.66), title_at=(300, 770), title_height=120).save(ASSETS / "steam" / "capsule.png")
    compose(920, 430, (235, 215), 105, bands=(0.9,), title_at=(640, 205), title_height=118).save(ASSETS / "steam" / "wide.png")
    compose(1920, 620, (1470, 310), 150, slab_side="left", bands=(0.1, 0.92)).save(ASSETS / "steam" / "hero.png")
    logo().save(ASSETS / "steam" / "logo.png")
    print("arte gerada em", ASSETS)


if __name__ == "__main__":
    main()
