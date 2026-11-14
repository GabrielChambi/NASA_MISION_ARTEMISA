from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional
from pydantic import BaseModel, Field, field_validator, model_validator

AU_TO_KM = 149597870.700

HorizonMode = Literal["flat", "terrain"]
QualityStatus = Literal[
    "verified_horizons_flat",
    "verified_horizons_terrain",
    "terrain_unavailable",
    "degraded",
    "cached_horizons_flat",
    "unavailable",
]


def parse_strict_utc(value: str, field_name: str = "timestamp") -> datetime:
    """Validate and parse strict UTC ISO-8601 strings."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be a non-empty ISO-8601 UTC string")
    raw = value.strip()
    if not (raw.endswith("Z") or raw.endswith("+00:00")):
        raise ValueError(f"{field_name} must explicitly specify UTC timezone ('Z' or '+00:00')")
    normalized = raw[:-1] + "+00:00" if raw.endswith("Z") else raw
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValueError(f"Invalid ISO-8601 UTC timestamp for {field_name}: {value}") from exc
    return dt.astimezone(timezone.utc)


def format_utc_z(dt: datetime) -> str:
    """Format a UTC datetime as YYYY-MM-DDTHH:MM:SSZ."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class EarthQueryRequest(BaseModel):
    site_id: str = Field(default="site04", description="Verified landing site identifier (site01 or site04)")
    start_utc: str = Field(default="2026-12-14T00:00:00Z", description="Interval start in ISO-8601 UTC")
    end_utc: str = Field(default="2026-12-17T00:00:00Z", description="Interval end in ISO-8601 UTC")
    step_minutes: int = Field(default=60, ge=5, le=1440, description="Sampling step in minutes (5-1440)")
    horizon_mode: HorizonMode = Field(default="flat", description="Horizon model: 'flat' (0 deg) or 'terrain'")
    clearance_deg: float = Field(default=0.0, ge=0.0, le=20.0, description="Additional elevation clearance angle in degrees")
    delay_hours: float = Field(default=0.0, ge=0.0, le=24.0, description="Launch/arrival scenario delay in hours (0-24)")
    observer_height_m: float = Field(default=2.0, ge=0.0, le=100.0, description="Antenna height above lunar surface in meters")

    @field_validator("site_id")
    @classmethod
    def validate_site_id(cls, v: str) -> str:
        clean = v.strip().lower()
        if clean not in ("site01", "site04"):
            raise ValueError(f"Unsupported site_id '{v}'. Allowed values: 'site01', 'site04'.")
        return clean

    @field_validator("start_utc")
    @classmethod
    def validate_start(cls, v: str) -> str:
        dt = parse_strict_utc(v, "start_utc")
        return format_utc_z(dt)

    @field_validator("end_utc")
    @classmethod
    def validate_end(cls, v: str) -> str:
        dt = parse_strict_utc(v, "end_utc")
        return format_utc_z(dt)

    @model_validator(mode="after")
    def validate_interval_bounds(self) -> "EarthQueryRequest":
        start_dt = parse_strict_utc(self.start_utc, "start_utc")
        end_dt = parse_strict_utc(self.end_utc, "end_utc")
        if end_dt <= start_dt:
            raise ValueError("end_utc must be strictly greater than start_utc")
        duration_hours = (end_dt - start_dt).total_seconds() / 3600.0
        if duration_hours < 1.0:
            raise ValueError("Interval duration must be at least 1 hour")
        if duration_hours > 744.0:
            raise ValueError("Interval duration cannot exceed 744 hours (31 days) to prevent abusive queries")
        max_samples = int((duration_hours * 60) // self.step_minutes) + 1
        if max_samples > 1501:
            raise ValueError(f"Requested query generates {max_samples} samples (limit is 1501)")
        return self


class VisibilityWindow(BaseModel):
    start_utc: str = Field(..., description="Window start timestamp UTC (inclusive)")
    end_utc: str = Field(..., description="Window end timestamp UTC (exclusive, semi-open [start, end))")
    duration_hours: float = Field(..., description="Window duration in hours")


class EarthSample(BaseModel):
    t_utc: str = Field(..., description="Sample UTC timestamp")
    azimuth_deg: float = Field(..., description="Topocentric azimuth in degrees (0=N, 90=E)")
    elevation_deg: float = Field(..., description="Topocentric elevation in degrees above local horizontal")
    local_horizon_deg: float = Field(..., description="Horizon elevation angle at sample azimuth (0 in flat mode)")
    clearance_deg: float = Field(..., description="Configured clearance margin in degrees")
    effective_threshold_deg: float = Field(..., description="local_horizon_deg + clearance_deg")
    earth_visible: bool = Field(..., description="True iff elevation_deg > local_horizon_deg + clearance_deg")
    range_km: float = Field(..., description="Observer-to-Earth-center distance in kilometers")
    range_rate_km_s: float = Field(..., description="Line-of-sight range rate (deldot) in km/s")
    enu_vector: tuple[float, float, float] = Field(
        ..., description="3D unit vector [east, north, up] in lunar topocentric frame (ready for 3D engines)"
    )
    solar_elongation_note: Optional[str] = None


class HorizonProfilePoint(BaseModel):
    azimuth_deg: float
    horizon_elevation_deg: float
    enu_rim_vector: tuple[float, float, float]


class TerrainMesh3D(BaseModel):
    grid_size: int
    spacing_m: float
    extent_m: float
    center_elevation_m: float
    min_elevation_m: float
    max_elevation_m: float
    elevation_grid_m: list[list[float]]
    slope_grid_deg: Optional[list[list[float]]] = None
    center_slope_deg: Optional[float] = None
    mean_slope_deg: Optional[float] = None
    uncertainty_grid_m: Optional[list[list[float]]] = None
    center_uncertainty_m: Optional[float] = None
    median_uncertainty_m: Optional[float] = None
    frame: str = "South Polar Stereographic MOON_ME (LRO-LOLA 5m/pix)"
    provenance_url: str = "https://pgda.gsfc.nasa.gov/products/78"


class SiteMetadata(BaseModel):
    site_id: str
    name: str
    region: str
    lat_deg: float
    lon_east_deg: float
    elevation_m: float
    observer_height_m: float
    reference_frame: str
    provenance_source: str
    provenance_url: str


class EarthMetricsSummary(BaseModel):
    total_hours: float
    earth_visible_hours: float
    earth_visible_fraction: float
    longest_earth_blackout_hours: float
    longest_earth_visible_hours: float
    min_elevation_deg: float
    max_elevation_deg: float
    mean_elevation_deg: float
    mean_azimuth_deg: float
    mean_range_km: float
    expected_samples: int
    received_samples: int
    missing_samples: int


class EarthProvenance(BaseModel):
    source: str = "JPL Horizons"
    ephemeris_kernel: str = "DE441"
    target_body: str = "Earth (399)"
    center_body: str = "Moon topocentric (coord@301)"
    visibility_definition: str = "geometric line of sight to Earth center (elevation_deg > local_horizon_deg + clearance_deg)"
    interval_convention: str = "[start_utc, end_utc)"
    requested_horizon_mode: HorizonMode
    effective_horizon_mode: HorizonMode
    cache_hit: bool
    retrieved_at_utc: str
    limitations: list[str]
    query_url: Optional[str] = None


class EarthResponse(BaseModel):
    site: SiteMetadata
    query: dict
    effective_start_utc: str
    effective_end_utc: str
    quality: QualityStatus
    warnings: list[str]
    metrics: EarthMetricsSummary
    windows: list[VisibilityWindow]
    blackout_windows: list[VisibilityWindow]
    horizon_profile: list[HorizonProfilePoint]
    samples: list[EarthSample]
    terrain_mesh_3d: Optional[TerrainMesh3D] = None
    provenance: EarthProvenance
