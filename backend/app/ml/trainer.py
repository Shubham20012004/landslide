"""Random Forest training pipeline with leakage-aware splitting.

Pipeline: SimpleImputer(median) -> RandomForestClassifier, fitted on the TRAINING split only.
Split strategies:
  group         GroupShuffleSplit on an experiment/run ID — no experiment appears in both sets.
  chronological last `test_size` fraction (by time column, else row order) is the test set.
  stratified    random split preserving class ratios (requires acknowledgement when readings are sequential/grouped).
  random        plain random split (same acknowledgement rule).
"""
from __future__ import annotations

import logging
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import GroupShuffleSplit, train_test_split
from sklearn.pipeline import Pipeline
from sqlalchemy.orm import Session

from ..config import settings
from ..database import session_scope
from ..models import Dataset, TrainedModel, TrainingRun
from ..schemas.ml import TrainConfig
from ..services.datasets import GROUP_CANDIDATES, TIME_CANDIDATES, find_column, load_df
from ..services.events import log_event
from ..utils import clean_float, dumps, loads, sha256_file, utcnow

log = logging.getLogger("landslide.ml")
LEVEL_ORDER = ["SAFE", "WATCH", "WARNING", "CRITICAL"]
LEAKY_FEATURES = {"weighted_score", "esp32_risk_state", "risk_score", "risk_state", "label"}
MIN_ROWS = 20

executor = ThreadPoolExecutor(max_workers=settings.training_workers, thread_name_prefix="trainer")


class TrainingError(ValueError):
    pass


def order_classes(classes: list[str]) -> list[str]:
    known = [c for c in LEVEL_ORDER if c in classes]
    return known + sorted(c for c in classes if c not in LEVEL_ORDER)


def _prepare(df: pd.DataFrame, cfg: TrainConfig) -> tuple[pd.DataFrame, pd.Series, dict[str, Any]]:
    info: dict[str, Any] = {"rows_in_file": int(len(df))}
    y = df[cfg.target].astype("string").str.strip().str.upper()
    keep = y.notna() & (y != "")
    info["rows_dropped_missing_target"] = int((~keep).sum())
    df, y = df[keep], y[keep].astype(str)
    X = df[cfg.features].apply(pd.to_numeric, errors="coerce")
    info["feature_missing"] = {c: int(X[c].isna().sum()) for c in cfg.features}
    info["rows_usable"] = int(len(X))
    return X, y, info


