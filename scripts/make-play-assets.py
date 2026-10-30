"""Draws .github/play/: the 512px icon and 1024x500 feature graphic for the Play listing."""
import importlib.util
import pathlib
from PIL import Image, ImageDraw

here = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('social', here / 'make-social-preview.py')
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
out = here.parent / '.github' / 'play'
out.mkdir(parents=True, exist_ok=True)

s.iconsrc.resize((512, 512), Image.LANCZOS).save(out / 'icon-512.png', optimize=True)

W, H = 1024, 500
PAD = 72
img = Image.new('RGB', (W, H), s.ACC)
d = ImageDraw.Draw(img)
top = (H - 300) // 2
s.icon(img, PAD, top, 72, border=None)
s.text(d, (PAD - 3, top + 80), 'Feedline', s.font(s.SERIF, 80), s.PAPER)
s.text(d, (PAD, top + 196), 'A calm, offline-first RSS reader', s.font(s.REG, 24), '#F7E6DB')
s.text(d, (PAD, top + 244), 'Open source. No accounts. No tracking.', s.font(s.MED, 19), s.INK)
# Phones run off the bottom edge, so the top of each screen stays readable.
front = s.phone_img('reader', 170).rotate(-6, resample=Image.BICUBIC, expand=True)
back = s.phone_img('timeline', 178).rotate(5, resample=Image.BICUBIC, expand=True)
fx = W - 44 - front.width
s.place(img, back, fx - back.width + 92, 30, shadow=90)
s.place(img, front, fx, 96, shadow=90)
img.save(out / 'feature-graphic.png', optimize=True)
