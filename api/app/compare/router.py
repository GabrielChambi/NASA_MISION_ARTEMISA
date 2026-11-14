from __future__ import annotations

from fastapi import APIRouter, HTTPException
import httpx

from .models import CompareRequest, CompareResponse
from .service import compare_sites

router = APIRouter(prefix="/api/compare", tags=["compare"])


@router.post("", response_model=CompareResponse)
def post_compare_sites(req: CompareRequest) -> CompareResponse:
    try:
        return compare_sites(req)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"External ephemeris service (JPL Horizons) temporarily unreachable: {exc}",
        ) from exc
