#pragma once

// ---------- WLAN / MQTT-Server ----------
// Zugangsdaten stehen in secrets.h (nicht einchecken):
//   WIFI_SSID, WIFI_PASS, MQTT_SERVER, MQTT_PORT
#include "secrets.h"
#define MQTT_HOST MQTT_SERVER

// ---------- MQTT ----------
#define MQTT_USER ""            // leer lassen, wenn der Broker keine Anmeldung braucht
#define MQTT_PASS ""
#define MQTT_BASE "oeg_kmsd"    // Topics: oeg_kmsd/state, oeg_kmsd/status
#define HA_DISCOVERY_PREFIX "homeassistant"

// ---------- OTA (Update ueber WLAN) ----------
// Passwort kommt aus secrets.ini (Build-Flag OTA_PASS)
#define OTA_HOSTNAME "oeg-kmsd"

// ---------- Regler (Modbus ASCII ueber USB-CDC) ----------
// Werte aus github.com/ced2git/oeg_kmsd bzw. Yannicflight/oeg_kmsd
#define MODBUS_SLAVE      128   // 0x80
#define MODBUS_TIMEOUT_MS 500
#define CDC_BAUD          9600
#define CDC_DATABITS      7
#define CDC_PARITY        2     // 0 = none, 1 = odd, 2 = even
#define CDC_STOPBITS      0     // 0 = 1 Stoppbit

#define POLL_INTERVAL_MS  10000

// Beim ersten Verbinden die Register 0..SCAN_LAST auf den Serial-Monitor ausgeben
// (hilft, weitere Register zu finden). 0 = aus.
#define SCAN_ON_CONNECT   1
#define SCAN_LAST         99
