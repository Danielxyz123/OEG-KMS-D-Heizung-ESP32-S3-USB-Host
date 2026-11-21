# Reglerverhalten KMS-D: Heizkurve Heizkreis 1 (Fußboden)

Gemessen und ausgewertet am 16.11.2026 aus den InfluxDB-Daten ab 07.11.2026 (`flow_set`, `t2_set`)
und aus Register-Scans über MQTT (nur lesend, `tools/scan.py`).
Kessel, Brenner und Wartungswerte: [ANLAGE.md](ANLAGE.md).

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
| 1180 | P3.1 Steilheit Kreis 2 (Direktkreis) | /100 | 40 → 0,40 (bis 21.11.: 0,70) |
| 1181 | P3.2 Parallelverschiebung Kreis 2 | /10 K | 50 → +5,0 K (bis 21.11.: −1,0) |
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
| 1022 | S2.3 Einfluss Raumgerät DD2+ | Code | 0 (Anleitung nennt nur 1–5, kein DD2+ vorhanden) |
| 1023 | S2.4 Pumpenbetrieb | Code | 4 (= PROG. P2 bei Zählung ab 1; Pumpe R2 lief trotzdem 99,98 % der Zeit) |
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

**Gesamtaufteilung 1000–1199** (je 20 Register, Abgleich mit der Anleitung S. 40–48, 21.11.2026):
1000 S1 · 1020 S2 · 1040 S3 · 1060 S4 · 1080 S5 · 1100 S6 · 1120 F (Estrichtrocknung, vermutet) ·
1160 P1 · 1170 P2 · 1180 P3 · 1190 P4. Auswahl-Codes sind gemischt gezählt: P1.5, P1.8, S1.3, S1.7, S4.5 ab 0,
S1.4–S1.9 und die S4-Auswahllisten laut Anleitung ab 1, S5.6 ab 0.

#### S1 Allgemein (ab 1000)

| Register | Parameter | Wert | Bemerkung |
|---|---|---|---|
| 1000 | S1.1 Hydraulikschema | 33 | interner Index (Display zeigt 107b) |
| 1001 | S1.2 Code Service-Ebene | 1 | Werkseinstellung 0001 |
| 1002 | S1.3 Fühlertyp | 0 | PT1000 |
| 1003 | S1.4 Funktion T1 | 1 | RF1, im Schema 107b ist T1 aber fest der Kollektor → ohne Wirkung |
| 1004 | S1.5 Funktion T8 | 1 | RF2, T8 nicht angeschlossen |
| 1005 | S1.6 Digitaleingang T1/T6 | 1 | Werkseinstellung |
| 1006 | S1.7 Blockierschutz | 0 | aus |
| 1007–1008 | S1.8/S1.9 Fernaktivierung | 2 / 3 | Werkseinstellung |
| **1009** | **S1.10 Gebäudetyp (Zeitkonstante)** | **3 h** | **Dämpfung der Außentemperatur → `t2_set`** |
| 1012–1019 | S1.13–S1.20 Fühlerabgleich T1–T8 | 0 | kein Offset |

#### S4 Warmwasser (ab 1060)

| Register | Parameter | Wert | Werk |
|---|---|---|---|
| 1060 | S4.1 Funktion Ausgang R5 | 1 (Schema) | 1 |
| 1061 | S4.2 Hysterese WW | 10 K | 6 |
| 1062 | S4.3 max. WW-Temperatur | 85 °C | 80 |
| 1063 | S4.4 Überhitzungsschutz | 0 (aus) | 0 |
| **1064–1066** | **S4.5–S4.7 Legionellenschutz** | **ein, Freitag, 05 Uhr** | aus, Fr, 5 |
| 1067 | S4.8 min. WW-Temp. bei Festbrennstoff | 3 (55 °C) | 3 |
| 1068 | S4.9 Funktion Zirkulationsausgang | 1 (Zirkulation) | 1 |
| 1069 | S4.10 WW-Soll bei Solar/Festbrennstoff | 80 °C | 70 |
| 1070 | S4.11 min. Umgebungstemp. WW-Wärmepumpe | 16 °C | 16 |
| 1071 | S4.12 Nachlauf WW-Ladepumpe | 5 min | 5 |

Legionellenschutz in den Daten bestätigt: `dhw_set` stand am Fr 13.11. 05:13–05:35 und am Fr 20.11.
05:13–05:43 auf 66 °C (sonst 52 °C), der Kessel-Soll dabei auf 76 °C (= WW + S5.5).

#### S5 Kessel (ab 1080)

| Register | Parameter | Wert | Werk |
|---|---|---|---|
| 1080 | S5.1 max. Kesseltemperatur | 90 °C | 90 |
| **1081** | **S5.2 Brenner-Hysterese** | **12 K** (bis 21.11.2026: 8) | 8 |
| 1082 | S5.3 Kesselüberhöhung Kreis 1 | 5 K | 5 |
| 1083 | S5.4 Kesselüberhöhung Kreis 2 | 5 K | 5 |
| 1084 | S5.5 Kesselüberhöhung WW-Ladung | 10 K | 10 |
| 1085 | S5.6 Kessel-Bereitschaft auf Mindesttemperatur | 2 (laut Anleitung „AUS“ bei Zählung ab 0) | 2 |
| 1086 | S5.7 Brenner-Abschaltung bei Festbrennstoff | 4 | 4 |
| 1091–1092 | S5.12/S5.13 Festbrennstoff | 77, 90 | Werkseinstellungen |
| 1093 | S5.14 min. Kessel-Rücklauftemperatur (laut Anleitung) | **41** (bis 21.11.2026: 50) | 50 |
| 1094–1098 | S5.15–S5.18 Umschaltung/Abgas | 1,0, 0, 130, 200 | Werkseinstellungen |