def preflight(db: Session, cfg: TrainConfig) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    blocking: list[str] = []
    ds = db.get(Dataset, cfg.dataset_id)
    if ds is None:
        return {"ok": False, "errors": [f"Dataset {cfg.dataset_id} not found."], "warnings": [], "blocking_warnings": []}
    out: dict[str, Any] = {"dataset": {"id": ds.id, "name": ds.name, "version": ds.version, "label_source": ds.label_source,
                                       "is_synthetic": ds.is_synthetic, "sha256": ds.sha256}}
    if ds.category != "experimental":
        errors.append("Historical event datasets cannot train the sensor model: they contain no sensor measurements. "
                      "Select an experimental sensor dataset.")
        return {**out, "ok": False, "errors": errors, "warnings": warnings, "blocking_warnings": blocking}
    df = load_df(ds, cleaned=True)
    cols = list(df.columns)
    missing = [c for c in cfg.features + [cfg.target] if c not in cols]
    if missing:
        errors.append(f"Columns not in dataset: {missing}")
    if cfg.target in cfg.features:
        errors.append("The target column cannot also be a feature.")
    if errors:
        return {**out, "ok": False, "errors": errors, "warnings": warnings, "blocking_warnings": blocking}

    X, y, info = _prepare(df, cfg)
    out["data"] = info
    for c in cfg.features:
        raw_nonnull = int(df.loc[X.index, c].notna().sum())
        num_nonnull = int(X[c].notna().sum())
        if raw_nonnull and num_nonnull < 0.5 * raw_nonnull:
            errors.append(f"Feature '{c}' is not numeric (only {num_nonnull}/{raw_nonnull} values convert to numbers).")
        elif num_nonnull == 0:
            errors.append(f"Feature '{c}' has no values.")
        elif X[c].isna().any():
            warnings.append(f"Feature '{c}' has {int(X[c].isna().sum())} missing values; they will be imputed with the TRAINING-set median.")
    dist = y.value_counts()
    out["class_distribution"] = [{"label": k, "count": int(dist.get(k, 0)), "pct": round(100 * dist.get(k, 0) / max(len(y), 1), 2)}
                                 for k in order_classes(list(dist.index))]
    unknown = sorted(set(dist.index) - set(LEVEL_ORDER))
    if unknown:
        warnings.append(f"Target contains non-standard classes: {unknown}.")
    if len(dist) < 2:
        errors.append("Target needs at least two classes.")
    if len(y) < MIN_ROWS:
        errors.append(f"Only {len(y)} labelled rows; at least {MIN_ROWS} are required.")
    if len(dist) >= 2 and dist.min() / dist.max() < 0.1:
        warnings.append("Class imbalance is severe; judge the model by macro-F1 and per-class recall, and consider class weighting.")
    missing_levels = [c for c in LEVEL_ORDER if c not in dist.index]
    if missing_levels and not unknown:
        warnings.append(f"No examples of {missing_levels}; the model can never predict these classes.")

    group_col = cfg.group_column or find_column(cols, GROUP_CANDIDATES)
    time_col = cfg.time_column or find_column(cols, TIME_CANDIDATES)
    out["detected"] = {"group_column": group_col, "time_column": time_col}

    if cfg.split_strategy == "group":
        if not group_col or group_col not in cols:
            errors.append("Group split selected but no group/experiment column is available.")
        else:
            n_groups = int(df.loc[y.index, group_col].nunique())
            out["n_groups"] = n_groups
            if n_groups < 2:
                errors.append(f"Group column '{group_col}' has only {n_groups} group; need at least 2.")
            elif n_groups < 5:
                warnings.append(f"Only {n_groups} groups: the test set will contain very few experiments, so metrics are unstable.")
    elif cfg.split_strategy == "chronological":
        if time_col and time_col in cols:
            parsed = pd.to_datetime(df[time_col], errors="coerce", utc=True, format="mixed")
            if parsed.notna().mean() < 0.9:
                errors.append(f"Time column '{time_col}' could not be parsed for most rows.")
        else:
            warnings.append("No time column: chronological split will use file row order.")
        if group_col:
            warnings.append("Chronological split across several experiments: later experiments become the test set.")
    else:
        if group_col:
            blocking.append(f"A group column ('{group_col}') exists, but a {cfg.split_strategy} split puts readings from the SAME "
                            "experiment in both training and test sets. Consecutive readings are highly correlated, so the "
                            "test score will be optimistically biased. Use the group split unless you accept this.")
        elif time_col:
            blocking.append(f"Rows look sequential (time column '{time_col}'). A {cfg.split_strategy} split lets near-identical "
                            "neighbouring readings appear in both sets, inflating scores. Prefer the chronological split.")
        if cfg.split_strategy == "stratified" and len(dist) and dist.min() < 2:
            errors.append("Stratified split requires at least 2 rows in every class.")
    leaky = [f for f in cfg.features if f.lower() in LEAKY_FEATURES]
    if leaky:
        blocking.append(f"Features {leaky} are outputs of the rule engine that may have produced the labels (target leakage).")
    if ds.label_source == "esp32_rule_engine":
        warnings.append("Labels were generated by the ESP32 rule engine: the model may learn to reproduce those rules rather "
                        "than discover independent slope behaviour. Report this in your results.")
    if ds.label_source in (None, "unknown"):
        warnings.append("Label source is not documented for this dataset.")
    if ds.is_synthetic:
        warnings.append("SYNTHETIC dataset: metrics test the pipeline only and are NOT project findings.")
    out.update(ok=not errors, errors=errors, warnings=warnings, blocking_warnings=blocking,
               needs_acknowledgement=bool(blocking))
    return out


