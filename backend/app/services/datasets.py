"""Dataset management: validation, profiling, cleaning, versioning and provenance.

Category A — historical: event-level landslide catalogues (analysis only).
Category B — experimental: prototype sensor measurements with labels (ML training).
The two are never merged: historical events contain no sensor time series.
"""
from __future__ import annotations

import csv
import logging
import random
import re
import shutil
import uuid
from datetime import timedelta
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Dataset, SensorReading
from ..utils import clean_float, dumps, iso, loads, sha256_file, utcnow
from .events import log_event
from .risk_engine import LEVELS, FirmwareEngine

log = logging.getLogger("landslide.datasets")

CATEGORIES = ("historical", "experimental")
LABEL_SOURCES = (
    "manual_observation",   # labels assigned by the team from observed slope behaviour
    "esp32_rule_engine",    # labels = firmware risk state (model may learn the rules)
    "synthetic_rule_engine",  # synthetic fixture for pipeline testing only
    "unknown",
)
EXPECTED_FEATURES = [
    "moisture_index",
    "rain_index",
    "tilt_change_deg",
    "moisture_rate_per_min",
    "tilt_rate_deg_per_min",
]
EXPECTED_TARGET = "risk_label"
GROUP_CANDIDATES = ["experiment_id", "run_id", "group_id", "trial_id", "session_id"]
TIME_CANDIDATES = ["timestamp", "time", "datetime", "received_at", "date_time"]
ENCODINGS = ("utf-8-sig", "cp1252", "latin-1")


class DatasetError(ValueError):
    """Validation error surfaced to the client as HTTP 400/409."""

    def __init__(self, message: str, status: int = 400, extra: Optional[dict] = None):
        super().__init__(message)
        self.status = status
        self.extra = extra or {}


# ---------------------------------------------------------------------------
# Reading CSVs safely
# ---------------------------------------------------------------------------
def sniff_binary(path: Path) -> bool:
    with open(path, "rb") as fh:
        head = fh.read(8192)
    return b"\x00" in head


def read_csv_safely(path: Path) -> tuple[pd.DataFrame, str, list[str]]:
    """Return (df, encoding, warnings). Tries strict parsing, then tolerant parsing."""
    if sniff_binary(path):
        raise DatasetError("File appears to be binary, not a text CSV.")
    warnings: list[str] = []
    last_err: Optional[Exception] = None
    for enc in ENCODINGS:
        try:
            with open(path, encoding=enc) as fh:
                fh.read()
        except UnicodeDecodeError as e:
            last_err = e
            continue
        if enc != "utf-8-sig":
            warnings.append(f"File is not valid UTF-8; decoded as {enc}.")
        try:
            df = pd.read_csv(path, encoding=enc, low_memory=False)
        except pd.errors.EmptyDataError:
            raise DatasetError("CSV file is empty.")
        except pd.errors.ParserError:
            bad: list[int] = []

            def _bad(line: list[str]) -> None:
                bad.append(1)
                return None

            df = pd.read_csv(path, encoding=enc, engine="python", on_bad_lines=_bad)
            warnings.append(f"{len(bad)} malformed line(s) could not be parsed and were skipped.")
        return df, enc, warnings
    raise DatasetError(f"Could not decode file: {last_err}")


def _kind(s: pd.Series) -> str:
    if pd.api.types.is_bool_dtype(s):
        return "boolean"
    if pd.api.types.is_numeric_dtype(s):
        return "numeric"
    if pd.api.types.is_datetime64_any_dtype(s):
        return "datetime"
    nonnull = s.dropna().astype(str)
    if len(nonnull) and pd.to_numeric(nonnull, errors="coerce").notna().mean() > 0.95:
        return "numeric-like text"
    return "text"


def profile(df: pd.DataFrame) -> dict[str, Any]:
    cols = []
    n = len(df)
    for c in df.columns:
        s = df[c]
        miss = int(s.isna().sum())
        info: dict[str, Any] = {
            "name": str(c),
            "dtype": str(s.dtype),
            "kind": _kind(s),
            "missing": miss,
            "missing_pct": round(100 * miss / n, 2) if n else 0.0,
            "unique": int(s.nunique(dropna=True)),
            "sample_values": [str(v)[:60] for v in s.dropna().head(3).tolist()],
        }
        if pd.api.types.is_numeric_dtype(s) and not pd.api.types.is_bool_dtype(s) and s.notna().any():
            info.update(min=clean_float(s.min()), max=clean_float(s.max()), mean=clean_float(s.mean()))
        cols.append(info)
    return {
        "n_rows": n,
        "n_columns": int(df.shape[1]),
        "columns": cols,
        "duplicate_rows": int(df.duplicated().sum()) if n else 0,
        "total_missing_cells": int(df.isna().sum().sum()),
    }


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(name).strip().lower()).strip("_")


