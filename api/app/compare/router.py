from fastapi import APIRouter
from fastapi.responses import JSONResponse
from ..core.horizon import HorizonUnavailable
from ..mission_bridge import compare_payload
from .models import CompareRequest, CompareResponse

router=APIRouter(prefix='/api/compare',tags=['compare'])

@router.post('',response_model=CompareResponse)
async def post_compare_sites(req:CompareRequest):
    try: return await compare_payload(req.model_dump())
    except ValueError as exc:
        if isinstance(exc,HorizonUnavailable): raise
        return JSONResponse(status_code=422,content={'status':'unavailable','message':str(exc)})