def _split(df: pd.DataFrame, X: pd.DataFrame, y: pd.Series, cfg: TrainConfig, detected: dict) -> tuple[np.ndarray, np.ndarray, dict]:
    idx = np.arange(len(X))
    details: dict[str, Any] = {"strategy": cfg.split_strategy}
    if cfg.split_strategy == "group":
        g = df.loc[X.index, detected["group_column"]].astype(str).values
        gss = GroupShuffleSplit(n_splits=1, test_size=cfg.test_size, random_state=cfg.random_seed)
        tr, te = next(gss.split(X, y, groups=g))
        details.update(group_column=detected["group_column"],
                       train_groups=sorted(set(g[tr])), test_groups=sorted(set(g[te])))
        if set(g[tr]) & set(g[te]):
            raise TrainingError("Group leakage detected after splitting.")
    elif cfg.split_strategy == "chronological":
        tcol = detected.get("time_column")
        if tcol:
            t = pd.to_datetime(df.loc[X.index, tcol], errors="coerce", utc=True, format="mixed")
            order = np.argsort(t.values.astype("datetime64[ns]").astype("int64"), kind="stable")
            details["time_column"] = tcol
        else:
            order = idx
            details["time_column"] = "(row order)"
        n_test = max(1, int(round(len(idx) * cfg.test_size)))
        tr, te = order[:-n_test], order[-n_test:]
    else:
        strat = y.values if cfg.split_strategy == "stratified" else None
        tr, te = train_test_split(idx, test_size=cfg.test_size, random_state=cfg.random_seed, stratify=strat)
    details.update(n_train=int(len(tr)), n_test=int(len(te)))
    return np.asarray(tr), np.asarray(te), details


def _plots(model_version: int, cm: list[list[int]], labels: list[str], fi: list[dict]) -> dict[str, str]:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    d = settings.artifact_dir / "plots"
    d.mkdir(parents=True, exist_ok=True)
    out = {}
    fig, ax = plt.subplots(figsize=(5, 4.2), dpi=120)
    arr = np.array(cm)
    ax.imshow(arr, cmap="Blues")
    ax.set_xticks(range(len(labels)), labels, rotation=30)
    ax.set_yticks(range(len(labels)), labels)
    ax.set_xlabel("Predicted")
    ax.set_ylabel("Actual")
    ax.set_title(f"Confusion matrix — model v{model_version}")
    for i in range(arr.shape[0]):
        for j in range(arr.shape[1]):
            ax.text(j, i, int(arr[i, j]), ha="center", va="center",
                    color="white" if arr[i, j] > arr.max() / 2 else "black")
    fig.tight_layout()
    p = d / f"model_v{model_version}_confusion_matrix.png"
    fig.savefig(p)
    plt.close(fig)
    out["confusion_matrix"] = p.name
    fig, ax = plt.subplots(figsize=(5.5, 3.2), dpi=120)
    names = [f["feature"] for f in fi][::-1]
    vals = [f["importance"] for f in fi][::-1]
    ax.barh(names, vals, color="#3b82f6")
    ax.set_title(f"Feature importance (MDI) — model v{model_version}")
    fig.tight_layout()
    p = d / f"model_v{model_version}_feature_importance.png"
    fig.savefig(p)
    plt.close(fig)
    out["feature_importance"] = p.name
    return out


