from __future__ import annotations

import importlib
import json
from pathlib import Path
from typing import Optional
from .models import SiteMetadata, TerrainMesh3D

_HERE = Path(__file__).resolve().parent
_LOLA_PATCHES_PATH = _HERE / "lola_3d_patches.json"

VERIFIED_SITES: dict[str, dict] = {
    "site01": {
        "site_id": "site01",
        "name": "Connecting ridge",
        "region": "Lunar south pole",
        "lat_deg": -89.463521,
        "lon_east_deg": 222.128578,
        "elevation_m": 1934.32,
        "reference_frame": "MOON_ME (DE421/DE441)",
        "provenance_source": "NASA GSFC PGDA · LRO-LOLA 5 m/pix (Product 78, Barker et al. 2021 / Mazarico et al. 2011)",
        "provenance_url": "https://pgda.gsfc.nasa.gov/products/78",
    },
    "site04": {
        "site_id": "site04",
        "name": "Shackleton rim",
        "region": "Lunar south pole",
        "lat_deg": -89.771917,
        "lon_east_deg": 203.293771,
        "elevation_m": 1731.37,
        "reference_frame": "MOON_ME (DE421/DE441)",
        "provenance_source": "NASA GSFC PGDA · LRO-LOLA 5 m/pix (Product 78, Barker et al. 2021 / Mazarico et al. 2011)",
        "provenance_url": "https://pgda.gsfc.nasa.gov/products/78",
    },
}


def get_site_metadata(site_id: str, observer_height_m: float = 2.0) -> SiteMetadata:
    """Resolve site metadata from Member A's core.sites if available, else verified catalog."""
    clean_id = site_id.strip().lower()
    try:
        core_sites = importlib.import_module("api.app.core.sites")
        if hasattr(core_sites, "get_site"):
            ext = core_sites.get_site(clean_id)
            if isinstance(ext, dict):
                return SiteMetadata(
                    site_id=clean_id,
                    name=ext.get("name", VERIFIED_SITES[clean_id]["name"]),
                    region=ext.get("region", "Lunar south pole"),
                    lat_deg=float(ext.get("lat_deg", ext.get("latitude_deg", VERIFIED_SITES[clean_id]["lat_deg"]))),
                    lon_east_deg=float(
                        ext.get("lon_east_deg", ext.get("longitude_deg", ext.get("lon_deg", 0.0))) % 360.0
                    ),
                    elevation_m=float(ext.get("elevation_m", VERIFIED_SITES[clean_id]["elevation_m"])),
                    observer_height_m=observer_height_m,
                    reference_frame=ext.get("reference_frame", "MOON_ME"),
                    provenance_source=ext.get("provenance_source", ext.get("source_product", "NASA GSFC PGDA LOLA")),
                    provenance_url=ext.get("provenance_url", ext.get("source_url", "https://pgda.gsfc.nasa.gov/products/78")),
                )
    except ModuleNotFoundError:
        pass

    if clean_id not in VERIFIED_SITES:
        raise ValueError(f"Unknown site_id '{site_id}'. Verified sites: {list(VERIFIED_SITES.keys())}")
    info = VERIFIED_SITES[clean_id]
    return SiteMetadata(observer_height_m=observer_height_m, **info)


def get_terrain_mesh_3d(site_id: str) -> Optional[TerrainMesh3D]:
    """Load real downsampled 21x21 LRO-LOLA 5m/pix 3D elevation patch for 3D scene rendering."""
    clean_id = site_id.strip().lower()
    if not _LOLA_PATCHES_PATH.exists():
        return None
    try:
        data = json.loads(_LOLA_PATCHES_PATH.read_text(encoding="utf-8"))
        if clean_id in data:
            return TerrainMesh3D(**data[clean_id])
    except Exception:
        return None
    return None