def find_column(columns: list[str], candidates: list[str]) -> Optional[str]:
    normed = {_norm(c): c for c in columns}
    for cand in candidates:
        if cand in normed:
            return normed[cand]
    return None


# ---------------------------------------------------------------------------
# Category-specific validation & cleaning
# ---------------------------------------------------------------------------
def validate_experimental(df: pd.DataFrame, label_source: Optional[str], is_synthetic: bool) -> list[str]:
    w: list[str] = []
    cols = list(df.columns)
    present = [f for f in EXPECTED_FEATURES if find_column(cols, [f])]
    missing = [f for f in EXPECTED_FEATURES if f not in present]
    if missing:
        w.append(f"Expected feature columns not found: {', '.join(missing)}. You can still select other numeric columns as features.")
    tcol = find_column(cols, [EXPECTED_TARGET, "label", "risk_state", "esp32_risk_state", "class"])
    if not tcol:
        w.append("No target column found (expected 'risk_label'). Select a target column manually before training.")
    else:
        vals = set(df[tcol].dropna().astype(str).str.strip().str.upper().unique())
        unknown = vals - set(LEVELS)
        if unknown:
            w.append(f"Target '{tcol}' contains values outside SAFE/WATCH/WARNING/CRITICAL: {sorted(unknown)[:8]}")
        counts = df[tcol].dropna().astype(str).str.strip().str.upper().value_counts()
        if len(counts) >= 2 and counts.min() / counts.max() < 0.1:
            w.append("Severe class imbalance (smallest class < 10% of largest). Use macro-F1 and per-class recall, consider class weighting.")
        if len(counts) == 1:
            w.append("Target has a single class; a classifier cannot be trained.")
        if tcol and _norm(tcol) in ("esp32_risk_state", "risk_state"):
            w.append("Target appears to be the ESP32 rule-engine state; the model will learn to imitate those rules.")
    gcol = find_column(cols, GROUP_CANDIDATES)
    if not gcol:
        w.append("No experiment/run/group ID column. Group-aware splitting is unavailable; random splits may leak correlated consecutive readings.")
    if not find_column(cols, TIME_CANDIDATES):
        w.append("No timestamp column; chronological splitting will fall back to file row order.")
    if find_column(cols, ["event_date", "landslide_trigger", "landslide_category"]):
        w.append("This file looks like a historical event catalogue. Historical events are NOT sensor training rows.")
    if label_source == "esp32_rule_engine":
        w.append("Labels come from the ESP32 rule engine: the model may simply learn the same rules rather than independent slope behaviour.")
    if label_source in (None, "unknown"):
        w.append("Label source not documented. Record how labels were assigned before reporting results.")
    if is_synthetic:
        w.append("SYNTHETIC dataset — for pipeline testing only. Never report its metrics as project findings.")
    if len(df) < 50:
        w.append(f"Only {len(df)} rows; evaluation metrics will be highly unstable.")
    return w


HIST_ROLES: dict[str, list[str]] = {
    "id": ["event_id", "id", "objectid", "event_import_id"],
    "date": ["event_date", "date", "event_datetime", "datetime", "occurrence_date"],
    "title": ["event_title", "title", "event_name", "name"],
    "trigger": ["landslide_trigger", "trigger", "cause", "landslide_cause"],
    "category": ["landslide_category", "category", "landslide_type", "type"],
    "size": ["landslide_size", "size"],
    "setting": ["landslide_setting", "setting"],
    "country": ["country_name", "country", "nation"],
    "admin": ["admin_division_name", "admin_division", "state", "province", "region"],
    "latitude": ["latitude", "lat"],
    "longitude": ["longitude", "lon", "lng", "long"],
    "fatalities": ["fatality_count", "fatalities", "deaths", "death_count", "killed"],
    "injuries": ["injury_count", "injuries", "injured"],
    "storm": ["storm_name", "storm"],
    "location_accuracy": ["location_accuracy"],
    "source": ["source_name", "source"],
}


