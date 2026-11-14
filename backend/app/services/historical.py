"""Historical landslide intelligence (event-level analysis).

Works from the column mapping detected at upload (overridable by the user), so it
adapts to the actual CSV schema. Statistics are only produced for columns that exist.
These are RECORDED EVENTS in a catalogue — not continuous sensor data — and are
never used as sensor-model training rows.
"""
from __future__ import annotations

import threading
from collections import OrderedDict
from pathlib import Path
from typing import Any, Optional

import pandas as pd

from ..models import Dataset
from ..utils import clean_float, dumps, loads
from .datasets import HIST_ROLES, detect_historical_mapping, load_df, parse_dates

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
SIZE_ORDER = ["tiny", "small", "medium", "large", "very_large", "catastrophic", "unknown"]
# Trigger values treated as rainfall-related. Documented so the grouping is transparent.
RAIN_KEYWORDS = ["rain", "downpour", "monsoon", "tropical_cyclone", "cyclone", "typhoon", "hurricane",
                 "continuous_rain", "flooding", "flood", "storm"]
MISSING = "(not recorded)"

_cache: "OrderedDict[tuple, pd.DataFrame]" = OrderedDict()
_lock = threading.Lock()


def get_mapping(ds: Dataset) -> dict[str, Optional[str]]:
    m = loads(ds.column_mapping_json, None)
    if not m:
        m = detect_historical_mapping(ds_columns(ds))
    return {role: m.get(role) for role in HIST_ROLES}


def ds_columns(ds: Dataset) -> list[str]:
    prof = loads(ds.profile_json, {})
    return [c["name"] for c in prof.get("columns", [])]


def set_mapping(ds: Dataset, mapping: dict[str, Optional[str]]) -> dict[str, Optional[str]]:
    cols = set(load_df(ds, cleaned=True).columns)
    clean = {}
    for role in HIST_ROLES:
        v = mapping.get(role)
        if v in (None, ""):
            clean[role] = None
        elif v not in cols:
            raise ValueError(f"Column '{v}' (role {role}) does not exist in this dataset.")
        else:
            clean[role] = v
    ds.column_mapping_json = dumps(clean)
    return clean


def _norm_text(s: pd.Series) -> pd.Series:
    out = s.astype("string").str.strip().str.lower().str.replace(r"\s+", "_", regex=True)
    return out.fillna(MISSING).replace("", MISSING)


def frame(ds: Dataset) -> pd.DataFrame:
    """Cleaned dataframe plus derived `_` columns, cached per dataset+mapping."""
    mapping = get_mapping(ds)
    path = Path(ds.cleaned_path or ds.stored_path)
    key = (ds.id, path.stat().st_mtime if path.exists() else 0, dumps(mapping))
    with _lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    df = load_df(ds, cleaned=True)
    d = pd.DataFrame(index=df.index)
    if mapping["date"]:
        dt = parse_dates(df[mapping["date"]])
        d["_date"] = dt
        d["_year"] = dt.dt.year.astype("Int64")
        d["_month"] = dt.dt.month.astype("Int64")
    for role in ("trigger", "category", "size", "setting", "country", "admin", "location_accuracy"):
        if mapping[role]:
            d[f"_{role}"] = _norm_text(df[mapping[role]]) if role not in ("country", "admin") else \
                df[mapping[role]].astype("string").str.strip().fillna(MISSING)
    if mapping["latitude"] and mapping["longitude"]:
        lat = pd.to_numeric(df[mapping["latitude"]], errors="coerce")
        lon = pd.to_numeric(df[mapping["longitude"]], errors="coerce")
        ok = lat.between(-90, 90) & lon.between(-180, 180) & ~((lat == 0) & (lon == 0))
        d["_lat"], d["_lon"] = lat.where(ok), lon.where(ok)
    for role in ("fatalities", "injuries"):
        if mapping[role]:
            d[f"_{role}"] = pd.to_numeric(df[mapping[role]], errors="coerce")
    if mapping["title"]:
        d["_title"] = df[mapping["title"]].astype("string")
    if mapping["id"]:
        d["_id"] = df[mapping["id"]].astype("string")
    if "_trigger" in d:
        d["_rain"] = d["_trigger"].apply(lambda v: any(k in str(v) for k in RAIN_KEYWORDS) if v != MISSING else False)
    with _lock:
        _cache[key] = d
        while len(_cache) > 6:
            _cache.popitem(last=False)
    return d


def _split(v: Optional[str]) -> list[str]:
    return [x.strip() for x in v.split(",") if x.strip()] if v else []


