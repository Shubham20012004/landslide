# Data folders

| Folder | Category | Used for |
|---|---|---|
| `historical/` | A — event-level landslide catalogues | Historical Intelligence page only |
| `experimental/` | B — prototype sensor measurements with labels | Random Forest training |

* `historical/Global_Landslide_Catalog_Export_rows.csv` — the NASA Global Landslide Catalog export supplied
  with the project (11,033 events × 31 columns). Load it with
  `python scripts/import_dataset.py ../data/historical/Global_Landslide_Catalog_Export_rows.csv --category historical`
  (from `backend/`) or upload it on the Dataset Management page.
* `experimental/experimental_sensor_dataset_template.csv` — header-only template. **No real labelled experimental
  dataset exists yet.** Record one from the physical slope (Live Monitoring → Experiment session, then
  Dataset Management → *Build from recorded readings*) or label your own bench runs.

Historical events are not sensor training rows: they contain no soil-moisture, rain-module or MPU6050 values.
