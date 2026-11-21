# Reglerverhalten KMS-D: Heizkurve Heizkreis 1 (Fußboden)

Gemessen und ausgewertet am 16.11.2026 aus den InfluxDB-Daten ab 07.11.2026 (`flow_set`, `t2_set`)
und aus Register-Scans über MQTT (nur lesend, `tools/scan.py`).

## Einstellparameter in den Registern

Die Einstellwerte liegen ab Register 1000. Die P-Gruppen ließen sich eindeutig zuordnen: P4 und P3
stimmen exakt mit den Werkseinstellungen der KMS-D-Anleitung überein, und die Änderung von P2.1/P2.2
am Display am 16.11.2026 erschien sofort in Register 1170/1171.

| Register | Parameter (Anleitung) | Skalierung | Wert 16.11.2026 |
|---|---|---|---|
| 1160 | P1.1 Automatische Sommer/Winter-Umschaltung | 0/1 | 1 |
| 1161 | P1.2 Mittlere Außentemperatur Sommer/Winter | °C | 19 |
| 1162 | P1.3 Außentemperatur Frostschutz | °C | 1 |
| 1163 | P1.4 Raumtemperatur bei ausgeschalteter Heizung | °C | 6 |
| 1164 | P1.5 Temperatur-Rundung | Code | 2 (0,5 °C) |
| 1165 | P1.6 Sommer/Winterzeit automatisch | 0/1 | 1 |
| 1166 | P1.7 Intervall Temperaturaufzeichnung | min | 20 |
| 1167 | P1.8 Töne | Code | 1 |
| 1168 | P1.9 Erweiterte Temperaturanzeige | 0/1 | 1 |
| **1170** | **P2.1 Steilheit Heizkurve Kreis 1** | **/100** | **50 → 0,50** (ursprünglich 0,60) |
| **1171** | **P2.2 Parallelverschiebung Kreis 1** | **/10 K** | **42 → +4,2 K** (ursprünglich +2,0) |
| 1172 | P2.3 Dauer Boost-Heizen | min | 0 |
| 1173 | P2.4 Raumanhebung Boost | /10 K | 30 → 3,0 K |
| 1180 | P3.1 Steilheit Kreis 2 (Direktkreis) | /100 | 70 → 0,70 |
| 1181 | P3.2 Parallelverschiebung Kreis 2 | /10 K | −10 → −1,0 K |
| 1182 | P3.3 Dauer Boost-Heizen Kreis 2 | min | 0 |
| 1183 | P3.4 Raumanhebung Boost Kreis 2 | /10 K | 30 → 3,0 K |
| 1184 | P3.5 Steilheit weitere Direktkreise | /100 | 120 → 1,20 |
| 1185 | P3.6 Parallelverschiebung weitere Direktkreise | /10 K | 0 |
| 1190 | P4.1 WW-Temperatur in der Aus-Zeit | °C | 40 |
| 1191–1192 | P4.2/P4.3 WW-Vorrang vor Kreis 1/2 | 0/1 | 0 / 0 |
| 1196 | P4.7 Zeitprogramm Zirkulation | Code | 3 |
| 1197 | P4.8 Laufzeit Zirkulationspumpe | s | 300 |
| 1198 | P4.9 Stillstand Zirkulationspumpe | min | 10 |

Die Blöcke 1000–1059 sind vermutlich die Service-Parameter S1–S3 (S2 = Kreis 1, S3 = Kreis 2,
z. B. 1025 = 50 und 1045 = 85, wahrscheinlich die maximale Vorlauftemperatur des jeweiligen Kreises).
Das ist nicht bestätigt. Die Register 1400–1799 enthalten bei diesem Modell **keine** Min/Max-Werte
(anders als beim KS2W), sondern Flags (1, 33, 257, 289 …).

Im Bereich 0–59 stehen sehr wahrscheinlich die Raum-Sollwerte: Register 7 = 155 (15,5 °C, Nacht)
und Register 8 = 180 (18,0 °C, Tag) für Kreis 1, Register 13/14 = 160/180 für Kreis 2. Nicht über
die Anleitung bestätigt, passt aber zum Drehpunkt der Kurve (unten).

## Kennlinie: so rechnet der Regler

