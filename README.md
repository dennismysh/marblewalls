# Marble Walls

Generative-art wallpaper maker. Pick a seed, pick a size, download a PNG. All rendering happens on your GPU — no server, no tracking.

## How it works

The original Python generator (domain-warped fractal Brownian motion) has been ported to a WebGL fragment shader (`app.js`). The seed deterministically produces a set of offsets fed into three layers of warped noise, then mapped to RGB via sine palettes and a vignette.

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

## Why not Railway?

Railway is great when you need a server. This generator is pure math — running
it client-side on the GPU is faster (no network round-trip), free to host, and
has no cold starts. If you later want server features (galleries, accounts,
NSFW moderation, etc.) Railway becomes the right call.
