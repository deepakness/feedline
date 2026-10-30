"""Draws .github/social-preview.png (upload it in GitHub repo settings) from the icon and screenshots."""
import pathlib
from PIL import Image, ImageDraw, ImageFont, ImageFilter
root = str(pathlib.Path(__file__).resolve().parent.parent)
F = root + '/node_modules/@expo-google-fonts'
W, H = 1280, 640
PAPER, INK, INK2, INK3, HAIR, ACC, BLUSH = '#FAF7F2', '#1D1B18', '#5C564E', '#9A9288', '#E6DFD3', '#B4532A', '#F3E3D9'
shots = {n: Image.open(f'{root}/.github/screenshots/{n}.png').convert('RGB') for n in ['timeline', 'reader']}
iconsrc = Image.open(f'{root}/assets/icon.png').convert('RGB')

def font(path, size): return ImageFont.truetype(f'{F}/{path}', size)
SERIF = 'newsreader/600SemiBold/Newsreader_600SemiBold.ttf'
REG = 'inter/400Regular/Inter_400Regular.ttf'
MED = 'inter/500Medium/Inter_500Medium.ttf'

def icon(img, x, y, n, border=HAIR):
    ic = iconsrc.resize((n, n), Image.LANCZOS)
    m = Image.new('L', (n, n), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, n - 1, n - 1), radius=int(n * .23), fill=255)
    img.paste(ic, (x, y), m)
    if border: ImageDraw.Draw(img).rounded_rectangle((x, y, x + n - 1, y + n - 1), radius=int(n * .23), outline=border, width=2)

def phone_img(name, w):
    """A modern phone drawn at 3x and scaled down: metal rim, thin even bezel, hole-punch, side buttons."""
    k = 3
    sw = w * k
    s = shots[name]
    sh = round(sw * s.height / s.width)
    s = s.resize((sw, sh), Image.LANCZOS)
    bezel = round(sw * 0.028)
    rim = max(3, round(sw * 0.009))
    bw, bh = sw + 2 * (bezel + rim), sh + 2 * (bezel + rim)
    R = round(bw * 0.12)
    btn = round(sw * 0.012)
    ph = Image.new('RGBA', (bw + 2 * btn, bh), (0, 0, 0, 0))
    d = ImageDraw.Draw(ph)
    ox = btn
    # Side buttons (power, volume) on the right edge.
    for top, length in [(0.20, 0.07), (0.30, 0.13)]:
        y0 = round(bh * top)
        d.rounded_rectangle((ox + bw - btn, y0, ox + bw + btn, y0 + round(bh * length)), radius=btn, fill='#3d3d42')
    # Metal rim: light outer edge, darker band, then the black glass.
    d.rounded_rectangle((ox, 0, ox + bw - 1, bh - 1), radius=R, fill='#6b6b72')
    d.rounded_rectangle((ox + 1 * k, 1 * k, ox + bw - 1 - 1 * k, bh - 1 - 1 * k), radius=R - k, fill='#2a2a2e')
    d.rounded_rectangle((ox + rim, rim, ox + bw - 1 - rim, bh - 1 - rim), radius=R - rim, fill='#08080a')
    # Screen with corners concentric to the body.
    m = Image.new('L', (sw, sh), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, sw - 1, sh - 1), radius=R - rim - bezel, fill=255)
    ph.paste(s, (ox + rim + bezel, rim + bezel), m)
    # Hole-punch camera centred in the status bar.
    cx = ox + bw // 2
    cy = rim + bezel + round(sh * 0.022)
    cr = round(sw * 0.017)
    d.ellipse((cx - cr, cy - cr, cx + cr, cy + cr), fill='#050507')
    d.ellipse((cx - cr // 2.6, cy - cr // 2.6, cx + cr // 2.6, cy + cr // 2.6), fill='#1b2230')
    # Faint glass sheen across the top-left.
    sheen = Image.new('L', ph.size, 0)
    ImageDraw.Draw(sheen).polygon([(ox, 0), (ox + bw * 0.55, 0), (ox, bh * 0.45)], fill=14)
    sheen = Image.composite(sheen, Image.new('L', ph.size, 0), ph.getchannel('A'))
    ph = Image.composite(Image.new('RGBA', ph.size, (255, 255, 255, 255)), ph, sheen)
    return ph.resize((ph.width // k, ph.height // k), Image.LANCZOS)

def place(img, ph, x, y, angle=0, shadow=70):
    if angle: ph = ph.rotate(angle, resample=Image.BICUBIC, expand=True)
    a = ph.getchannel('A')
    if shadow:
        for dy, blur, alpha in [(28, 34, shadow), (8, 10, shadow * 0.8)]:
            sh = Image.new('L', img.size, 0)
            sh.paste(a.point(lambda v: int(alpha) if v > 8 else 0), (x, y + dy))
            sh = sh.filter(ImageFilter.GaussianBlur(blur))
            img.paste(Image.new('RGB', img.size, '#1a1410'), (0, 0), sh)
    img.paste(ph, (x, y), ph)

def text(d, xy, s, f, fill, anchor='la'): d.text(xy, s, font=f, fill=fill, anchor=anchor)

# Terracotta background, tilted phones, everything inside generous margins.
PADX, PADY = 150, 72

def v4():
    img = Image.new('RGB', (W, H), ACC); d = ImageDraw.Draw(img)
    # Text block, vertically centred.
    top = (H - 420) // 2
    icon(img, PADX, top, 96, border='#F7E6DB')
    text(d, (PADX - 4, top + 112), 'Feedline', font(SERIF, 96), PAPER)
    text(d, (PADX, top + 246), 'A calm, offline-first', font(REG, 28), '#F7E6DB')
    text(d, (PADX, top + 284), 'RSS reader for Android', font(REG, 28), '#F7E6DB')
    text(d, (PADX, top + 344), 'No accounts. No servers. No tracking.', font(MED, 21), INK)
    text(d, (PADX, top + 396), 'github.com/deepakness/feedline', font(REG, 19), '#F1CFBC')
    # Phones: rotated first, then sized so both fit inside the padding.
    front = phone_img('reader', 200).rotate(-7, resample=Image.BICUBIC, expand=True)
    back = phone_img('timeline', 210).rotate(6, resample=Image.BICUBIC, expand=True)
    fx = W - PADX - front.width
    fy = H - PADY - front.height + 12
    bx = fx - back.width + 96
    by = PADY - 12
    place(img, back, bx, by, shadow=90)
    place(img, front, fx, fy, shadow=90)
    return img

if __name__ == '__main__':
    v4().save(f'{root}/.github/social-preview.png', optimize=True)
