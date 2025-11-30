# SVG3-NEXUS

A compact, single-file WebGL + ECS demo and loader for SVG3 scenes. This repository includes a small runtime (`svg3-nexus-system.js`) that implements an ECS, an SVG3 parser, basic geometry helpers, and a WebGL renderer; along with a demo runner (`app.js`) and a few example scene files.

This README describes the main files and how to run the demo locally.

## Files

- `svg3-nexus-system.js`: The core runtime. Exports `SVG3NEXUS` with `load()` and `create()` helpers. Contains:
	- ECS (`World`, `Entity`, `Component` classes)
	- Built-in components (`Transform`, `Mesh`, `Material`, etc.)
	- `GeometryLibrary` with primitive creation and `addGeometry(...)` for raw geometry (now supports optional UVs)
	- WebGL renderer with simple shaders (supports textured materials and a procedural grass tint)
	- `SVG3ParserNEXUS` which parses `.svg3` XML to create entities and materials

- `app.js`: A small demo runner that loads a scene using `SVG3NEXUS.load(canvas, 'scene.svg3')`, creates a ground plane, generates projected shadows, and sets up orbit / first-person controls (WASD + pointer-lock). It also attempts to load a sky image (`sunflowers_puresky_2k.png`) or tonemap an HDR to create an in-scene sky sphere.

- `README.md`: This file.

- `.gitignore`: Files and directories excluded from git (node_modules, editor caches, generated images, etc.).

- `tools/hdr_to_png.py`: (optional) Python utility to convert Radiance RGBE `.hdr` images to a PNG via a simple tonemapper. Useful when browsers cannot directly use the HDR file.

- Example scene files: `tree.svg3`, `human.svg3`, `cyber-samurai.svg3`, `willow.svg3`, `scene.svg3` — XML scene files parsed by the runtime (location: repo root).

## Running the demo locally

This project is intended to run from a local HTTP server (browsers restrict many image / WebGL operations when using `file://`). From the repository root run a small server, for example using Python 3:

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000/` in your browser and load `index.html` (or open a small HTML page that creates a canvas and imports `app.js`). The demo uses `canvas` with id `canvas` by default.

Notes:
- If you run into sky images not appearing, it may be due to CORS when loading images from other origins or trying to run from `file://`. Use the local HTTP server above.
- If you have an HDR sky and your browser can't display it as-is, use `tools/hdr_to_png.py` to convert the HDR to a PNG and place it as `sunflowers_puresky_2k.png` (or update `app.js` to point to your PNG).

## How the renderer treats textures & shadows

- Textured materials: set `material.textureImage` to an `Image` element (the demo does this for the sky) and the renderer will upload it to a WebGL texture. Non-power-of-two images are supported (no mipmaps).
- Shadows: The demo generates projected shadows by projecting mesh vertices onto the ground plane along the light direction and creating shadow meshes (marked `isShadow`) that are drawn in a dedicated pass. Shadow meshes are excluded from the normal opaque/transparent passes to avoid double-darkening.

## Contributing / Next steps

- Add a proper skybox/cubemap or prefiltered environment for better lighting and reflections.
- Merge shadow geometry when desired to reduce draw calls.
- Add a small UI to toggle rendering features (shadows, grass tint, sky source).

If you want, I can add a concise `index.html` demo page and a small `package.json` with a `start` script to run a local dev server.

---

Generated on: November 30, 2025