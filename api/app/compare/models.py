from __future__ import annotations

from typing import Literal, Optional, Union
from pydantic import BaseModel, Field, field_validator, model_validator

from ..earth.models import (
    HorizonMode,
    QualityStatus,
    SiteMetadata,
    TerrainMesh3D,
    VisibilityWindow,
    format_utc_z,
    parse_strict_utc,
)

ConstraintStatus = Union[bool, Literal["unknown"]]


class CompareRequest(BaseModel):
    site_ids: list[str] = Field(
        default_factory=lambda: ["site01", "site04"],
        min_length=2,
        max_length=2,
        description="Two candidate landing sites to compare (site01, site04)",
    )
    start_utc: str = Field(default="2026-12-14T00:00:00Z", description="Base interval start in ISO-8601 UTC")
    end_utc: str = Field(default="2026-12-17T00:00:00Z", description="Base interval end in ISO-8601 UTC")
    step_minutes: int = Field(default=60, ge=30, le=180, description="Sampling step in minutes (30-180)")
    horizon_mode: HorizonMode = Field(default="flat", description="Horizon model: 'flat' or 'terrain'")
    clearance_deg: float = Field(default=0.0, ge=0.0, le=15.0, description="Earth elevation clearance in degrees")
    delay_hours: float = Field(default=0.0, ge=0.0, le=24.0, description="Scenario launch delay in hours (0-24)")
    observer_height_m: float = Field(default=2.0, ge=0.0, le=50.0, description="Observer height above surface in meters")
    minimum_solar_hours: float = Field(default=36.0, ge=0.0, le=336.0, description="Minimum required solar illumination hours")
    minimum_earth_visible_hours: float = Field(
        default=36.0, ge=0.0, le=336.0, description="Minimum required Earth line-of-sight hours"
    )

    @field_validator("site_ids")
    @classmethod
    def validate_sites(cls, v: list[str]) -> list[str]:
        cleaned = [s.strip().lower() for s in v]
        if len(cleaned) != 2 or len(set(cleaned)) != 2:
            raise ValueError("Exactly 2 distinct site_ids must be provided for comparison")
        for s in cleaned:
            if s not in ("site01", "site04"):
                raise ValueError(f"Unsupported site_id '{s}'. Allowed values: 'site01', 'site04'.")
        return cleaned

    @field_validator("start_utc")
    @classmethod
    def validate_start(cls, v: str) -> str:
        return format_utc_z(parse_strict_utc(v, "start_utc"))

    @field_validator("end_utc")
    @classmethod
    def validate_end(cls, v: str) -> str:
        return format_utc_z(parse_strict_utc(v, "end_utc"))

    @model_validator(mode="after")
    def validate_range(self) -> "CompareRequest":
        start_dt = parse_strict_utc(self.start_utc, "start_utc")
        end_dt = parse_strict_utc(self.end_utc, "end_utc")
        if end_dt <= start_dt:
            raise ValueError("end_utc must be strictly greater than start_utc")
        duration_hours = (end_dt - start_dt).total_seconds() / 3600.0
        if duration_hours < 1.0 or duration_hours > 336.0:
            raise ValueError("Comparison interval duration must be between 1 and 336 hours")
        return self


class CombinedSamplePoint(BaseModel):
    t_utc: str
    earth_azimuth_deg: Optional[float]
    earth_elevation_deg: Optional[float]
    earth_visible: Optional[bool]
    earth_enu_vector: Optional[tuple[float, float, float]]
    sun_azimuth_deg: Optional[float]
    sun_elevation_deg: Optional[float]
    sun_visible: Optional[bool]
    sun_enu_vector: Optional[tuple[float, float, float]]
    joint_visible: Optional[bool]


class SiteComparisonSummary(BaseModel):
    site: SiteMetadata
    quality: QualityStatus
    solar_quality: str
    earth_quality: QualityStatus
    total_hours: float
    solar_visible_hours: Optional[float]
    solar_visible_fraction: Optional[float]
    longest_solar_dark_gap_hours: Optional[float]
    earth_visible_hours: Optional[float]
    earth_visible_fraction: Optional[float]
    longest_earth_blackout_hours: Optional[float]
    overlap_solar_earth_hours: Optional[float]
    overlap_solar_earth_fraction: Optional[float]
    meets_solar_constraint: ConstraintStatus
    meets_earth_constraint: ConstraintStatus
    meets_constraints: ConstraintStatus
    constraints_satisfied_count: Optional[int]
    earth_windows: list[VisibilityWindow]
    overlap_windows: list[VisibilityWindow]
    samples: list[CombinedSamplePoint]
    terrain_mesh_3d: Optional[TerrainMesh3D] = None
    explanation: str


class BaselineDeltaSummary(BaseModel):
    site_id: str
    baseline_earth_visible_hours: Optional[float]
    delayed_earth_visible_hours: Optional[float]
    delta_earth_visible_hours: Optional[float]
    baseline_longest_blackout_hours: Optional[float]
    delayed_longest_blackout_hours: Optional[float]
    delta_longest_blackout_hours: Optional[float]
    baseline_overlap_hours: Optional[float]
    delayed_overlap_hours: Optional[float]
    delta_overlap_hours: Optional[float]


class CompareResponse(BaseModel):
    query: dict
    base_start_utc: str
    base_end_utc: str
    effective_start_utc: str
    effective_end_utc: str
    delay_hours: float
    requested_horizon_mode: HorizonMode
    effective_horizon_mode: HorizonMode
    consolidated_quality: str
    preferred_site_id: Optional[str] = Field(
        default=None,
        description="Preferred under selected constraints (None when series is unavailable or undecided)",
    )
    preference_label: str = "Preferred under selected constraints"
    ranking_order: list[str]
    ranking_rule: str
    decision_explanation: str
    warnings: list[str]
    sites: list[SiteComparisonSummary]
    delay_sensitivity: list[BaselineDeltaSummary]
    provenance: dict
