"""Dataset management and historical landslide intelligence endpoints."""
from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import Dataset, TrainedModel
from ..services import datasets as svc
from ..services import historical
from ..services.datasets import DatasetError

router = APIRouter(prefix="/api", tags=["datasets"])


def _err(e: DatasetError) -> JSONResponse:
    return JSONResponse(status_code=e.status, content={"detail": str(e), **e.extra})


def _get(db: Session, dataset_id: int) -> Dataset:
    ds = db.get(Dataset, dataset_id)
    if ds is None:
        raise HTTPException(404, f"Dataset {dataset_id} not found.")
    return ds


@router.post("/datasets/upload", status_code=201, summary="Upload a CSV dataset (historical or experimental)")
async def upload(
    file: UploadFile = File(...),
    category: str = Form(...),
    name: Optional[str] = Form(None),
    description: str = Form(""),
    label_source: Optional[str] = Form(None),
    is_synthetic: bool = Form(False),
    confirm_new_version: bool = Form(False),
    db: Session = Depends(get_db),
) -> Any:
    fname = file.filename or "upload.csv"
    if Path(fname).suffix.lower() != ".csv":
        raise HTTPException(400, "Only .csv files are accepted.")
    if file.content_type and file.content_type not in ("text/csv", "application/vnd.ms-excel", "application/csv",
                                                       "text/plain", "application/octet-stream"):
        raise HTTPException(400, f"Unexpected content type '{file.content_type}' for a CSV file.")
    tmp = svc.tmp_file()
    size = 0
    try:
        with open(tmp, "wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise HTTPException(413, f"File exceeds the {settings.max_upload_mb} MB limit.")
                out.write(chunk)
        if size == 0:
            raise HTTPException(400, "Uploaded file is empty.")
        try:
            ds = svc.register_dataset(db, tmp, fname, name or Path(fname).stem, category, description,
                                      label_source or None, is_synthetic, confirm_new_version)
        except DatasetError as e:
            db.rollback()
            return _err(e)
        db.commit()
        return svc.dataset_to_dict(ds, detail=True)
    finally:
        tmp.unlink(missing_ok=True)


@router.get("/datasets", summary="List datasets")
def list_datasets(category: Optional[str] = None, db: Session = Depends(get_db)) -> Any:
    q = db.query(Dataset)
    if category:
        q = q.filter(Dataset.category == category)
    return {"datasets": [svc.dataset_to_dict(d) for d in q.order_by(Dataset.uploaded_at.desc()).all()]}


@router.get("/datasets/{dataset_id}", summary="Dataset detail: schema, profile, validation warnings, cleaning report")
def get_dataset(dataset_id: int, db: Session = Depends(get_db)) -> Any:
    ds = _get(db, dataset_id)
    d = svc.dataset_to_dict(ds, detail=True)
    d["used_by_models"] = [{"id": m.id, "version": m.version} for m in
                           db.query(TrainedModel).filter(TrainedModel.dataset_id == ds.id).all()]
    return d


@router.get("/datasets/{dataset_id}/preview", summary="Paginated rows of the original or cleaned file")
def preview(dataset_id: int, offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=500),
            variant: str = Query("cleaned", pattern="^(cleaned|original)$"), db: Session = Depends(get_db)) -> Any:
    try:
        return svc.preview(_get(db, dataset_id), offset, limit, variant == "cleaned")
    except DatasetError as e:
        return _err(e)


@router.get("/datasets/{dataset_id}/download", summary="Download the original or cleaned CSV")
def download(dataset_id: int, variant: str = Query("original", pattern="^(cleaned|original)$"),
             db: Session = Depends(get_db)) -> Any:
    ds = _get(db, dataset_id)
    path = Path(ds.cleaned_path if variant == "cleaned" else ds.stored_path)
    try:
        svc._guard_path(path)
    except DatasetError as e:
        return _err(e)
    if not path.exists():
        raise HTTPException(404, "File missing on disk.")
    stem = Path(ds.original_filename).stem
    return FileResponse(path, media_type="text/csv", filename=f"{stem}_v{ds.version}_{variant}.csv")


