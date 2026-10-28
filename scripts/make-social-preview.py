"""Draws .github/social-preview.png (upload it in GitHub repo settings) from the icon and screenshots."""
import pathlib
from PIL import Image, ImageDraw, ImageFont, ImageFilter
root = str(pathlib.Path(__file__).resolve().parent.parent)
out = f'{root}/.github/social-preview.png'
fonts = root + '/node_modules/@expo-google-fonts'
W, H = 1280, 640
img = Image.new('RGB', (W, H), '#FAF7F2')
d = ImageDraw.Draw(img)

def font(path, size):
    return ImageFont.truetype(f'{fonts}/{path}', size)

# Left: identity.
icon = Image.open(root + '/assets/icon.png').convert('RGB').resize((112, 112), Image.LANCZOS)
mask = Image.new('L', (112, 112), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, 111, 111), radius=26, fill=255)
img.paste(icon, (80, 120), mask)
d.rounded_rectangle((80, 120, 191, 231), radius=26, outline='#E6DFD3', width=2)
d.text((76, 250), 'Feedline', font=font('newsreader/600SemiBold/Newsreader_600SemiBold.ttf', 104), fill='#1D1B18')
body = font('inter/400Regular/Inter_400Regular.ttf', 30)
d.text((80, 392), 'A calm, offline-first', font=body, fill='#5C564E')
d.text((80, 432), 'RSS reader for Android', font=body, fill='#5C564E')
d.text((80, 498), 'No accounts. No servers. No tracking.', font=font('inter/500Medium/Inter_500Medium.ttf', 22), fill='#B4532A')
d.text((80, 566), 'github.com/deepakness/feedline', font=font('inter/400Regular/Inter_400Regular.ttf', 20), fill='#9A9288')

# Right: two phones, bleeding off the bottom edge.
def phone(shot, x, y, w):
    s = Image.open(shot).convert('RGB')
    h = round(w * s.height / s.width)
    s = s.resize((w, h), Image.LANCZOS)
    bezel, r = 9, 34
    pw, ph = w + 2 * bezel, h + 2 * bezel
    shadow = Image.new('L', (W, H), 0)
    ImageDraw.Draw(shadow).rounded_rectangle((x + 6, y + 14, x + pw + 6, y + ph + 14), radius=r, fill=70)
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    img.paste(Image.new('RGB', (W, H), '#3a332c'), (0, 0), shadow)
    dd = ImageDraw.Draw(img)
    dd.rounded_rectangle((x, y, x + pw, y + ph), radius=r, fill='#1D1B18')
    m = Image.new('L', (w, h), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, w - 1, h - 1), radius=r - bezel, fill=255)
    img.paste(s, (x + bezel, y + bezel), m)

phone(f'{root}/.github/screenshots/reader.png', 1000, 118, 236)
phone(f'{root}/.github/screenshots/timeline.png', 735, 62, 252)
img.save(out, optimize=True)
