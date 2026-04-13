# Marble Walls

Generative-art wallpaper maker. Pick a seed, pick a size, download a PNG. All rendering happens on your GPU — no server, no tracking.

## Credits

This project is based on the **"generative marble art using triple-iterated
domain warping"** algorithm by [**vijaypemmaraju**](https://gist.github.com/vijaypemmaraju),
published as a gist here:

> https://gist.github.com/vijaypemmaraju/2ba8a0da338431db542221b1c5798ae9

The original Python script (preserved in `wallpaper.py` for reference) uses
fractional Brownian motion (FBM) with triple-layered domain warping to produce
organic, marble-like patterns. All of the mathematical heavy lifting —
the FBM loops, the warp chain, the sinusoidal color mapping, and the vignette
— comes from that gist. Marble Walls simply ports the algorithm to a WebGL
fragment shader and wraps it in a browser UI so anyone can generate
wallpapers at arbitrary resolutions without installing Python.

## How it works

The Python generator (domain-warped fractal Brownian motion) has been ported
to a WebGL fragment shader (`app.js`). The seed deterministically produces a
set of offsets fed into three layers of warped noise, then mapped to RGB via
sine palettes and a vignette.

- `index.html` — markup
- `style.css` — responsive, mobile-first styling
- `app.js` — WebGL setup, shader, UI wiring, PNG export
- `wallpaper.py` — the original reference implementation (kept for parity checks)

## Run locally

It is plain static HTML. Any static server works:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy (GitHub Pages)

This repo includes a workflow at `.github/workflows/pages.yml` that deploys the
root of `main` to GitHub Pages on every push.

1. In repo **Settings → Pages**, set **Source** to **GitHub Actions**.
2. Merge this branch to `main`. The workflow will publish the site at
   `https://<user>.github.io/marblewalls/`.

## URL parameters

Every setting is reflected in the URL so you can share an exact wallpaper:

- `?seed=42` — RNG seed (0–999999)
- `?size=3840x2160` — output resolution
- `?scale=1.25` — pattern zoom (0.5–2.5)

## License

Marble Walls is released under the MIT License — see `LICENSE`. The original
algorithm is credited to **vijaypemmaraju** via the gist linked above; please
retain that attribution in any derivative work.