```
VL_soll = 16,2 + P2.2 + P2.1 × (17,3 − T2_gedämpft)
```

Stand 21.11.2026: Fit über 2 487 Punkte aus vier Einstellungen (Steilheit 0,60 / 0,55 / 0,50 / 0,40,
T2_gedämpft −1,7 … +8,0 °C), RMS 0,05 K, größte Abweichung 0,18 K. Die erste Fassung
`15,8 + P2.2 + P2.1 × (18 − T)` (aus zwei Einstellungen) lag bei 0,60 um −0,08 K und bei 0,40
um +0,13 K daneben. Bei Steilheit 0,50 sind beide Formeln gleich.

- **T2_gedämpft** = Register 50 (`t2_set`), nicht die rohe Außentemperatur.
- **P2.2 wirkt 1:1** auf den Vorlauf: +1 K Parallelverschiebung = +1 K Vorlauf bei jeder Außentemperatur.
  Gemessen am 16.11. um 18:01:36, als nur P2.2 geändert war: Vorlauf-Soll 24,5 → 25,5 °C.
- **Die Steilheit dreht die Kurve um T2_gedämpft ≈ 17,3 °C** (bestimmt aus den Wechseln 0,60 → 0,55
  → 0,50 → 0,40).
- Es gibt **keine Tag/Nacht-Absenkung**: Vorlauf-Soll hängt in den Daten ausschließlich von T2_gedämpft ab
  (Rest je Uhrzeit < 0,05 K).
- Der Wert wird auf 0,1 K gerundet. Zwischen −1,7 und +7,9 °C ist die Kurve linear (RMS 0,04 K).

Kontrolle: Alte Einstellung (0,60 / +2,0) → `15,8 + 2 + 0,6 × 18 = 28,6` bei 0 °C, gemessen 28,6.
Einstellung 0,55 / +3,0 bei 6,7 °C → `15,8 + 3 + 0,55 × 11,3 = 25,0`, gemessen 24,9/25,0.
Einstellung 0,50 / +4,2 bei 6,6 °C → `15,8 + 4,2 + 0,50 × 11,4 = 25,7`, gemessen 25,7.

Die Steilheit ließ sich am Display offenbar nur in 0,05er-Schritten einstellen (0,48 → 0,50).

### Änderung vorausberechnen

```
ΔVL(T) = ΔP2.2 + ΔP2.1 × (17,3 − T)
```

(Die Tabelle unten ist noch mit der ersten Fassung, Drehpunkt 18 °C, gerechnet. Die Abweichung beträgt höchstens 0,1 K.)

Beispiel: Kurve um 0 °C drehen, sodass bei 8 °C der Vorlauf um 1 K steigt:
`ΔP2.1 = −1/8 = −0,125` und `ΔP2.2 = 0,125 × 18 = +2,25`.

| Einstellung | 0 °C | 8 °C | −10 °C | +15 °C |
|---|---|---|---|---|
| 0,60 / +2,0 (bis 16.11.) | 28,6 | 23,8 | 34,6 | 19,6 |
| 0,55 / +3,0 (ab 16.11. 18:01) | 28,7 | 24,3 | 34,2 | 20,4 |
| 0,48 / +4,2 (Ziel: 0 °C gleich, 8 °C +1 K) | 28,6 | 24,8 | 33,4 | 21,4 |
| 0,50 / +4,0 (falls nur 0,05er-Schritte) | 28,8 | 24,8 | 33,8 | 21,3 |
| 0,50 / +4,2 (ab 16.11. 18:16) | 29,0 | 25,0 | 34,0 | 21,5 |
| 0,50 / +5,2 (ab 18.11. 14:11) | 30,0 | 26,0 | 35,0 | 22,5 |
| **0,40 / +6,1 (ab 21.11. 09:45, neue Formel)** | **29,2** | **26,0** | **33,2** | **23,2** |

## Raumtemperatur Wohnzimmer (Sensor 1, ab 14.11.2026)

