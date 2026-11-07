# OEG KMS-D Heizungsregler → ESP32-S3 (USB-Host) → MQTT / ioBroker

Liest den OEG-Heizungsregler **KMS-D / KMS-D+** (baugleich Seltron) über dessen Mini-USB-Buchse
aus. Der **native USB-Port eines ESP32-S3** arbeitet als USB-Host, der Regler meldet sich als
CDC-ACM-Gerät („SELTRON HEATING CONTROLLER“) und spricht **Modbus ASCII**. Die Werte gehen per
MQTT an ioBroker bzw. Home Assistant. Der Regler wird **nur gelesen**.

```
OEG KMS-D ──Mini-USB── [USB] ESP32-S3-DevKit [UART] ── PC (Flashen/Log, optional)
                                   │
                                  WLAN ── MQTT-Broker (ioBroker mqtt.0) ── InfluxDB / vis
```

## Inhalt

| Ordner | Inhalt |
|---|---|
| `firmware/` | PlatformIO-Projekt (Arduino, ESP32-S3): USB-Host-CDC-Treiber, Modbus ASCII, MQTT, OTA |
| `iobroker/Heizung_Brennerleistung.js` | JavaScript-Adapter-Skript: Wärmeleistung aus Brennerlaufzeit, Tageswerte, Heizlast-Schätzung, Bewertung Wärmepumpe |
| `iobroker/vis/*.json` | vis-1-Seiten „Heizung“, „Heizung_Schema“, „Heizung_Analyse“ (Widget-Export) |
| `tools/` | `scan.py` (Register-Scan über MQTT), `mqtt_sub.py` (MQTT mitlesen, ohne Abhängigkeiten) |

## Hardware

- ESP32-S3-DevKit (nativer USB-OTG-Port). Der KMS-D funktioniert **ohne** 5-V-Versorgung auf VBUS,
  die Lötbrücke „USB-OTG“ ist nicht nötig.
- Kabel USB-C ↔ **Mini-USB** (Daten).
- Flashen/Log über den UART-Port, danach Updates per WLAN (OTA).

## Firmware

1. `firmware/include/secrets.h.example` → `secrets.h` (WLAN, MQTT-Server)
2. `firmware/secrets.ini.example` → `secrets.ini` (OTA-Passwort)
3. Erstes Flashen per Kabel: `pio run -d firmware -e esp32-s3-devkitc-1 -t upload`
4. Danach per WLAN: `pio run -d firmware -e ota -t upload` (Hostname `oeg-kmsd.local`;
   Windows-Firewall: TCP 32233 eingehend freigeben)

MQTT-Topics (Präfix `oeg_kmsd/`): `t1`…`t6`, `t1_set`, `t2_set`, `flow_set`, `boiler_set`, `dhw_set`,
`relays`, `relay/r1`…`r8`, `state` (JSON), `status` (online/offline). Befehl `cmd` ← `scan <von> <bis>`,
Antworten auf `scan`. Relais werden alle 2 s gelesen und bei Änderung sofort gesendet.

## Registerbelegung (Hydraulikschema 107b)

107b = Ölkessel, Direktheizkreis (Kreis 2, R7), Mischerheizkreis/Fußboden (Kreis 1),
Warmwasserspeicher, Solarkollektoren. Abgeglichen mit dem Regler-Display am 07.11.2026.
Modbus ASCII, Slave 128, 9600 7E1, Funktion 03.

| Register | Bedeutung | Skalierung |
|---|---|---|
| 38 | T1 Solarkollektor | /10 °C |
| 39 | T2 Außen | /10 °C |
| 40 | T3 Ölkessel | /10 °C |
| 41 | T4 Vorlauf Kreis 1 (Mischer/FBH) | /10 °C |
| 42 | T5 Warmwasser oben | /10 °C |
| 43 | T6 Warmwasser unten (Solar) | /10 °C |
| 44–45 | T7/T8 (nicht angeschlossen → 309 °C) | /10 °C |
| 49 | Soll T1 (Kollektor) | /10 °C |
| 50 | T2 gedämpfte Außentemperatur | /10 °C |
| 51 | Soll T3 Kessel (bei WW-Ladung = WW-Soll + 10 K) | /10 °C |
| 52 | Soll T4 Vorlauf Kreis 1 | /10 °C |
| 53 | Soll T5 Warmwasser | /10 °C |
| 54–56 | Soll T6–T8 (−500 = keiner) | /10 °C |
| 34 | Handbetrieb-Bitmaske | Bit0 = R1 |
| 35 | Relais-Bitmaske | Bit0 = R1 … Bit7 = R8 |
| 1000–1199 | Einstellwerte P/S-Parameter (Zuordnung offen) | – |

Relais: R1 Brenner · R2 Pumpe Kreis 1 (FBH) · R3/R4 Mischer auf/zu · R5 WW-Ladepumpe ·
R6 Solarpumpe (drehzahlgeregelt) · R7 Pumpe Direktkreis · R8 frei.

Quellen: [ced2git/oeg_kmsd](https://github.com/ced2git/oeg_kmsd), KMS-D-Anleitung (Schemenübersicht),
eigener Register-Scan.

## ioBroker

- `mqtt.0` als Broker; Datenpunkte `mqtt.0.oeg_kmsd.*`, Logging in `influxdb.0`.
- Skript `Heizung_Brennerleistung.js` (JavaScript-Adapter): schreibt nach `0_userdata.0.Heizung.*`.
  Annahmen oben im Skript anpassen (Brennerleistung/Düse, Wirkungsgrad, Normaußentemperatur,
  Personen, WP-Leistung bei θNA). Ersetzt keine Heizlastberechnung nach DIN EN 12831.
- vis-1-Seiten: JSON-Dateien enthalten die Seiteneinstellungen und Widgets einer View; zum Import
  in `vis-views.json` des Projekts unter dem Seitennamen einfügen (vorher sichern).
