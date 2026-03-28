"""Lore 相关 API 路由。"""

from pathlib import Path
from fastapi import APIRouter
from pydantic import BaseModel
from api import error_response

router = APIRouter(prefix="/api/v1/lore", tags=["lore"])

class LoreSaveRequest(BaseModel):
    au_path: str | None = None
    fandom_path: str | None = None
    category: str
    filename: str
    content: str

@router.put("")
async def save_lore(req: LoreSaveRequest):
    if req.au_path:
        base_dir = Path(req.au_path)
    elif req.fandom_path:
        base_dir = Path(req.fandom_path)
    else:
        return error_response(400, "INVALID_REQUEST", "Must provide au_path or fandom_path", [])
        
    target_dir = base_dir / req.category
    target_dir.mkdir(parents=True, exist_ok=True)
    
    file_path = target_dir / req.filename
    if not file_path.name.endswith(".md"):
        file_path = file_path.with_name(f"{file_path.name}.md")
        
    try:
        file_path.write_text(req.content, encoding="utf-8")
    except Exception as e:
        return error_response(500, "LORE_SAVE_FAILED", str(e), [])
        
    return {"status": "ok", "path": str(file_path)}