def train(cfg: TrainConfig, df: pd.DataFrame, detected: dict, model_version: int) -> dict[str, Any]:
    X, y, info = _prepare(df, cfg)
    tr, te = None, None
    tr, te, split_details = _split(df, X, y, cfg, detected)
    Xtr, Xte, ytr, yte = X.iloc[tr], X.iloc[te], y.iloc[tr], y.iloc[te]
    if ytr.nunique() < 2:
        raise TrainingError("Training split contains a single class; change the split or seed.")
    pipe = Pipeline([
        ("imputer", SimpleImputer(strategy="median", keep_empty_features=True)),
        ("rf", RandomForestClassifier(
            n_estimators=cfg.n_estimators, max_depth=cfg.max_depth,
            min_samples_split=cfg.min_samples_split, min_samples_leaf=cfg.min_samples_leaf,
            class_weight=None if cfg.class_weight == "none" else cfg.class_weight,
            random_state=cfg.random_seed, n_jobs=2,
        )),
    ])
    t0 = time.perf_counter()
    pipe.fit(Xtr, ytr)
    fit_sec = time.perf_counter() - t0
    pred = pipe.predict(Xte)
    labels = order_classes(sorted(set(y)))
    cm = confusion_matrix(yte, pred, labels=labels).tolist()
    rep = classification_report(yte, pred, labels=labels, output_dict=True, zero_division=0)
    per_class = [{
        "label": c,
        "precision": clean_float(rep[c]["precision"]), "recall": clean_float(rep[c]["recall"]),
        "f1": clean_float(rep[c]["f1-score"]), "support": int(rep[c]["support"]),
    } for c in labels]
    majority = ytr.value_counts().idxmax()
    rf = pipe.named_steps["rf"]
    mdi = sorted(({"feature": f, "importance": clean_float(v)} for f, v in zip(cfg.features, rf.feature_importances_)),
                 key=lambda x: -(x["importance"] or 0))
    try:
        perm = permutation_importance(pipe, Xte, yte, n_repeats=5, random_state=cfg.random_seed, scoring="f1_macro", n_jobs=1)
        perm_list = sorted(({"feature": f, "importance": clean_float(m), "std": clean_float(s)}
                            for f, m, s in zip(cfg.features, perm.importances_mean, perm.importances_std)),
                           key=lambda x: -(x["importance"] or 0))
    except Exception as e:  # pragma: no cover - tiny test sets
        perm_list = []
        log.warning("permutation importance failed: %s", e)
    warnings = []
    absent = [c for c in labels if c not in set(yte)]
    if absent:
        warnings.append(f"Classes absent from the test set: {absent}; their recall cannot be evaluated.")
    metrics = {
        "accuracy": clean_float(accuracy_score(yte, pred)),
        "balanced_accuracy": clean_float(balanced_accuracy_score(yte, pred)),
        "precision_macro": clean_float(precision_score(yte, pred, average="macro", zero_division=0, labels=labels)),
        "recall_macro": clean_float(recall_score(yte, pred, average="macro", zero_division=0, labels=labels)),
        "f1_macro": clean_float(f1_score(yte, pred, average="macro", zero_division=0, labels=labels)),
        "precision_weighted": clean_float(precision_score(yte, pred, average="weighted", zero_division=0, labels=labels)),
        "recall_weighted": clean_float(recall_score(yte, pred, average="weighted", zero_division=0, labels=labels)),
        "f1_weighted": clean_float(f1_score(yte, pred, average="weighted", zero_division=0, labels=labels)),
        "majority_baseline_accuracy": clean_float(float((yte == majority).mean())),
        "majority_class": majority,
        "per_class": per_class,
        "confusion_matrix": {"labels": labels, "matrix": cm},
        "classification_report_text": classification_report(yte, pred, labels=labels, zero_division=0),
        "feature_importance_mdi": mdi,
        "permutation_importance": perm_list,
        "class_distribution_train": {k: int(v) for k, v in ytr.value_counts().items()},
        "class_distribution_test": {k: int(v) for k, v in yte.value_counts().items()},
        "fit_time_sec": clean_float(fit_sec, 3),
        "n_rows": info["rows_usable"], "n_train": int(len(tr)), "n_test": int(len(te)),
        "evaluation_warnings": warnings,
    }
    return {"pipeline": pipe, "metrics": metrics, "split": split_details, "classes": labels, "info": info}


