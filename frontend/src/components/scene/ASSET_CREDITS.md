# NASA visual assets

These textures color real-time 3D spheres. They are aesthetic visual references, not inputs to illumination calculations or a claim of a computed flight trajectory.

## Moon

- Source page: https://svs.gsfc.nasa.gov/4720/
- File: https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg
- Local file: `nasa-lroc-color.webp`
- Credit: NASA's Scientific Visualization Studio / Ernie Wright; LROC science team.
- The CGI Moon Kit color product is optimized for aesthetics. Polar texture coverage uses additional albedo information as described on the source page; scientific terrain comes separately from the LOLA DEM endpoint.

## Earth

- Source page: https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/
- File: https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/january/world.topo.bathy.200401.3x5400x2700.jpg
- Local file: `nasa-blue-marble.webp`
- Credit: NASA Earth Observatory, Blue Marble: Next Generation.
- January 2004 composite with topographic/bathymetric shading. This is a static visual texture, not current Earth weather.

The downloaded JPEGs were converted to RGB, resized to 2048×1024 with Lanczos resampling, and encoded to WebP at quality 88. Original downloads are preserved outside the tracked source in `artifacts/nasa-texture-originals/`; the two optimized WebP files are included in the application. No generative imagery was used for these textures.

Rocket, launch tower, lander, exhaust and flight path are procedural conceptual 3D geometry. Lunar landing ground uses `/api/sites/{id}/terrain` NASA LOLA heights when available, and otherwise explicitly labels its procedural terrain as conceptual. Rendering scale, lighting, camera motion and flight timings are cinematic.

## SHA-256 provenance

| Asset | Original JPEG SHA-256 | Application WebP SHA-256 |
| --- | --- | --- |
| Moon | `f7130a1822681fa7512d7dcfd40db8c10b9ba4f06777910348698260ed7a2170` | `0b177ff8363c256fc5a872330aa9d8e40f0d0e08048d62c5f6041d51f3e680c0` |
| Earth | `1684c4f8f51970dcb4a7451302bf3be17bed657aed9fece6f80d7b191e8afa3d` | `baf746cd630496d1ad17a1775c3c050f09984f6c09079eabaff23145a1b0a9f6` |

The application Moon texture is 381,990 bytes and Earth texture is 315,714 bytes. Sources were downloaded on 2026-11-14.