def detect_historical_mapping(columns: list[str]) -> dict[str, Optional[str]]:
    return {role: find_column(columns, cands) for role, cands in HIST_ROLES.items()}


def validate_historical(df: pd.DataFrame, mapping: dict[str, Optional[str]]) -> list[str]:
    w = []
    if not mapping.get("date"):
        w.append("No event date column detected: year/month trends unavailable (set the mapping manually if one exists).")
    if not (mapping.get("latitude") and mapping.get("longitude")):
        w.append("No latitude/longitude columns detected: the map is unavailable.")
    if not mapping.get("trigger"):
        w.append("No trigger column detected: trigger analysis unavailable.")
    if find_column(list(df.columns), EXPECTED_FEATURES[:3]):
        w.append("This file contains sensor-like columns; check it is not an experimental dataset.")
    w.append("Records are events reported to this catalogue, not all landslides that occurred; coverage is uneven by region and period.")
    return w


GLC_DATE_FORMAT = "%m/%d/%Y %I:%M:%S %p"


def parse_dates(s: pd.Series) -> pd.Series:
    s = s.astype("string").str.strip()
    out = pd.to_datetime(s, errors="coerce", format=GLC_DATE_FORMAT)
    if out.notna().sum() < 0.5 * s.notna().sum():
        out = pd.to_datetime(s, errors="coerce", format="mixed")
    return out


def clean_dataframe(df: pd.DataFrame, category: str, mapping: Optional[dict] = None) -> tuple[pd.DataFrame, dict[str, Any]]:
    report: dict[str, Any] = {"rows_before": int(len(df)), "steps": []}
    df = df.copy()
    # Column names
    new_cols, seen = [], {}
    for c in df.columns:
        base = str(c).strip() or "unnamed"
        if base in seen:
            seen[base] += 1
            base = f"{base}_{seen[base]}"
        else:
            seen[base] = 0
        new_cols.append(base)
    if new_cols != [str(c) for c in df.columns]:
        report["steps"].append("Trimmed / de-duplicated column names.")
    df.columns = new_cols
    # Strings
    for c in df.columns:
        if df[c].dtype == object:
            df[c] = df[c].astype("string").str.strip().replace("", pd.NA)
    empty_cols = [c for c in df.columns if df[c].isna().all()]
    if empty_cols:
        df = df.drop(columns=empty_cols)
        report["steps"].append(f"Dropped {len(empty_cols)} completely empty column(s): {empty_cols[:10]}")
    n0 = len(df)
    df = df.dropna(how="all")
    if len(df) < n0:
        report["steps"].append(f"Dropped {n0 - len(df)} completely empty row(s).")
    n0 = len(df)
    df = df.drop_duplicates()
    report["duplicates_removed"] = int(n0 - len(df))
    if n0 - len(df):
        report["steps"].append(f"Removed {n0 - len(df)} exact duplicate row(s).")

    if category == "historical":
        m = mapping or detect_historical_mapping(list(df.columns))
        if m.get("date"):
            parsed = parse_dates(df[m["date"]])
            bad = int(df[m["date"]].notna().sum() - parsed.notna().sum())
            df["clean_event_date"] = parsed.dt.strftime("%Y-%m-%d")
            df["clean_year"] = parsed.dt.year.astype("Int64")
            df["clean_month"] = parsed.dt.month.astype("Int64")
            report["unparseable_dates"] = bad
            report["steps"].append(f"Parsed '{m['date']}' into clean_event_date/clean_year/clean_month ({bad} unparseable).")
        if m.get("latitude") and m.get("longitude"):
            lat = pd.to_numeric(df[m["latitude"]], errors="coerce")
            lon = pd.to_numeric(df[m["longitude"]], errors="coerce")
            ok = lat.between(-90, 90) & lon.between(-180, 180) & ~((lat == 0) & (lon == 0))
            df["clean_latitude"] = lat.where(ok)
            df["clean_longitude"] = lon.where(ok)
            report["invalid_coordinates"] = int((~ok).sum())
            report["steps"].append(f"Validated coordinates into clean_latitude/clean_longitude ({int((~ok).sum())} invalid or missing).")
        for role in ("trigger", "category", "size", "setting"):
            col = m.get(role)
            if col:
                df[f"clean_{role}"] = df[col].astype("string").str.strip().str.lower().str.replace(r"\s+", "_", regex=True)
        if any(m.get(r) for r in ("trigger", "category", "size", "setting")):
            report["steps"].append("Normalised category text (lower-case, underscores) into clean_* columns.")
        if m.get("id"):
            report["duplicate_ids"] = int(df[m["id"]].dropna().duplicated().sum())
        report["note"] = "Original columns are preserved; derived columns are prefixed with 'clean_'."
    else:
        coerced = {}
        for f in EXPECTED_FEATURES:
            col = find_column(list(df.columns), [f])
            if col:
                before = df[col].notna().sum()
                df[col] = pd.to_numeric(df[col], errors="coerce")
                lost = int(before - df[col].notna().sum())
                if lost:
                    coerced[col] = lost
        if coerced:
            report["steps"].append(f"Non-numeric feature values set to missing: {coerced}")
        report["non_numeric_feature_values"] = coerced
        tcol = find_column(list(df.columns), [EXPECTED_TARGET])
        if tcol:
            df[tcol] = df[tcol].astype("string").str.strip().str.upper()
            report["steps"].append(f"Normalised '{tcol}' to upper case.")
    report["rows_after"] = int(len(df))
    return df, report


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------
def _dirs() -> tuple[Path, Path]:
    orig = settings.upload_dir / "original"
    clean = settings.upload_dir / "cleaned"
    orig.mkdir(parents=True, exist_ok=True)
    clean.mkdir(parents=True, exist_ok=True)
    return orig, clean