Mit 0,60 / +2,0: bei T2_gedämpft ≈ 1 °C 19,6–19,8 °C (passend), bei ≈ 7 °C 19,1–19,3 °C (zu kalt).
Die Kurve war also minimal zu steil. Deshalb wird sie um 0 °C gedreht. Faustwert Fußbodenheizung:
+1 K Vorlauf ≈ +0,5 K Raum. Nach jeder Änderung 2–3 Tage abwarten (träger Estrich).

Auswertung 14.–18.11.2026 (3-h-Mittel, ohne Stromausfall 17.11. 16:08–18:52):

| Lage | T2_gedämpft | Vorlauf-Soll | Wohnzimmer |
|---|---|---|---|
| Frost 14./15.11. (0,60/+2,0) | −1,5 °C | 29,5 °C | 19,5 °C |
| mild 16.11. (0,60/+2,0 → 0,55/+3,0) | +7,0 °C | 24,2 °C | 19,1 °C |
| mild 18.11. vormittags (0,50/+4,2) | +7,5 °C | 25,2 °C | 19,1 °C (noch nicht eingeschwungen) |

Aus dem Frostpunkt ergibt sich eine wirksame Steigung von etwa 0,48 mit Drehpunkt um 20 °C. Die
Steilheit 0,50 passt also zum Haus, das Niveau wird über P2.2 eingestellt.
**Ziel ab 18.11.2026: Wohnzimmer immer 20 °C.** P2.2 in 0,5er-Schritten nachführen
(> 20,3 °C runter, < 19,7 °C rauf). Steilheit erst ändern, wenn milde Tage nach dem Einschwingen
dauerhaft kühler bleiben als Frosttage.

## Mitschrift der Einstellungen in ioBroker

Seit 18.11.2026 liest das ioBroker-Skript `Heizung_Regler_Parameter` alle 15 min (und nach jeder
Wiederverbindung) die Register 1170–1173 und 7–8 über `oeg_kmsd/cmd` (`scan`, nur lesend) aus und
schreibt sie nach `0_userdata.0.Heizung.Regler.*`:
`P2_1_Steilheit`, `P2_2_Parallelverschiebung`, `P2_3_Boost_Dauer`, `P2_4_Boost_Anhebung`,
`Raum_Soll_Nacht`, `Raum_Soll_Tag` (beide vermutet) und `Heizkurve` als Text („0,50 / +5,2 K“).
InfluxDB loggt nur Änderungen (plus stündliche Wiederholung). Die Einstellungen vom 07.11. bis 18.11.
sind nachgetragen.

## Änderungsprotokoll Regler

| Datum | Änderung | Grund |
|---|---|---|
| bis 16.11.2026 | P2.1 = 0,60, P2.2 = +2,0 | Ausgangszustand |
| 16.11.2026 18:01 | P2.1 = 0,55, P2.2 = +3,0 | an milden Tagen zu kalt, bei 0 °C passend |
| 16.11.2026 18:16 | P2.1 = 0,50, P2.2 = +4,2 | Ziel: gegenüber 0,60/+2,0 bei 8 °C +1 K Vorlauf, bei 0 °C gleich (erreicht: +1,2 K / +0,4 K) |
| 18.11.2026 14:11 | P2.1 = 0,50, P2.2 = +5,2 | Ziel 20 °C im Wohnzimmer bei jeder Außentemperatur (bei Frost 19,5 °C, mild ≈ 19,5 °C erwartet); +1 K Vorlauf überall. Bestätigt: Register 1171 = 52, Vorlauf-Soll 26,0 °C bei T2_gedämpft 7,8 °C |
| 20.11.2026 (Kontrolle) | keine Änderung, bleibt 0,50 / +5,2 | Wohnzimmer eingeschwungen bei 19,7–19,8 °C, gleich bei T2_gedämpft 7–8 °C und ≈ 3 °C (Steilheit bestätigt, +1 K Vorlauf ≈ +0,6 K Raum). Temperatur reicht, kein weiterer Schritt auf +5,7 |
| 21.11.2026 09:45 | P2.1 = 0,40, P2.2 = +6,1 | Grund nicht protokolliert. Wirkung gegenüber 0,50/+5,2: Drehung um +8 °C (dort ±0), bei 0 °C −0,8 K, bei −10 °C −1,8 K Vorlauf. Vorlauf-Soll 29,2 °C bei 0 °C bestätigt (Formel 29,2) |
