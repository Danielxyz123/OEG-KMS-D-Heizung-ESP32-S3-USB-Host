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

Die Blöcke 1000–1059 sind die Service-Parameter S1–S3. **S2 (Kreis 1) ab Register 1020 ist bestätigt**:
Reihenfolge und Werte passen zur S2-Tabelle der Anleitung (S. 43/44).

| Register | Parameter (Anleitung) | Skalierung | Wert 21.11.2026 |
|---|---|---|---|
| 1020 | S2.1 Einfluss der Raumtemperatur-Abweichung | /10 | 10 → 1,0 |
| 1021 | S2.2 Einfluss Raumfühler T1/T8 | Code | 1 (AUTO) |
| 1022 | S2.3 Einfluss Raumgerät DD2+ | Code | 0 |
| 1023 | S2.4 Pumpenbetrieb | Code | 4 |
| 1024 | S2.5 Minimale Vorlauftemperatur | °C | 20 |
| 1025 | S2.6 Maximale Vorlauftemperatur | °C | 50 (Werk 45 für Fußboden) |
| 1026 | S2.7 Totzone Mischerregelung | ? | 6 (Bereich laut Anleitung 1,0–3,0, Skalierung unklar) |
| 1027–1029 | S2.8–S2.10 Mischer P/I/D | /10 | je 1,0 |
| 1030 | S2.11 Maximale Fußbodentemperatur | °C | 25 |
| 1031 | S2.12 Minimale Vorlauftemperatur Kühlbetrieb | /10 °C | 15,0 |
| 1032 | S2.13 Verschiebung Einschaltschwelle Mischerregelung | °C | 0 |
| 1033 | S2.14 Max. Differenz Vor-/Rücklauf | °C | 15 |
| 1034 | S2.15 Konstante Vorlauftemperatur | 0/1 | 0 (witterungsgeführt) |
| 1035 | S2.16 Nachlauf Umwälzpumpe | min | 5 |

S3 (Kreis 2) ab 1040 ist gleich aufgebaut (z. B. 1045 = 85 = max. Vorlauf Direktkreis).
Die Register 1400–1799 enthalten bei diesem Modell **keine** Min/Max-Werte (anders als beim KS2W),
sondern Flags (1, 33, 257, 289 …).

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

### Abgleich mit der Anleitung (21.11.2026)

Die Anleitung (S. 37/38, 43/44, 52) nennt **keine Formel**, sondern nur ein Diagramm mit den Kurven
S = 0,2 … 2,2 (Vorlauf über Außentemperatur). Was sich prüfen lässt, passt zum gemessenen Verhalten:

- **P2.1 Steilheit:** Die Anleitung empfiehlt für Fußbodenheizung 0,2–0,8 und Änderungen um höchstens
  0,1–0,2 mit mindestens 24 h Abstand. Gemessen: Steigung der Kurve = P2.1 (0,60 → 0,615, 0,50 → 0,50).
- **P2.2 Parallelverschiebung:** Die Anleitung beschreibt sie nur als Verschiebung der Heizkurve.
  Gemessen: wirkt 1:1 auf den Vorlauf (16.11. 18:01: +1,0 K).
- **Grenzen S2.5/S2.6:** Der Vorlauf wird auf 20 … 50 °C begrenzt. Im bisherigen Bereich (23–31 °C)
  greift keine der Grenzen, die Formel gilt dort ohne Begrenzung.
- **Raumeinfluss S2.1–S2.3:** Er wirkt nur mit einem Raumfühler (T1/T8 oder DD2+). T1 ist hier der
  Kollektor, T8 ist nicht angeschlossen, ein DD2+ ist nicht vorhanden. Der Regler arbeitet deshalb **rein
  witterungsgeführt**, passend zur Messung (Vorlauf hängt nur von T2_gedämpft ab). Sensor 1 im Wohnzimmer
  hat keinen Einfluss auf den Regler.
- **Abschaltung:** Liegt der berechnete Vorlauf nur noch wenige Kelvin über der Raumtemperatur oder nähert
  sich die Außentemperatur dem Sollwert, schaltet der Kreis ab (Vorlauf-Soll 4 °C). Mit der aktuellen
  Kurve passiert das erst bei T2_gedämpft deutlich über 15 °C.
- **Raum-Sollwerte:** Laut Anleitung lässt sich die Raumtemperatur auch über die Tag-/Nacht-Temperatur
  verstellen, sie gehen also in die Kurve ein. Der gemessene Drehpunkt 17,3 °C und die Konstante 16,2 °C
  hängen sehr wahrscheinlich an der Tag-Temperatur (Register 8 = 18,0 °C). **Wird die Tag-Temperatur
  geändert, gilt die Formel nicht mehr unverändert.** Prüfen lässt sich das mit +1 K Tag-Temperatur:
  Der Vorlauf sollte dann um etwa 1 + P2.1 K steigen (bei 0,40 also ≈ 1,4 K).

**Grenzen der Formel:** Bei Seltron-Reglern sind die Diagrammkurven für größere Steilheiten leicht
gekrümmt. Die lineare Formel ist gemessen zwischen T2_gedämpft −1,7 und +8 °C. Bei starkem Frost
(−10 °C und kälter) kann der echte Vorlauf etwas davon abweichen, das ist erst mit Frostdaten prüfbar.

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
