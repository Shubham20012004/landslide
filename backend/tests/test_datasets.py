"""Dataset upload validation, versioning, preview, cleaning and historical analytics."""
import io

HIST_CSV = (
    "event_id,event_date,event_title,landslide_category,landslide_trigger,landslide_size,landslide_setting,"
    "fatality_count,injury_count,country_name,admin_division_name,latitude,longitude\n"
    "1,08/01/2008 12:00:00 AM,A,landslide,rain,large,mine,11,,China,Shaanxi,32.5,107.4\n"
    "2,01/02/2009 02:00:00 AM,B,mudslide,downpour,small,unknown,0,,United States,Oregon,45.4,-122.6\n"
    "3,07/15/2010 12:00:00 AM,C,rock_fall,earthquake,medium,natural_slope,3,2,Nepal,Bagmati,27.7,85.3\n"
    "4,07/20/2012 12:00:00 AM,D,landslide,monsoon,medium,urban,,1,India,Kerala,10.1,76.3\n"
    "4,07/20/2012 12:00:00 AM,D,landslide,monsoon,medium,urban,,1,India,Kerala,10.1,76.3\n"
    "5,not a date,E,landslide,unknown,,,0,0,,,999,0\n"
)
EXP_CSV = (
    "experiment_id,timestamp,moisture_index,rain_index,tilt_change_deg,moisture_rate_per_min,tilt_rate_deg_per_min,risk_label\n"
    + "".join(f"RUN-{i % 3},2026-01-01T00:00:{i:02d}Z,{30 + i},{i},{i / 10},0.5,0.01,{'SAFE' if i < 20 else 'WATCH'}\n" for i in range(40))
)


def upload(client, content: bytes | str, category="historical", name="t", filename="t.csv", **extra):
    data = {"category": category, "name": name, **{k: str(v).lower() if isinstance(v, bool) else v for k, v in extra.items()}}
    raw = content.encode() if isinstance(content, str) else content
    return client.post("/api/datasets/upload", files={"file": (filename, io.BytesIO(raw), "text/csv")}, data=data)


def test_upload_profile_and_cleaning(client):
    r = upload(client, HIST_CSV, name="glc-sample")
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["n_rows"] == 6 and d["n_columns"] == 13 and d["profile"]["duplicate_rows"] == 1
    assert d["profile"]["detected_mapping"]["trigger"] == "landslide_trigger"
    assert d["cleaning_report"]["duplicates_removed"] == 1 and d["cleaning_report"]["rows_after"] == 5
    pv = client.get(f"/api/datasets/{d['id']}/preview", params={"variant": "original", "limit": 2}).json()
    assert pv["total"] == 6 and len(pv["rows"]) == 2
    cleaned = client.get(f"/api/datasets/{d['id']}/download", params={"variant": "cleaned"}).text
    assert "clean_year" in cleaned.splitlines()[0]


def test_rejects_bad_files(client):
    assert upload(client, "a,b\n1,2\n", filename="x.txt").status_code == 400
    assert upload(client, b"").status_code == 400
    assert upload(client, b"\x00\x01\x02binary\x00", name="bin").status_code == 400
    assert upload(client, "a,b\n", name="hdr").status_code == 400  # header only
    assert upload(client, "a,b\n1,2\n", category="weird").status_code == 400


def test_size_limit(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "max_upload_mb", 0)
    assert upload(client, "a,b\n1,2\n").status_code == 413


def test_non_utf8_encoding_is_handled(client):
    r = upload(client, "name,value\nS\xe3o Paulo,1\n".encode("latin-1"), name="latin")
    assert r.status_code == 201 and r.json()["encoding"] in ("cp1252", "latin-1")


def test_duplicate_content_and_versioning(client):
    assert upload(client, HIST_CSV, name="glc").status_code == 201
    dup = upload(client, HIST_CSV, name="other")
    assert dup.status_code == 409 and dup.json()["conflict"] == "duplicate_content"
    changed = HIST_CSV + "6,07/01/2015 12:00:00 AM,F,landslide,rain,small,,0,0,Peru,Lima,-12,-77\n"
    same_name = upload(client, changed, name="glc")
    assert same_name.status_code == 409 and same_name.json()["conflict"] == "name_exists"
    v2 = upload(client, changed, name="glc", confirm_new_version=True)
    assert v2.status_code == 201 and v2.json()["version"] == 2
    assert len(client.get("/api/datasets").json()["datasets"]) == 2


def test_delete_requires_confirmation(client):
    ds = upload(client, HIST_CSV).json()
    assert client.delete(f"/api/datasets/{ds['id']}").status_code == 400
    assert client.delete(f"/api/datasets/{ds['id']}", params={"confirm": True}).status_code == 200
    assert client.get(f"/api/datasets/{ds['id']}").status_code == 404


def test_historical_analytics(client):
    ds = upload(client, HIST_CSV).json()
    a = client.get(f"/api/historical/{ds['id']}/analytics").json()
    assert a["totals"]["events"] == 5
    assert a["totals"]["total_fatalities"] == 14 and a["totals"]["fatality_values_missing"] == 1
    assert a["data_quality"]["unparseable_dates"] == 1 and a["data_quality"]["invalid_or_missing_coordinates"] == 1
    years = [y["year"] for y in a["by_year"]]
    assert years == list(range(2008, 2013))  # continuous axis incl. 2011 with 0 events
    assert a["rain_related"]["count"] == 3  # rain, downpour, monsoon
    f = client.get(f"/api/historical/{ds['id']}/analytics", params={"country": "India"}).json()
    assert f["totals"]["events"] == 1
    m = client.get(f"/api/historical/{ds['id']}/map").json()
    assert m["total_with_coordinates"] == 4


def test_historical_mapping_override_and_missing_columns(client):
    csv = "when,place,lat,lon\n2010-05-01,X,10,20\n2011-06-01,Y,11,21\n"
    ds = upload(client, csv, name="custom").json()
    a = client.get(f"/api/historical/{ds['id']}/analytics").json()
    assert a["available"]["date"] is False and "by_year" not in a and "triggers" not in a
    assert client.put(f"/api/historical/{ds['id']}/mapping", json={"date": "when", "country": "place"}).status_code == 200
    a2 = client.get(f"/api/historical/{ds['id']}/analytics").json()
    assert [y["year"] for y in a2["by_year"]] == [2010, 2011]
    assert client.put(f"/api/historical/{ds['id']}/mapping", json={"date": "nope"}).status_code == 400


def test_experimental_validation_and_historical_endpoint_guard(client):
    ds = upload(client, EXP_CSV, category="experimental", name="exp", label_source="manual_observation").json()
    assert ds["category"] == "experimental"
    assert not any("Expected feature columns not found" in w for w in ds["profile"]["warnings"])
    assert client.get(f"/api/historical/{ds['id']}/analytics").status_code == 400


def test_build_dataset_from_readings(client):
    from conftest import reading

    for i in range(12):
        client.post("/api/reading", json=reading(esp32_risk_state="WATCH" if i % 2 else "SAFE", uptime_sec=i * 4))
    r = client.post("/api/datasets/from-readings", json={"name": "recorded"})
    assert r.status_code == 201
    d = r.json()
    assert d["label_source"] == "esp32_rule_engine" and d["n_rows"] == 12 and d["is_synthetic"] is False
    assert any("rule engine" in w for w in d["profile"]["warnings"])