def register_dataset(
    db: Session,
    tmp_path: Path,
    original_filename: str,
    name: str,
    category: str,
    description: str = "",
    label_source: Optional[str] = None,
    is_synthetic: bool = False,
    confirm_new_version: bool = False,
    source: str = "upload",
) -> Dataset:
    if category not in CATEGORIES:
        raise DatasetError(f"category must be one of {CATEGORIES}")
    if label_source is not None and label_source not in LABEL_SOURCES:
        raise DatasetError(f"label_source must be one of {LABEL_SOURCES}")
    name = (name or Path(original_filename).stem).strip()[:120]
    if not re.match(r"^[\w .()\-]+$", name):
        raise DatasetError("Dataset name may contain letters, digits, spaces, '.', '-', '_' and parentheses only.")

    digest = sha256_file(tmp_path)
    dup = db.query(Dataset).filter(Dataset.sha256 == digest).first()
    if dup:
        raise DatasetError(
            f"Identical file content already uploaded as '{dup.name}' v{dup.version} (id {dup.id}).",
            status=409, extra={"conflict": "duplicate_content", "existing_id": dup.id},
        )
    existing = db.query(Dataset).filter(Dataset.name == name).order_by(Dataset.version.desc()).first()
    if existing and not confirm_new_version:
        raise DatasetError(
            f"A dataset named '{name}' already exists (v{existing.version}). Confirm to store this file as v{existing.version + 1}; the existing version is kept.",
            status=409, extra={"conflict": "name_exists", "existing_id": existing.id, "next_version": existing.version + 1},
        )
    version = existing.version + 1 if existing else 1

    df, encoding, read_warnings = read_csv_safely(tmp_path)
    if df.shape[1] == 0 or len(df) == 0:
        raise DatasetError("CSV has no data rows or no columns.")
    if len(df) > settings.max_dataset_rows:
        raise DatasetError(f"CSV has {len(df)} rows; the limit is {settings.max_dataset_rows}.")

    mapping = detect_historical_mapping(list(df.columns)) if category == "historical" else None
    prof = profile(df)
    warnings = list(read_warnings)
    warnings += validate_historical(df, mapping) if category == "historical" else validate_experimental(df, label_source, is_synthetic)
    prof["warnings"] = warnings
    if category == "historical":
        prof["detected_mapping"] = mapping

    cleaned, report = clean_dataframe(df, category, mapping)
    orig_dir, clean_dir = _dirs()
    uid = uuid.uuid4().hex
    stored = orig_dir / f"{uid}.csv"
    shutil.copyfile(tmp_path, stored)
    cleaned_path = clean_dir / f"{uid}.csv"
    cleaned.to_csv(cleaned_path, index=False, quoting=csv.QUOTE_MINIMAL)

    ds = Dataset(
        name=name, version=version, category=category, description=description[:2000],
        original_filename=Path(original_filename).name[:255], stored_path=str(stored), cleaned_path=str(cleaned_path),
        file_size_bytes=stored.stat().st_size, sha256=digest, encoding=encoding.replace("-sig", ""),
        n_rows=prof["n_rows"], n_columns=prof["n_columns"], profile_json=dumps(prof),
        cleaning_report_json=dumps(report), column_mapping_json=dumps(mapping) if mapping else None,
        label_source=label_source if category == "experimental" else None,
        is_synthetic=is_synthetic, source=source,
    )
    db.add(ds)
    db.flush()
    log_event(db, "dataset", "DATASET_UPLOADED",
              f"{category.title()} dataset '{name}' v{version} registered ({prof['n_rows']} rows × {prof['n_columns']} cols)"
              + (" [SYNTHETIC]" if is_synthetic else ""),
              details={"dataset_id": ds.id, "sha256": digest, "source": source})
    return ds


