"""Machine-learning endpoints: preflight, training jobs, registry, prediction, hybrid comparison."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..ml import registry, trainer
from ..ml.registry import ModelError
from ..ml.trainer import TrainingError
from ..models import SensorReading, TrainedModel, TrainingRun
from ..schemas.ml import PredictRequest, TrainConfig

router = APIRouter(prefix="/api/ml", tags=["ml"])


def _model(db: Session, model_id: int) -> TrainedModel:
    m = db.get(TrainedModel, model_id)
    if m is None:
        raise HTTPException(404, f"Model {model_id} not found.")
    return m


@router.post("/preflight", summary="Validate a training configuration and report leakage/imbalance warnings")
def preflight(cfg: TrainConfig, db: Session = Depends(get_db)) -> Any:
    return trainer.preflight(db, cfg)


@router.post("/train", status_code=202, summary="Start a background Random Forest training job")
def train(cfg: TrainConfig, db: Session = Depends(get_db)) -> Any:
    try:
        run = trainer.submit(db, cfg)
    except TrainingError as e:
        raise HTTPException(400, str(e))
    return trainer.run_to_dict(run)


@router.get("/training-runs", summary="Training history")
def runs(limit: int = Query(50, ge=1, le=500), db: Session = Depends(get_db)) -> Any:
    rs = db.query(TrainingRun).order_by(TrainingRun.created_at.desc()).limit(limit).all()
    return {"runs": [trainer.run_to_dict(r) for r in rs]}


@router.get("/training-runs/{run_id}", summary="One training run")
def run(run_id: int, db: Session = Depends(get_db)) -> Any:
    r = db.get(TrainingRun, run_id)
    if r is None:
        raise HTTPException(404, "Training run not found.")
    d = trainer.run_to_dict(r)
    d["log"] = r.log
    return d


@router.get("/models", summary="Model registry")
def models(db: Session = Depends(get_db)) -> Any:
    ms = db.query(TrainedModel).order_by(TrainedModel.version.desc()).all()
    return {"models": [registry.model_to_dict(m) for m in ms]}


@router.get("/models/compare", summary="Compare several model versions")
def compare(ids: str = Query(..., description="Comma-separated model IDs"), db: Session = Depends(get_db)) -> Any:
    try:
        id_list = [int(x) for x in ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(400, "ids must be integers")
    return {"models": [registry.model_to_dict(_model(db, i), detail=True) for i in id_list[:6]]}


@router.get("/models/{model_id}", summary="Model detail")
def model(model_id: int, db: Session = Depends(get_db)) -> Any:
    return registry.model_to_dict(_model(db, model_id), detail=True)


@router.get("/models/{model_id}/metrics", summary="Full evaluation metrics of a model")
def metrics(model_id: int, db: Session = Depends(get_db)) -> Any:
    d = registry.model_to_dict(_model(db, model_id), detail=True)
    return {"model_id": model_id, "version": d["version"], "is_synthetic": d["is_synthetic"],
            "label_source": d["label_source"], "split_strategy": d["split_strategy"],
            "split_details": d["split_details"], "metrics": d["metrics"], "warnings": d["warnings"]}


@router.post("/models/{model_id}/activate", summary="Explicitly activate a model (deactivates others)")
def activate(model_id: int, db: Session = Depends(get_db)) -> Any:
    m = _model(db, model_id)
    try:
        registry.activate(db, m)
    except ModelError as e:
        raise HTTPException(e.status, str(e))
    db.commit()
    return registry.model_to_dict(m)


@router.post("/models/{model_id}/deactivate", summary="Deactivate a model")
def deactivate(model_id: int, db: Session = Depends(get_db)) -> Any:
    m = _model(db, model_id)
    registry.deactivate(db, m)
    db.commit()
    return registry.model_to_dict(m)


@router.delete("/models/{model_id}", summary="Delete a model and its artifact (requires confirm=true)")
def delete_model(model_id: int, confirm: bool = Query(False), db: Session = Depends(get_db)) -> Any:
    m = _model(db, model_id)
    if not confirm:
        raise HTTPException(400, "Deletion requires confirm=true.")
    if m.is_active:
        raise HTTPException(400, "Deactivate the model before deleting it.")
    registry.delete(db, m)
    db.commit()
    return {"deleted": model_id}


@router.get("/artifacts/{name}", summary="Evaluation plot images (PNG)")
def artifact(name: str) -> Any:
    p = trainer.artifact_file(name)
    if p is None:
        raise HTTPException(404, "Artifact not found.")
    return FileResponse(p, media_type="image/png")


@router.post("/predict", summary="Predict with the ACTIVE model from manual values or the latest reading")
def predict(req: PredictRequest, db: Session = Depends(get_db)) -> Any:
    m = registry.active_model(db)
    if m is None:
        raise HTTPException(409, "No active model. Train a model and activate it explicitly before predicting.")
    if req.use_latest:
        q = db.query(SensorReading)
        if req.device_id:
            q = q.filter(SensorReading.device_id == req.device_id)
        r = q.order_by(SensorReading.received_at.desc()).first()
        if r is None:
            raise HTTPException(404, "No readings available.")
        values = {f: getattr(r, f, None) for f in registry.loads(m.features_json, [])}
        source = {"type": "latest_reading", "reading_id": r.id, "device_id": r.device_id,
                  "esp32_risk_state": r.esp32_risk_state, "is_simulated": r.is_simulated}
    else:
        if not req.features:
            raise HTTPException(400, "Provide `features` or set use_latest=true.")
        values = req.features
        source = {"type": "manual"}
    try:
        res = registry.predict(m, values)
    except ModelError as e:
        raise HTTPException(e.status if e.status != 400 else 422, str(e))
    res["source"] = source
    return res


@router.get("/hybrid", summary="ESP32 rule state vs Random Forest prediction on the latest reading")
def hybrid(device_id: Optional[str] = None, db: Session = Depends(get_db)) -> Any:
    return registry.hybrid(db, device_id)