@router.delete("/datasets/{dataset_id}", summary="Delete a dataset (requires confirm=true)")
def delete(dataset_id: int, confirm: bool = Query(False), db: Session = Depends(get_db)) -> Any:
    ds = _get(db, dataset_id)
    if not confirm:
        raise HTTPException(400, "Deletion requires confirm=true.")
    svc.delete_dataset(db, ds)
    db.commit()
    return {"deleted": dataset_id}


@router.post("/datasets/synthetic-fixture", status_code=201,
             summary="Generate a clearly-labelled SYNTHETIC experimental dataset for pipeline testing")
def synthetic_fixture(db: Session = Depends(get_db)) -> Any:
    try:
        ds = svc.build_synthetic_fixture(db)
    except DatasetError as e:
        db.rollback()
        return _err(e)
    db.commit()
    return svc.dataset_to_dict(ds, detail=True)


class FromReadings(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    device_id: Optional[str] = None
    experiment_ids: Optional[list[str]] = None
    include_simulated: bool = False
    confirm_new_version: bool = False


@router.post("/datasets/from-readings", status_code=201,
             summary="Build an experimental dataset from recorded readings (labels = ESP32 state)")
def from_readings(body: FromReadings, db: Session = Depends(get_db)) -> Any:
    try:
        ds = svc.build_from_readings(db, body.name, body.device_id, body.experiment_ids, body.include_simulated,
                                     body.confirm_new_version)
    except DatasetError as e:
        db.rollback()
        return _err(e)
    db.commit()
    return svc.dataset_to_dict(ds, detail=True)


# ---------------------------------------------------------------------------
# Historical intelligence
# ---------------------------------------------------------------------------
def _hist(db: Session, dataset_id: int) -> Dataset:
    ds = _get(db, dataset_id)
    if ds.category != "historical":
        raise HTTPException(400, "This endpoint requires a historical (event-level) dataset.")
    return ds


def _filters(year_from: Optional[int] = None, year_to: Optional[int] = None, country: Optional[str] = None,
             trigger: Optional[str] = None, category: Optional[str] = None, size: Optional[str] = None,
             setting: Optional[str] = None, fatal_only: bool = False, rain_only: bool = False) -> dict[str, Any]:
    return {k: v for k, v in dict(year_from=year_from, year_to=year_to, country=country, trigger=trigger,
                                  category=category, size=size, setting=setting, fatal_only=fatal_only,
                                  rain_only=rain_only).items() if v not in (None, "", False)}


@router.get("/historical/{dataset_id}/analytics", tags=["historical"], summary="Historical event analytics")
def hist_analytics(dataset_id: int, f: dict = Depends(_filters), db: Session = Depends(get_db)) -> Any:
    return historical.analytics(_hist(db, dataset_id), f)


@router.get("/historical/{dataset_id}/map", tags=["historical"], summary="Event points with valid coordinates")
def hist_map(dataset_id: int, f: dict = Depends(_filters), limit: int = Query(15000, ge=100, le=50000),
             db: Session = Depends(get_db)) -> Any:
    return historical.map_points(_hist(db, dataset_id), f, limit)


@router.get("/historical/{dataset_id}/filter-options", tags=["historical"], summary="Values available for filters")
def hist_options(dataset_id: int, db: Session = Depends(get_db)) -> Any:
    return historical.filter_options(_hist(db, dataset_id))


@router.put("/historical/{dataset_id}/mapping", tags=["historical"], summary="Override detected column roles")
def hist_mapping(dataset_id: int, mapping: dict[str, Optional[str]], db: Session = Depends(get_db)) -> Any:
    ds = _hist(db, dataset_id)
    try:
        m = historical.set_mapping(ds, mapping)
    except ValueError as e:
        raise HTTPException(400, str(e))
    db.commit()
    return {"mapping": m}