def apply_filters(d: pd.DataFrame, f: dict[str, Any]) -> pd.DataFrame:
    mask = pd.Series(True, index=d.index)
    if "_year" in d:
        if f.get("year_from") is not None:
            mask &= d["_year"].fillna(-1) >= int(f["year_from"])
        if f.get("year_to") is not None:
            mask &= d["_year"].fillna(10**6) <= int(f["year_to"])
    for role in ("country", "trigger", "category", "size", "setting"):
        vals = _split(f.get(role))
        if vals and f"_{role}" in d:
            mask &= d[f"_{role}"].isin(vals)
    if f.get("fatal_only") and "_fatalities" in d:
        mask &= d["_fatalities"].fillna(0) > 0
    if f.get("rain_only") and "_rain" in d:
        mask &= d["_rain"]
    return d[mask]


def _counts(s: pd.Series, top: int = 15, order: Optional[list[str]] = None) -> list[dict[str, Any]]:
    vc = s.value_counts()
    total = int(vc.sum()) or 1
    items = [{"name": str(k), "count": int(v), "pct": round(100 * v / total, 2)} for k, v in vc.items()]
    if order:
        rank = {k: i for i, k in enumerate(order)}
        items.sort(key=lambda x: rank.get(x["name"], len(order) - 1 if x["name"] == MISSING else len(order)))
        return items
    if len(items) > top:
        rest = sum(x["count"] for x in items[top:])
        items = items[:top] + [{"name": "(other)", "count": rest, "pct": round(100 * rest / total, 2)}]
    return items


def analytics(ds: Dataset, filters: dict[str, Any]) -> dict[str, Any]:
    full = frame(ds)
    d = apply_filters(full, filters)
    mapping = get_mapping(ds)
    n = int(len(d))
    out: dict[str, Any] = {
        "dataset": {"id": ds.id, "name": ds.name, "version": ds.version, "rows_total": int(len(full))},
        "mapping": mapping,
        "filters": filters,
        "available": {k: bool(mapping[k]) for k in mapping},
        "totals": {"events": n},
    }
    t = out["totals"]
    if "_date" in d:
        valid = d["_date"].dropna()
        t["events_with_valid_date"] = int(len(valid))
        t["date_min"] = valid.min().strftime("%Y-%m-%d") if len(valid) else None
        t["date_max"] = valid.max().strftime("%Y-%m-%d") if len(valid) else None
        yr = d.dropna(subset=["_year"]).groupby("_year").size()
        fy = d.dropna(subset=["_year"]).groupby("_year")["_fatalities"].sum() if "_fatalities" in d else None
        # Continuous year axis: years with no recorded events are shown as 0, not skipped.
        years = range(int(yr.index.min()), int(yr.index.max()) + 1) if len(yr) else []
        out["by_year"] = [
            {"year": y, "count": int(yr.get(y, 0)),
             "fatalities": int(fy.get(y, 0)) if fy is not None else None}
            for y in years
        ]
        mo = d.dropna(subset=["_month"]).groupby("_month").size()
        out["by_month"] = [{"month": m, "label": MONTHS[m - 1], "count": int(mo.get(m, 0))} for m in range(1, 13)]
    if "_lat" in d:
        t["events_with_valid_coordinates"] = int(d["_lat"].notna().sum())
    if "_country" in d:
        t["countries"] = int(d.loc[d["_country"] != MISSING, "_country"].nunique())
        grp = d.groupby("_country")
        cc = grp.size().sort_values(ascending=False).head(20)
        out["countries"] = [
            {"name": str(k), "count": int(v),
             "fatalities": int(grp.get_group(k)["_fatalities"].fillna(0).sum()) if "_fatalities" in d else None}
            for k, v in cc.items()
        ]
    if "_admin" in d:
        out["admin_divisions"] = _counts(d["_admin"], top=15)
    for role, order in (("trigger", None), ("category", None), ("size", SIZE_ORDER), ("setting", None)):
        if f"_{role}" in d:
            out[f"{role}s" if role != "category" else "categories"] = _counts(d[f"_{role}"], 15, order)
    if "_fatalities" in d:
        fat = d["_fatalities"]
        t["total_fatalities"] = int(fat.fillna(0).sum())
        t["events_with_fatalities"] = int((fat > 0).sum())
        t["fatality_values_missing"] = int(fat.isna().sum())
        top = d[fat > 0].sort_values("_fatalities", ascending=False).head(10)
        out["deadliest_events"] = [{
            "title": str(r.get("_title", "")) if pd.notna(r.get("_title", None)) else "",
            "date": r["_date"].strftime("%Y-%m-%d") if "_date" in d and pd.notna(r.get("_date")) else None,
            "country": str(r.get("_country", "")) if "_country" in d else None,
            "trigger": str(r.get("_trigger", "")) if "_trigger" in d else None,
            "fatalities": int(r["_fatalities"]),
        } for _, r in top.iterrows()]
        if "_trigger" in d:
            ft = d.groupby("_trigger")["_fatalities"].sum().sort_values(ascending=False).head(10)
            out["fatalities_by_trigger"] = [{"name": str(k), "fatalities": int(v)} for k, v in ft.items() if v > 0]
    if "_injuries" in d:
        inj = d["_injuries"]
        t["total_injuries"] = int(inj.fillna(0).sum())
        t["events_with_injuries"] = int((inj > 0).sum())
        t["injury_values_missing"] = int(inj.isna().sum())
    if "_rain" in d:
        known = d[d["_trigger"] != MISSING]
        rain = d[d["_rain"]]
        out["rain_related"] = {
            "keywords": RAIN_KEYWORDS,
            "count": int(len(rain)),
            "pct_of_events_with_known_trigger": round(100 * len(rain) / max(len(known), 1), 2),
            "triggers": _counts(rain["_trigger"], 10),
            "by_month": ([{"month": m, "label": MONTHS[m - 1],
                           "count": int((rain["_month"] == m).sum())} for m in range(1, 13)] if "_month" in rain else []),
            "fatalities": int(rain["_fatalities"].fillna(0).sum()) if "_fatalities" in rain else None,
            "note": "Rain-related = trigger text contains one of the listed keywords. Grouping is a transparent heuristic.",
        }
    out["data_quality"] = data_quality(ds, full, mapping)
    out["caveats"] = [
        "These are events recorded in this catalogue, not all landslides that occurred. Reporting is uneven across countries, languages and years.",
        "Historical event records do not contain soil-moisture, rain-module or MPU6050 tilt measurements and are not used to train the sensor model.",
        "Historical analysis provides context; it does not validate the miniature-slope prototype or its thresholds.",
    ]
    return out