def dataset_to_dict(ds: Dataset, detail: bool = False) -> dict[str, Any]:
    prof = loads(ds.profile_json, {})
    d = {
        "id": ds.id, "name": ds.name, "version": ds.version, "category": ds.category,
        "description": ds.description, "original_filename": ds.original_filename,
        "uploaded_at": iso(ds.uploaded_at), "n_rows": ds.n_rows, "n_columns": ds.n_columns,
        "file_size_bytes": ds.file_size_bytes, "sha256": ds.sha256, "encoding": ds.encoding,
        "label_source": ds.label_source, "is_synthetic": ds.is_synthetic, "source": ds.source,
        "duplicate_rows": prof.get("duplicate_rows"), "warning_count": len(prof.get("warnings", [])),
        "column_names": [c["name"] for c in prof.get("columns", [])],
    }
    if detail:
        d["profile"] = prof
        d["cleaning_report"] = loads(ds.cleaning_report_json, {})
        d["column_mapping"] = loads(ds.column_mapping_json, None)
        rep = d["cleaning_report"]
        d["cleaned_rows"] = rep.get("rows_after")
    return d


def load_df(ds: Dataset, cleaned: bool = True) -> pd.DataFrame:
    path = Path(ds.cleaned_path if cleaned and ds.cleaned_path else ds.stored_path)
    _guard_path(path)
    if cleaned and ds.cleaned_path:
        return pd.read_csv(path, low_memory=False)
    df, _, _ = read_csv_safely(path)
    return df


def _guard_path(path: Path) -> None:
    root = settings.upload_dir.resolve()
    if root not in path.resolve().parents:
        raise DatasetError("Dataset path outside upload directory.", status=500)


def delete_dataset(db: Session, ds: Dataset) -> None:
    for p in (ds.stored_path, ds.cleaned_path):
        if p:
            path = Path(p)
            try:
                _guard_path(path)
                path.unlink(missing_ok=True)
            except DatasetError:
                log.warning("refusing to delete file outside upload dir: %s", p)
    log_event(db, "dataset", "DATASET_DELETED", f"Dataset '{ds.name}' v{ds.version} (id {ds.id}) deleted.",
              severity="warning", details={"dataset_id": ds.id, "sha256": ds.sha256})
    db.delete(ds)


def preview(ds: Dataset, offset: int, limit: int, cleaned: bool) -> dict[str, Any]:
    df = load_df(ds, cleaned=cleaned)
    page = df.iloc[offset: offset + limit]
    page = page.astype(object).where(pd.notna(page), None)
    return {
        "columns": [str(c) for c in df.columns],
        "rows": [[_cell(v) for v in row] for row in page.itertuples(index=False, name=None)],
        "offset": offset, "limit": limit, "total": int(len(df)), "variant": "cleaned" if cleaned else "original",
    }


def _cell(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, (np.floating, float)):
        return clean_float(v, 6)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    s = str(v)
    return s if len(s) <= 300 else s[:300] + "…"


# ---------------------------------------------------------------------------
# Experimental dataset builders
# ---------------------------------------------------------------------------
def tmp_file(suffix: str = ".csv") -> Path:
    d = settings.upload_dir / "tmp"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{uuid.uuid4().hex}{suffix}"


