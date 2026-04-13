import sys
import random
from math import pi
import numpy as np
from PIL import Image

SIZE = 800
seed = int(sys.argv[1]) if len(sys.argv) > 1 else random.randint(0, 999999)
rng = np.random.RandomState(seed)
offsets = rng.uniform(0, 12, 14)

def fbm(x, y, octaves=5):
    val = np.zeros_like(x)
    amp = 0.5
    freq = 1.0
    for _ in range(octaves):
        val += amp * np.sin(x * freq + np.cos(y * freq * 0.7 + 1.3) * 1.7)
        val += amp * np.cos(y * freq + np.sin(x * freq * 0.9 + 2.1) * 1.3)
        freq *= 2.17
        amp *= 0.48
    return val

xs = np.linspace(-2, 2, SIZE)
ys = np.linspace(-2, 2, SIZE)
px, py = np.meshgrid(xs, ys)

o = offsets
wx1 = fbm(px + o[0], py + o[1], 5)
wy1 = fbm(px + o[2], py + o[3], 5)
wx2 = fbm(px + 1.7 * wx1 + o[4], py + 1.7 * wy1 + o[5], 5)
wy2 = fbm(px + 1.7 * wx1 + o[6], py + 1.7 * wy1 + o[7], 5)
wx3 = fbm(px + 1.5 * wx2 + o[8], py + 1.5 * wy2 + o[9], 4)
wy3 = fbm(px + 1.5 * wx2 + o[10], py + 1.5 * wy2 + o[11], 4)

f = fbm(px + 2.0 * wx3, py + 2.0 * wy3, 5) * 0.15 + 0.5
g = fbm(px + 2.0 * wy3 + 4.0, py + 2.0 * wx3 + 1.0, 4) * 0.15 + 0.5
wm = np.sqrt(wx3 ** 2 + wy3 ** 2) * 0.2

r = np.clip(255 * (0.3 + 0.7 * np.sin(f * pi * 2 + wm * 2) ** 2), 0, 255)
gc = np.clip(255 * (0.2 + 0.6 * np.sin(g * pi * 3 + f * 2) ** 2 + 0.2 * np.sin(wm * 4) ** 2), 0, 255)
b = np.clip(255 * (0.15 + 0.85 * np.sin(f * pi * 1.5 + g * pi + 1) ** 2), 0, 255)

vx = np.linspace(-1, 1, SIZE)
vy = np.linspace(-1, 1, SIZE)
vxg, vyg = np.meshgrid(vx, vy)
vig = np.clip(1.0 - (vxg ** 2 + vyg ** 2) * 0.15, 0.3, 1.0)

rgb = np.stack([r * vig, gc * vig, b * vig], axis=-1).clip(0, 255).astype(np.uint8)
Image.fromarray(rgb).save(f'warp_{seed}.png')
print(f'warp_{seed}.png')