def data_quality(ds: Dataset, full: pd.DataFrame, mapping: dict[str, Optional[str]]) -> dict[str, Any]:
    prof = loads(ds.profile_json, {})
    rep = loads(ds.cleaning_report_json, {})
    cols = {c["name"]: c for c in prof.get("columns", [])}
    return {
        "rows_original": prof.get("n_rows"),
        "rows_after_cleaning": rep.get("rows_after"),
        "duplicate_rows_removed": rep.get("duplicates_removed"),
        "duplicate_ids": rep.get("duplicate_ids"),
        "unparseable_dates": int(full["_date"].isna().sum()) if "_date" in full else None,
        "invalid_or_missing_coordinates": int(full["_lat"].isna().sum()) if "_lat" in full else None,
        "mapped_column_missing": {
            role: {"column": col, "missing": cols.get(col, {}).get("missing"), "missing_pct": cols.get(col, {}).get("missing_pct")}
            for role, col in mapping.items() if col
        },
    }


def filter_options(ds: Dataset) -> dict[str, Any]:
    d = frame(ds)
    out: dict[str, Any] = {}
    if "_year" in d and d["_year"].notna().any():
        out["year_min"] = int(d["_year"].min())
        out["year_max"] = int(d["_year"].max())
    for role in ("country", "trigger", "category", "size", "setting"):
        if f"_{role}" in d:
            vc = d[f"_{role}"].value_counts()
            out[role] = [{"value": str(k), "count": int(v)} for k, v in vc.head(300).items()]
    out["columns"] = ds_columns(ds)
    out["mapping"] = get_mapping(ds)
    out["roles"] = list(HIST_ROLES)
    return out


def map_points(ds: Dataset, filters: dict[str, Any], limit: int) -> dict[str, Any]:
    d = apply_filters(frame(ds), filters)
    if "_lat" not in d:
        return {"available": False, "points": [], "total_with_coordinates": 0}
    pts = d.dropna(subset=["_lat", "_lon"])
    total = int(len(pts))
    sampled = total > limit
    if sampled:
        pts = pts.sample(n=limit, random_state=0)
    out = []
    for idx, r in pts.iterrows():
        out.append({
            "lat": round(float(r["_lat"]), 5), "lon": round(float(r["_lon"]), 5),
            "title": str(r["_title"])[:140] if "_title" in pts and pd.notna(r["_title"]) else None,
            "date": r["_date"].strftime("%Y-%m-%d") if "_date" in pts and pd.notna(r["_date"]) else None,
            "trigger": r["_trigger"] if "_trigger" in pts else None,
            "size": r["_size"] if "_size" in pts else None,
            "country": r["_country"] if "_country" in pts else None,
            "fatalities": clean_float(r["_fatalities"], 0) if "_fatalities" in pts else None,
        })
    return {"available": True, "points": out, "total_with_coordinates": total, "sampled": sampled, "limit": limit}