Am 21.11.2026 wurde gleichzeitig die Mindest-Kesseltemperatur auf 41 °C gestellt (Kessel-Soll im
Heizbetrieb 39 → 41 °C) und 1093 von 50 auf 41 geändert. Ob 1093 die Mindest-Kesseltemperatur ist
oder (wie in der Anleitung) die Rücklaufanhebung, ist offen: Vorher stand 1093 auf 50, der Kessel-Soll
aber auf 39 °C.

S5.8–S5.11 (1087–1090 = 0) stehen nicht auf den gelesenen Seiten.

### Kesselverhalten (gemessen 17.–21.11.2026)

- **Kessel-Soll (`boiler_set`) ist im Heizbetrieb konstant 39 °C.** Rechnerisch bräuchte Kreis 1 nur
  Vorlauf-Soll + S5.3 = 29 + 5 ≈ 34 °C. Die 39 °C sind also eine Mindest-Kesseltemperatur (im Diagramm
  „Tkmin“). Sie steht nicht in den gelesenen Registern, vermutlich im Menü Temperatureinstellungen.
- **Bei WW-Ladung** gilt Kessel-Soll = WW-Soll + S5.5 = 52 + 10 = 62 °C (Legionellenschutz: 66 + 10 = 76 °C).
- **Brennerschaltpunkte ohne WW-Ladung:** EIN im Mittel bei Kessel-Soll − 4,5 K (≈ 34,5 °C),
  AUS bei Soll + 6,6 K (≈ 45,6 °C, inklusive Nachheizen). Das passt zu S5.2 = 8 K (±4 K) plus Überschwingen.
- **Folge:** ≈ 37 Starts pro Tag mit je 6–7 min Laufzeit. Weniger Starts gäbe es nur mit größerer Hysterese
  (S5.2) oder niedrigerer Mindest-Kesseltemperatur. Beides nur nach den Vorgaben des Kesselherstellers ändern
  (Sieger TT11, Kondensation/Taupunkt).
- **Mischer:** T4 folgt dem Vorlauf-Soll im Mittel auf −0,02 K (Streuung 0,65 K), in 4 Tagen 29 Impulse
  „auf“ (R3) und 35 „zu“ (R4). R7 (Direktkreis, deaktiviert) und R6 (Solar) schalten kaum.
- **ESP/USB-Verbindung:** `oeg_kmsd/status` seit 18.11. durchgehend „online“.

### Frostschutz und Heizkreis 2 (Direktkreis, derzeit ungenutzt)

- **P1.3 = 1 °C:** Sinkt T2 unter etwa +1 °C, läuft die Pumpe des Direktkreises **R7 im Frostschutz**,
  obwohl der Kreis deaktiviert ist. Gemessen: 10.11. 5,9 h (T2 −0,2 °C), 14.11. 10,9 h und
  14./15.11. 18,7 h (bis −0,9 °C), 17.11. 12,5 h. Der Werkswert von P1.3 wäre −10 °C.
- **Kessel-Soll bleibt dabei unverändert** (14./15.11. durchgehend 39 °C): Der Direktkreis hebt den
  Kessel nicht an, die Mindest-Kesseltemperatur ist höher als sein Bedarf.
- **Heizkurve Kreis 2 (P3.1/P3.2) seit 21.11.2026: 0,40 / +5,0** (vorbereitet für eine spätere
  Fußbodenheizung im Dachgeschoss). Auch mit Tag-Sollwert 18 °C ergäbe das bei −10 °C etwa 32 °C,
  mit Kesselüberhöhung S5.4 (5 K) 37 °C, also unter den 41 °C Mindest-Kesseltemperatur. **Kein Einfluss
  auf Kessel oder Frostschutz.**
- Hinweis für später: Kreis 2 ist im Schema 107b ein **Direktkreis ohne Mischer**. Sein Vorlauf ist die
  Kesseltemperatur (41–49 °C), für eine Fußbodenheizung zu warm. Mit der Wärmepumpe (Frühjahr 2027)
  wird das ohnehin neu aufgebaut.
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

- **T2_gedämpft** = Register 50 (`t2_set`), nicht die rohe Außentemperatur. Gedämpft wird mit der
  Gebäude-Zeitkonstante S1.10 = 3 h (Register 1009).
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
| 21.11.2026 ≈ 11:50 | S5.2 = 12 K (vorher 8), Mindest-Kesseltemperatur 41 °C (vorher 39), Register 1093 = 41 (vorher 50), P3.1/P3.2 = 0,40 / +5,0 (vorher 0,70 / −1,0) | weniger Brennerstarts. Kreis 2 vorbereitet für spätere Fußbodenheizung im Dachgeschoss, derzeit ohne Wirkung |