def run_training(run_id: int) -> None:
    """Executed in the training thread pool."""
    t0 = time.perf_counter()
    with session_scope() as db:
        run = db.get(TrainingRun, run_id)
        run.status, run.started_at = "running", utcnow()
        cfg = TrainConfig(**loads(run.config_json, {}))
        log_event(db, "ml", "TRAINING_STARTED", f"Training run #{run_id} started on dataset '{run.dataset_name}'.",
                  details={"run_id": run_id})
    try:
        with session_scope() as db:
            ds = db.get(Dataset, cfg.dataset_id)
            if ds is None:
                raise TrainingError("Dataset was deleted before training started.")
            pf = preflight(db, cfg)
            if not pf["ok"]:
                raise TrainingError("; ".join(pf["errors"]))
            df = load_df(ds, cleaned=True)
            ds_meta = (ds.id, f"{ds.name} v{ds.version}", ds.sha256, ds.label_source, ds.is_synthetic)
            version = (db.query(TrainedModel.version).order_by(TrainedModel.version.desc()).limit(1).scalar() or 0) + 1
        res = train(cfg, df, pf["detected"], version)
        art_dir = settings.artifact_dir / "models"
        art_dir.mkdir(parents=True, exist_ok=True)
        path = art_dir / f"model_v{version}_{uuid.uuid4().hex[:8]}.joblib"
        joblib.dump({"pipeline": res["pipeline"], "features": cfg.features, "classes": res["classes"],
                     "target": cfg.target, "version": version, "format": "landslide-rf-v1"}, path)
        plots = {}
        try:
            plots = _plots(version, res["metrics"]["confusion_matrix"]["matrix"], res["classes"],
                           res["metrics"]["feature_importance_mdi"])
        except Exception:
            log.exception("plot generation failed")
        res["metrics"]["plots"] = plots
        duration = time.perf_counter() - t0
        res["metrics"]["training_duration_sec"] = clean_float(duration, 3)
        all_warnings = pf["warnings"] + pf["blocking_warnings"] + res["metrics"]["evaluation_warnings"]
        with session_scope() as db:
            m = TrainedModel(
                version=version, name=cfg.model_name, run_id=run_id, dataset_id=ds_meta[0], dataset_name=ds_meta[1],
                dataset_hash=ds_meta[2], features_json=dumps(cfg.features), target=cfg.target,
                classes_json=dumps(res["classes"]),
                hyperparams_json=dumps({k: getattr(cfg, k) for k in ("n_estimators", "max_depth", "min_samples_split",
                                                                    "min_samples_leaf", "class_weight", "random_seed", "test_size")}),
                split_strategy=cfg.split_strategy, split_details_json=dumps(res["split"]),
                metrics_json=dumps(res["metrics"]), training_duration_sec=duration,
                n_rows=res["metrics"]["n_rows"], n_train=res["metrics"]["n_train"], n_test=res["metrics"]["n_test"],
                artifact_path=str(path), artifact_sha256=sha256_file(path), is_active=False,
                label_source=ds_meta[3], is_synthetic=ds_meta[4], warnings_json=dumps(all_warnings), notes=cfg.notes,
            )
            db.add(m)
            db.flush()
            run = db.get(TrainingRun, run_id)
            run.status, run.finished_at, run.model_id, run.duration_sec = "completed", utcnow(), m.id, duration
            run.warnings_json = dumps(all_warnings)
            log_event(db, "ml", "TRAINING_COMPLETED",
                      f"Run #{run_id} produced model v{version} (macro-F1 {res['metrics']['f1_macro']}, "
                      f"split {cfg.split_strategy}). Not activated automatically."
                      + (" [SYNTHETIC DATA]" if ds_meta[4] else ""),
                      details={"run_id": run_id, "model_id": m.id, "version": version})
    except Exception as e:
        log.exception("training run %s failed", run_id)
        with session_scope() as db:
            run = db.get(TrainingRun, run_id)
            run.status, run.finished_at = "failed", utcnow()
            run.error = str(e)[:2000]
            run.log = traceback.format_exc()[-4000:]
            run.duration_sec = time.perf_counter() - t0
            log_event(db, "ml", "TRAINING_FAILED", f"Training run #{run_id} failed: {str(e)[:300]}", severity="warning",
                      details={"run_id": run_id})


def submit(db: Session, cfg: TrainConfig) -> TrainingRun:
    pf = preflight(db, cfg)
    if not pf["ok"]:
        raise TrainingError("; ".join(pf["errors"]))
    if pf["blocking_warnings"] and not cfg.acknowledge_warnings:
        raise TrainingError("Acknowledgement required: " + " ".join(pf["blocking_warnings"]))
    ds = db.get(Dataset, cfg.dataset_id)
    run = TrainingRun(status="queued", dataset_id=ds.id, dataset_name=f"{ds.name} v{ds.version}",
                      config_json=cfg.model_dump_json(), warnings_json=dumps(pf["warnings"] + pf["blocking_warnings"]))
    db.add(run)
    db.commit()
    executor.submit(run_training, run.id)
    return run


def run_to_dict(r: TrainingRun) -> dict[str, Any]:
    from ..utils import iso

    return {
        "id": r.id, "status": r.status, "created_at": iso(r.created_at), "started_at": iso(r.started_at),
        "finished_at": iso(r.finished_at), "dataset_id": r.dataset_id, "dataset_name": r.dataset_name,
        "config": loads(r.config_json, {}), "warnings": loads(r.warnings_json, []), "error": r.error,
        "model_id": r.model_id, "duration_sec": clean_float(r.duration_sec, 3),
    }


def artifact_file(name: str) -> Optional[Path]:
    """Resolve a plot filename inside the artifact dir (no path traversal)."""
    if "/" in name or "\\" in name or ".." in name:
        return None
    p = settings.artifact_dir / "plots" / name
    return p if p.exists() else None
