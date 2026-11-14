// Copy this file to secrets.h (same folder) and fill in your own values.
// secrets.h is listed in .gitignore and must never be committed or shared.
#pragma once

#define SECRET_WIFI_SSID         "YOUR_WIFI_SSID"
#define SECRET_WIFI_PASSWORD     "YOUR_WIFI_PASSWORD"
// The laptop's LAN IPv4 address (run `ipconfig` on Windows). "localhost" will NOT work from the ESP32.
#define SECRET_BACKEND_ENDPOINT  "http://YOUR_COMPUTER_LAN_IP:8000/api/reading"
