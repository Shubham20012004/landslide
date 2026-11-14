#!/usr/bin/env python3
"""SIMULATED ESP32 HTTP client — tests POST /api/reading over the network without hardware.

Sends JSON identical in shape to the firmware's payload, produced by the Python port of the
firmware risk engine. Every packet carries `X-Simulated: true`, so the backend flags the
readings as SIMULATED. These are software test values, never measurements or findings.

  python scripts/simulate_esp32.py --scenario heavy_rain --count 60 --interval 4
  python scripts/simulate_esp32.py --url http://192.168.1.20:8000/api/reading
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.services.risk_engine import FirmwareEngine  # noqa: E402
from app.services.simulator import SCENARIOS  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="http://127.0.0.1:8000/api/reading")
    ap.add_argument("--scenario", default="heavy_rain", choices=sorted(SCENARIOS))
    ap.add_argument("--device-id", default="sim-http-node")
    ap.add_argument("--count", type=int, default=30)
    ap.add_argument("--interval", type=float, default=4.0, help="seconds between POSTs (firmware: 4)")
    a = ap.parse_args()

    rnd = random.Random(1)
    eng = FirmwareEngine()
    fn = SCENARIOS[a.scenario].fn
    k = 0
    for i in range(a.count):
        for _ in range(2):  # firmware samples every 2 s, posts every 4 s
            eng.step(*fn(k, rnd), dt_sec=2.0)
            k += 1
        payload = eng.payload(a.device_id, uptime_sec=k * 2, rssi=-58)
        req = urllib.request.Request(a.url, data=json.dumps(payload).encode(),
                                     headers={"Content-Type": "application/json", "X-Simulated": "true"})
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                print(f"[{i:03d}] HTTP {r.status}  state={payload['esp32_risk_state']:<15} score={payload['weighted_score']}")
        except urllib.error.HTTPError as e:
            print(f"[{i:03d}] HTTP {e.code}  {e.read().decode()[:200]}")
        except OSError as e:
            print(f"[{i:03d}] ERROR {e}")
        time.sleep(a.interval)


if __name__ == "__main__":
    main()
