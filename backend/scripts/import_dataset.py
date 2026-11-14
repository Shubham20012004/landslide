#!/usr/bin/env python3
"""Register a CSV dataset from the command line (same validation as the web upload).

  python scripts/import_dataset.py ../data/historical/Global_Landslide_Catalog_Export_rows.csv --category historical --name "NASA Global Landslide Catalog"
  python scripts/import_dataset.py my_runs.csv --category experimental --label-source manual_observation
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.database import init_db, session_scope  # noqa: E402
from app.services.datasets import LABEL_SOURCES, DatasetError, register_dataset, tmp_file  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", type=Path)
    ap.add_argument("--category", required=True, choices=["historical", "experimental"])
    ap.add_argument("--name")
    ap.add_argument("--description", default="")
    ap.add_argument("--label-source", choices=LABEL_SOURCES)
    ap.add_argument("--synthetic", action="store_true")
    ap.add_argument("--new-version", action="store_true", help="store as a new version if the name exists")
    a = ap.parse_args()
    if not a.csv.exists():
        print(f"File not found: {a.csv}")
        return 1
    init_db()
    tmp = tmp_file()
    shutil.copyfile(a.csv, tmp)
    try:
        with session_scope() as db:
            ds = register_dataset(db, tmp, a.csv.name, a.name or a.csv.stem, a.category, a.description,
                                  a.label_source, a.synthetic, a.new_version)
            print(f"Registered '{ds.name}' v{ds.version} (id {ds.id}): {ds.n_rows} rows x {ds.n_columns} columns")
    except DatasetError as e:
        print(f"Not imported: {e}")
        return 2
    finally:
        tmp.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
