"""Compatibility names backed by the common verified DEM catalog."""
from .models import SiteMetadata, TerrainMesh3D
from ..core.sites import catalog

VERIFIED_SITES = {s['id']:s for s in catalog()['sites']}

def get_site_metadata(site_id: str, observer_height_m: float = 2.0) -> SiteMetadata:
    from ..mission_bridge import site_metadata
    return SiteMetadata(**site_metadata(site_id.strip().lower(),observer_height_m))

def get_terrain_mesh_3d(site_id: str):
    from ..mission_bridge import terrain_mesh
    mesh=terrain_mesh(site_id.strip().lower())
    return TerrainMesh3D(**mesh) if mesh else None