def build_synthetic_fixture(db: Session, n_runs: int = 14, seed: int = 7) -> Dataset:
    """Clearly-labelled SYNTHETIC fixture for exercising the training pipeline only.

    Rows are generated by the firmware-replica engine; labels are its rule-based state
    plus a little label noise. A model trained on it learns those rules — by construction.
    """
    from .simulator import SCENARIOS

    rnd = random.Random(seed)
    keys = ["normal", "heavy_rain", "rapid_saturation", "increasing_tilt", "combined", "recovery"]
    rows = []
    t0 = utcnow().replace(microsecond=0) - timedelta(days=3)
    for run in range(n_runs):
        scen = SCENARIOS[keys[run % len(keys)]]
        eng = FirmwareEngine()
        srnd = random.Random(seed * 100 + run)
        start = t0 + timedelta(hours=run * 2)
        for k in range(150):
            m, r, t = scen.fn(k, srnd)
            m = None if m is None else m * rnd.uniform(0.9, 1.1)
            t = None if t is None else t * rnd.uniform(0.85, 1.15)
            eng.step(m, r, t, 2.0)
            if k % 2:
                continue
            p = eng.payload("synthetic", k * 2, -60)
            label = LEVELS[eng.final_level]
            if rnd.random() < 0.03:  # label noise so the fixture is not trivially separable
                label = LEVELS[max(0, min(3, eng.final_level + rnd.choice([-1, 1])))]
            rows.append({
                "experiment_id": f"SYN-RUN-{run + 1:02d}",
                "timestamp": (start + timedelta(seconds=k * 2)).isoformat() + "Z",
                **{f: p[f] for f in EXPECTED_FEATURES},
                "risk_label": label,
                "is_synthetic": True,
            })
    df = pd.DataFrame(rows)
    path = tmp_file()
    df.to_csv(path, index=False)
    try:
        existing = db.query(Dataset).filter(Dataset.name == "SYNTHETIC_TEST_FIXTURE").first()
        return register_dataset(
            db, path, "synthetic_test_fixture.csv", "SYNTHETIC_TEST_FIXTURE", "experimental",
            description=("SYNTHETIC pipeline-test fixture generated by a software replica of the firmware rules. "
                         "Not measured data. Metrics from models trained on it are NOT project findings."),
            label_source="synthetic_rule_engine", is_synthetic=True,
            confirm_new_version=existing is not None, source="synthetic_fixture",
        )
    finally:
        path.unlink(missing_ok=True)


def build_from_readings(
    db: Session,
    name: str,
    device_id: Optional[str],
    experiment_ids: Optional[list[str]],
    include_simulated: bool,
    confirm_new_version: bool,
) -> Dataset:
    q = db.query(SensorReading).filter(SensorReading.esp32_risk_state.in_(LEVELS), SensorReading.is_valid.is_(True))
    if device_id:
        q = q.filter(SensorReading.device_id == device_id)
    if experiment_ids:
        q = q.filter(SensorReading.experiment_id.in_(experiment_ids))
    if not include_simulated:
        q = q.filter(SensorReading.is_simulated.is_(False))
    rows = q.order_by(SensorReading.received_at).all()
    if len(rows) < 10:
        raise DatasetError(f"Only {len(rows)} eligible readings (valid, risk state SAFE..CRITICAL). Record more data first.")
    any_sim = any(r.is_simulated for r in rows)
    df = pd.DataFrame([{
        "experiment_id": r.experiment_id or "UNASSIGNED",
        "timestamp": iso(r.received_at),
        "device_id": r.device_id,
        **{f: getattr(r, f) for f in EXPECTED_FEATURES},
        "weighted_score": r.weighted_score,
        "risk_label": r.esp32_risk_state,
        "is_simulated": r.is_simulated,
    } for r in rows])
    path = tmp_file()
    df.to_csv(path, index=False)
    try:
        return register_dataset(
            db, path, f"{name}.csv", name, "experimental",
            description=(f"Built from {len(rows)} recorded readings"
                         f"{' of ' + device_id if device_id else ''}. Labels = ESP32 rule-engine state."
                         + (" Contains SIMULATED readings." if any_sim else "")),
            label_source="esp32_rule_engine", is_synthetic=any_sim,
            confirm_new_version=confirm_new_version, source="recorded_readings",
        )
    finally:
        path.unlink(missing_ok=True)
