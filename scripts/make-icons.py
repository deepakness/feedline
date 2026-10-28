"""Draws the Feedline "unread list" icon (option 6) into every asset the app needs."""
import pathlib
from PIL import Image, ImageDraw

root = str(pathlib.Path(__file__).resolve().parent.parent)
PAPER, INK, ACCENT, DOT, LINE = '#FAF7F2', '#1D1B18', '#B4532A', '#D9D1C4', '#9A9288'
SS = 4  # supersampling for smooth edges

# Geometry on a 100x100 canvas (the visible icon area); x shifted to centre the mark.
DX = 0.75
ROWS = [  # dot y, line width, dot colour, line colour, mono alpha
    (38, 28, ACCENT, INK, 255),
    (50, 24, DOT, LINE, 110),
    (62, 18, DOT, LINE, 110),
]

def draw_mark(size, canvas_px, offset, bg=None, mono=False):
    """canvas_px: pixels that the 100-unit canvas spans; offset: where it starts."""
    big = size * SS
    img = Image.new('RGBA', (big, big), bg or (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = canvas_px * SS / 100
    o = offset * SS
    P = lambda v: o + v * u
    for y, w, dot, line, alpha in ROWS:
        dc = (255, 255, 255, alpha) if mono else dot
        lc = (255, 255, 255, alpha) if mono else line
        cx, r = 33 + DX, 4.5
        d.ellipse((P(cx - r), P(y - r), P(cx + r), P(y + r)), fill=dc)
        x0 = 42 + DX
        d.rounded_rectangle((P(x0), P(y - 3), P(x0 + w), P(y + 3)), radius=3 * u, fill=lc)
    return img.resize((size, size), Image.LANCZOS)

# Full icon: canvas = whole image.
draw_mark(1024, 1024, 0, bg=PAPER).convert('RGB').save(f'{root}/assets/icon.png')
# Adaptive layers: 108dp layer, the visible 72dp centre is the 100-unit canvas.
vis = 1024 * 72 / 108
off = (1024 - vis) / 2
draw_mark(1024, vis, off).save(f'{root}/assets/android-icon-foreground.png')
draw_mark(1024, vis, off, mono=True).save(f'{root}/assets/android-icon-monochrome.png')
# Splash: same proportions as the old splash mark on its 512 canvas.
draw_mark(512, 512, 0).save(f'{root}/assets/splash-icon.png')
# README icon: rounded corners baked in (GitHub strips CSS), with a hairline so it reads on white.
n = 256
readme = Image.open(f'{root}/assets/icon.png').convert('RGBA').resize((n * SS, n * SS), Image.LANCZOS)
mask = Image.new('L', readme.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, n * SS - 1, n * SS - 1), radius=56 * SS, fill=255)
readme.putalpha(mask)
ImageDraw.Draw(readme).rounded_rectangle((0, 0, n * SS - 1, n * SS - 1), radius=56 * SS, outline='#E6DFD3', width=3 * SS)
readme.resize((n, n), Image.LANCZOS).save(f'{root}/.github/readme-icon.png')
