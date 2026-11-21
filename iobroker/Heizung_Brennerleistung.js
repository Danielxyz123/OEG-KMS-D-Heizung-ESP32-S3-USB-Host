// Heizung_Brennerleistung
// OEG KMS-D (Schema 107b) -> ESP32 -> MQTT -> InfluxDB.
// Berechnet aus der Laufzeit des Brennerrelais R1 die gemittelte Waermeleistung,
// trennt Warmwasserladung (R5) von Heizbetrieb und schaetzt die Heizlast bei
// Normaussentemperatur (Regression Tagesheizleistung ueber Tagesmittel Aussentemperatur).
//
//   Waerme = Laufzeit x BURNER_KW x ETA
//   Heizlast(θNA) aus linearer Regression P_heiz(Tag) = a + b * T_aussen(Tag)
//
// Ersetzt keine Heizlastberechnung nach DIN EN 12831 (z. B. fuer Foerderantrag).

// ----------------------------- Annahmen (anpassen) -----------------------------
const OIL_KG_H = 2.12;    // Oeldurchsatz lt. Wartungsprotokoll 28.06.2020 (Sieger TT11, Duese 0,55 gph 60° HTD)
const BURNER_KW = OIL_KG_H * 11.86;  // Feuerungsleistung ≈ 25,1 kW (Heizwert Heizoel EL 11,86 kWh/kg)
const ETA = 0.914;        // feuerungstechn. Wirkungsgrad lt. Messprotokoll 02.06.2020 (Abgasverlust 8,6 %)
const OIL_KWH_PER_L = 10; // Heizwert Heizoel EL
const THETA_I = 20;       // Innentemperatur fuer Hochrechnung (konservativ)
const THETA_NA = -10;     // Normaussentemperatur 49328 Melle (DIN/TS 12831-1, vom Fachbetrieb bestaetigen)
const PERSONS = 4;        // 2 Erwachsene, 2 Kinder (WW-Zuschlag 0,25 kW/Person)
const WP_KW = 10;         // Bosch Compress 5800i/6800i AW 10: 10,0 kW bei A-10/W35
const DG_ZUSATZ_KW = 1.9; // Dachausbau: DG +2..2,8 kW, Decke EG->Dachboden entfaellt -0,5 kW (Mitte)
const HEIZGRENZE = 15;    // Tage mit Mittel >= 15 °C nicht in die Regression
const FLAME_DELAY_S = 25; // je Start: R1 an, aber noch keine Flamme (Vorspuelen/Oelvorwaermung).
                          // Gemessen 20.11.2026 an 442 Starts: Kessel steigt 178 s nach R1-an,
                          // laeuft 151 s nach R1-aus nach -> ca. 25-30 s ohne Flamme
const TB_FIX = 17;        // feste Heizgrenze, solange die Messtage zu wenig Temperaturspanne haben
const TB_MIN = 15, TB_MAX = 20;  // Spanne der Heizgrenze fuer min/max-Heizlast
const RANGE_FREE_K = 8;   // ab dieser Spanne der Tagesmittel (K) freie Regression
const CURVE_SETTLE_DAYS = 2;     // Tag der Heizkurvenaenderung + 2 Folgetage nicht in die Regression
const CALC_VERSION = 2;   // erhoehen -> alle Tageswerte werden neu berechnet
// Kontrolle Oelverbrauch (20.11.2026): 2300 l/a x 10 kWh/l x 0,88 - 2400 kWh WW = 17800 kWh,
// Gradtagzahl G20/15 3300..3700 Kd -> H = 190..250 W/K -> 5,7..7,5 kW bei -10 °C (Mitte 6,4 kW)
// --------------------------------------------------------------------------------

const S = 'mqtt.0.oeg_kmsd.';
const R1 = S + 'relay.r1', R5 = S + 'relay.r5', T2 = S + 't2';
const STATUS = S + 'status';                                   // 'online' / 'offline' (LWT, USB-Verbindung zum Regler)
const FROZEN_IDS = ['t1', 't2', 't3', 't4', 't5', 't6'].map(k => S + k);
// Datenluecken: InfluxDB loggt unveraenderte Werte alle 10 min erneut (changesRelogInterval 600),
// d. h. bei Verbindungsabbruch entstehen KEINE Luecken, sondern eingefrorene Werte.
// Luecke = ESP offline (status) ODER keiner der Fuehler t1..t6 hat sich > FROZEN_MS geaendert
// (normal max. 3-4 min, Auswertung 07.-18.11.2026). In Luecken wird KEINE Laufzeit gezaehlt
// (Stromausfall Heizung 17.11.2026 16:08-18:52: Brenner war aus). Tage mit Luecke > GAP_MAX_REG_H
// werden gespeichert, aber nicht fuer die Regression verwendet (Auskuehlen + Nachheizen).
const FROZEN_MS = 15 * 60 * 1000;
const GAP_MAX_REG_H = 0.5;
const HIST = 'influxdb.0';
const BASE = '0_userdata.0.Heizung.';
const DAY = 24 * 3600 * 1000;
const LOG_START = new Date(2026, 10, 7, 18, 35).getTime();   // Beginn der Relais-Aufzeichnung

const NUM = {
    Leistung_1h:            ['Waermeleistung Ø letzte Stunde', 'kW'],
    Leistung_15min:         ['Waermeleistung Ø letzte 15 min', 'kW'],
    Laufzeit_heute:         ['Brenner Laufzeit heute', 'h'],
    Energie_heute:          ['Waerme heute gesamt', 'kWh'],
    Heizenergie_heute:      ['Waerme heute Heizung (ohne WW)', 'kWh'],
    WW_Energie_heute:       ['Waerme heute Warmwasser', 'kWh'],
    Oel_heute:              ['Heizoel heute (geschaetzt)', 'l'],
    Starts_heute:           ['Brenner Starts heute', ''],
    Laufzeit_Anteil_1h:     ['Brennerlaufzeit Anteil letzte Stunde', '%'],
    Laufzeit_Anteil_heute:  ['Brennerlaufzeit Anteil heute (seit Mitternacht)', '%'],
    Datenluecke_heute:      ['Datenluecke heute (offline/eingefroren, keine Laufzeit gezaehlt)', 'h'],
    Laufzeit_Anteil_24h:    ['Brennerlaufzeit Anteil letzte 24 h (rollierend, Flammzeit)', '%'],
    Tag_Datenluecke:        ['Tageswert Datenluecke', 'h'],
    Aussen_Mittel_heute:    ['Aussentemperatur Mittel heute', '°C'],
    Tag_Heizenergie:        ['Tageswert Waerme Heizung', 'kWh'],
    Tag_WW_Energie:         ['Tageswert Waerme Warmwasser', 'kWh'],
    Tag_Heizleistung:       ['Tageswert Ø Heizleistung', 'kW'],
    Tag_Aussen_Mittel:      ['Tageswert Aussentemperatur Mittel', '°C'],
    Tag_Laufzeit:           ['Tageswert Brennerlaufzeit', 'h'],
    Tag_Starts:             ['Tageswert Brennerstarts', ''],
    Tag_Laufzeit_Anteil:    ['Tageswert Brennerlaufzeit Anteil', '%'],
    Heizlast_Norm:          ['Heizlast EG heute bei Normaussentemperatur (Regression)', 'kW'],
    Heizlast_Norm_min:      ['Heizlast EG bei θNA, untere Grenze (Heizgrenze 20 °C)', 'kW'],
    Heizlast_Norm_max:      ['Heizlast EG bei θNA, obere Grenze (Heizgrenze 15 °C)', 'kW'],
    Heizgrenze:             ['Heizgrenze des verwendeten Modells', '°C'],
    Waermeverlust_H:        ['Waermeverlustkoeffizient H (Heizleistung je K unter Heizgrenze)', 'W/K'],
    Heizlast_Norm_DG:       ['Heizlast nach Dachausbau bei Normaussentemperatur', 'kW'],
    WP_Bedarf:              ['Benoetigte WP-Leistung bei θNA nach Dachausbau (inkl. WW)', 'kW'],
    Bivalenzpunkt_10kW:     ['Aussentemp., bis zu der die WP nach Dachausbau allein reicht', '°C'],
    Regression_Tage:        ['Anzahl Tage in der Regression', ''],
};
for (const [k, [name, unit]] of Object.entries(NUM)) {
    createState(BASE + k, 0, { name, type: 'number', role: 'value', unit, read: true, write: false });
}
createState(BASE + 'Tageswerte', '[]', { name: 'Tageswerte (JSON, fuer Regression)', type: 'string', role: 'json', read: true, write: false });
createState(BASE + 'WP_Bewertung', '', { name: 'Bewertung Waermepumpe', type: 'string', role: 'text', read: true, write: false });
createState(BASE + 'Faktor_kW', 0, { name: 'Waerme je Brennerstunde (BURNER_KW x ETA) der gespeicherten Tageswerte', type: 'number', role: 'value', unit: 'kW', read: true, write: false });
createState(BASE + 'Berechnung_Version', 0, { name: 'Version der Tageswert-Berechnung', type: 'number', role: 'value', read: true, write: false });
createState(BASE + 'Heizlast_Methode', '', { name: 'Methode und Datenbasis der Heizlast', type: 'string', role: 'text', read: true, write: false });
createState(BASE + 'Regression_Punkte', '[]', { name: 'Tagespunkte der Heizlast-Schaetzung (JSON: d, t, p kW, use, why)', type: 'string', role: 'json', read: true, write: false });
createState(BASE + 'WP_Leistung', WP_KW, { name: 'Heizleistung der geplanten WP bei θNA', type: 'number', role: 'value', unit: 'kW', read: true, write: false });

// Aendert sich BURNER_KW, ETA oder CALC_VERSION, werden alle Tageswerte aus der Historie neu berechnet
const FAKTOR = Math.round(BURNER_KW * ETA * 1000) / 1000;
function checkFaktor() {
    const st = existsState(BASE + 'Faktor_kW') ? getState(BASE + 'Faktor_kW') : null;
    const sv = existsState(BASE + 'Berechnung_Version') ? getState(BASE + 'Berechnung_Version') : null;
    if (!st || Number(st.val) !== FAKTOR || !sv || Number(sv.val) !== CALC_VERSION) {
        daysCache = [];
        log(`Heizung: Faktor ${st ? st.val : '?'} -> ${FAKTOR} kW, Version ${sv ? sv.val : '?'} -> ${CALC_VERSION}: Tageswerte werden neu berechnet`);
        setState(BASE + 'Faktor_kW', FAKTOR, true);
        setState(BASE + 'Berechnung_Version', CALC_VERSION, true);
    }
}

// ----------------------------- Historie ------------------------------------------
function getHist(id, start, end) {
    return new Promise((resolve) => {
        sendTo(HIST, 'getHistory', {
            id, options: { start: start - 2 * 3600 * 1000, end, aggregate: 'none', count: 200000, ignoreNull: true }
        }, (r) => resolve(((r && r.result) || [])
            .filter(p => p.val !== null && p.val !== undefined)
            .sort((a, b) => a.ts - b.ts)));
    });
}

// Ereignisliste fuer einen Schaltkontakt im Intervall
function steps(pts, start, end) {
    let init = 0;
    const ev = [];
    for (const p of pts) {
        const v = Number(p.val) >= 1 ? 1 : 0;
        if (p.ts <= start) { init = v; continue; }
        if (p.ts > end) break;
        ev.push([p.ts, v]);
    }
    return { init, ev };
}

// Luecken-Intervalle [a, b] im Zeitraum (sortiert, zusammengefasst)
function gapIntervals(statusPts, frozenSeries, start, end) {
    const iv = [];
    // 1) ESP offline laut Status (wird erst seit 18.11.2026 geloggt)
    let off = null;
    for (const p of statusPts) {
        const isOn = String(p.val) === 'online';
        if (!isOn && off === null) off = p.ts;
        if (isOn && off !== null) { iv.push([off, p.ts]); off = null; }
    }
    if (off !== null) iv.push([off, end]);
    // 2) alle Fuehler eingefroren
    const ch = [];
    for (const pts of frozenSeries) {
        let prev;
        for (const p of pts) { if (p.val !== prev) ch.push(p.ts); prev = p.val; }
    }
    ch.sort((x, y) => x - y);
    if (ch.length) {
        for (let i = 1; i < ch.length; i++) if (ch[i] - ch[i - 1] > FROZEN_MS) iv.push([ch[i - 1], ch[i]]);
        if (end - ch[ch.length - 1] > FROZEN_MS) iv.push([ch[ch.length - 1], end]);
    } else {
        iv.push([start, end]);
    }
    // clippen + zusammenfassen
    const c = iv.map(([a, b]) => [Math.max(a, start), Math.min(b, end)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
    const m = [];
    for (const g of c) { if (m.length && g[0] <= m[m.length - 1][1]) m[m.length - 1][1] = Math.max(m[m.length - 1][1], g[1]); else m.push(g.slice()); }
    return m;
}

// gueltige (lueckenfreie) Dauer in [a, b]
function validMs(gaps, a, b) {
    let d = b - a;
    for (const [ga, gb] of gaps) d -= Math.max(0, Math.min(b, gb) - Math.max(a, ga));
    return d;
}

// zeitgewichteter Mittelwert (ohne Luecken)
function twMean(pts, start, end, gaps = []) {
    let v = null, t = start, sum = 0, dur = 0;
    for (const p of pts) {
        if (p.ts <= start) { v = Number(p.val); continue; }
        if (p.ts > end) break;
        if (v !== null) { const d = validMs(gaps, t, p.ts); sum += v * d; dur += d; }
        v = Number(p.val); t = p.ts;
    }
    if (v !== null) { const d = validMs(gaps, t, end); sum += v * d; dur += d; }
    return dur ? sum / dur : null;
}

// Laufzeiten im Intervall: gesamt, waehrend WW-Ladung, Heizbetrieb, Starts
// In Luecken wird keine Laufzeit gezaehlt.
async function stats(start, end) {
    const [p1, p5, pt, ps, ...pf] = await Promise.all([getHist(R1, start, end), getHist(R5, start, end), getHist(T2, start, end),
        getHist(STATUS, start, end), ...FROZEN_IDS.map(id => getHist(id, start, end))]);
    const gaps = gapIntervals(ps.filter(p => p.ts <= end), pf.map(s => s.filter(p => p.ts <= end)), start, end);
    const a = steps(p1, start, end), b = steps(p5, start, end);
    const ev = a.ev.map(e => [e[0], 'b', e[1]]).concat(b.ev.map(e => [e[0], 'w', e[1]])).sort((x, y) => x[0] - y[0]);
    let br = a.init, ww = b.init, t = start, on = 0, onWW = 0, starts = 0, startsWW = 0;
    const acc = (until) => { const d = validMs(gaps, t, until); if (br) { on += d; if (ww) onWW += d; } t = until; };
    for (const [ts, k, v] of ev) {
        acc(ts);
        if (k === 'b') { if (!br && v) { starts++; if (ww) startsWW++; } br = v; } else { ww = v; }
    }
    acc(end);
    // Zeit ohne Flamme je Start abziehen (Laufzeit = Flammzeit)
    on = Math.max(0, on - starts * FLAME_DELAY_S * 1000);
    onWW = Math.min(on, Math.max(0, onWW - startsWW * FLAME_DELAY_S * 1000));
    const valid = validMs(gaps, start, end), gap = (end - start) - valid;
    const covered = p1.filter(p => p.ts > start && p.ts <= end).length;
    return {
        hOn: on / 3600000, hWW: onWW / 3600000, starts,
        qAll: BURNER_KW * ETA * on / 3600000,
        qWW: BURNER_KW * ETA * onWW / 3600000,
        qHeat: BURNER_KW * ETA * (on - onWW) / 3600000,
        tMean: twMean(pt, start, end, gaps),
        covered, hValid: valid / 3600000, hGap: gap / 3600000,
    };
}

const r1 = (v, d = 1) => Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
const dayKey = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const midnightOf = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

// ----------------------------- laufende Werte ------------------------------------
async function updateLive() {
    const now = Date.now();
    const [h1, m15] = await Promise.all([stats(now - 3600000, now), stats(now - 900000, now)]);
    setState(BASE + 'Leistung_1h', r1(h1.qAll, 2), true);
    setState(BASE + 'Leistung_15min', r1(m15.qAll * 4, 2), true);
    const today = await stats(midnightOf(now), now);
    setState(BASE + 'Laufzeit_heute', r1(today.hOn, 2), true);
    setState(BASE + 'Energie_heute', r1(today.qAll), true);
    setState(BASE + 'Heizenergie_heute', r1(today.qHeat), true);
    setState(BASE + 'WW_Energie_heute', r1(today.qWW), true);
    setState(BASE + 'Oel_heute', r1(today.qAll / ETA / OIL_KWH_PER_L), true);
    setState(BASE + 'Starts_heute', today.starts, true);
    setState(BASE + 'Laufzeit_Anteil_1h', r1(h1.hOn * 100), true);
    const hElapsed = (now - midnightOf(now)) / 3600000;
    if (hElapsed > 0.05) setState(BASE + 'Laufzeit_Anteil_heute', r1(today.hOn / hElapsed * 100), true);
    if (today.tMean !== null) setState(BASE + 'Aussen_Mittel_heute', r1(today.tMean), true);
    setState(BASE + 'Datenluecke_heute', r1(today.hGap, 2), true);
    // rollierende 24 h (fuer das M5-Display, gespiegelt von HeizungMqttDisplay) – alle 5 min
    if (new Date(now).getMinutes() % 5 === 0 || !last24) {
        const d24 = await stats(now - DAY, now);
        last24 = now;
        setState(BASE + 'Laufzeit_Anteil_24h', r1(d24.hOn / 24 * 100), true);
    }
}
let last24 = 0;

// ----------------------------- Tageswerte + Regression ---------------------------
let daysCache = null;   // In-Memory-Kopie der Tageswerte
function loadDays() {
    if (daysCache) return daysCache.slice();
    try { daysCache = JSON.parse(getState(BASE + 'Tageswerte').val || '[]'); } catch (e) { daysCache = []; }
    return daysCache.slice();
}

async function closeDay(dayStart) {
    const key = dayKey(dayStart);
    const days = loadDays();
    if (days.some(d => d.d === key)) return false;
    const st = await stats(dayStart, dayStart + DAY);
    // nur vollstaendig erfasste Tage (Relais wird mind. alle 10 min geloggt -> >= 120 Punkte)
    if (st.covered < 120 || st.tMean === null) return false;
    const rec = { d: key, t: r1(st.tMean), qh: r1(st.qHeat), qw: r1(st.qWW), h: r1(st.hOn, 2), s: st.starts, g: r1(st.hGap, 2) };
    days.push(rec);
    days.sort((a, b) => a.d.localeCompare(b.d));
    while (days.length > 180) days.shift();
    daysCache = days.slice();
    setState(BASE + 'Tageswerte', JSON.stringify(days), true);
    const noon = dayStart + DAY / 2;   // Tageswert mittags einloggen -> Balken sitzen auf dem Tag
    setState(BASE + 'Tag_Heizenergie', { val: rec.qh, ack: true, ts: noon });
    setState(BASE + 'Tag_WW_Energie', { val: rec.qw, ack: true, ts: noon });
    setState(BASE + 'Tag_Heizleistung', { val: r1(rec.qh / 24, 2), ack: true, ts: noon });
    setState(BASE + 'Tag_Aussen_Mittel', { val: rec.t, ack: true, ts: noon });
    setState(BASE + 'Tag_Laufzeit', { val: rec.h, ack: true, ts: noon });
    setState(BASE + 'Tag_Starts', { val: rec.s, ack: true, ts: noon });
    setState(BASE + 'Tag_Laufzeit_Anteil', { val: r1(rec.h / 24 * 100), ack: true, ts: noon });
    setState(BASE + 'Tag_Datenluecke', { val: rec.g, ack: true, ts: noon });
    log(`Heizung Tageswert ${key}: Aussen ${rec.t} °C, Heizung ${rec.qh} kWh, WW ${rec.qw} kWh, Laufzeit ${rec.h} h` +
        (rec.g > 0.05 ? `, Datenluecke ${rec.g} h` + (rec.g > GAP_MAX_REG_H ? ' (nicht in Regression)' : '') : ''));
    return true;
}

// Zeitpunkte, an denen sich die Heizkurve geaendert hat (Mitschrift Heizung_Regler_Parameter)
const CURVE_ID = '0_userdata.0.Heizung.Regler.Heizkurve';
async function curveChanges() {
    const pts = await getHist(CURVE_ID, LOG_START, Date.now());
    const ch = [];
    let prev;
    for (const p of pts) { if (prev !== undefined && p.val !== prev) ch.push(p.ts); prev = p.val; }
    return ch;
}

// Heizleistung linear ueber Aussentemperatur, entweder frei (a + b*t) oder mit fester Heizgrenze tb: H*(tb - t)
function fitFixed(pts, tb) {
    const num = pts.reduce((s, p) => s + p[1] * (tb - p[0]), 0), den = pts.reduce((s, p) => s + (tb - p[0]) ** 2, 0);
    return den > 0 ? num / den : null;
}

async function regression() {
    const changes = await curveChanges().catch(() => []);
    const dayStartOf = (d) => new Date(d.d + 'T00:00:00').getTime();
    const settled = (d) => { const s = dayStartOf(d); return !changes.some(c => c > s - CURVE_SETTLE_DAYS * DAY && c < s + DAY); };
    const all = loadDays().filter(d => d.t < HEIZGRENZE);
    const use = all.filter(d => !(d.g > GAP_MAX_REG_H) && settled(d));
    const nGap = all.filter(d => d.g > GAP_MAX_REG_H).length, nCurve = all.filter(d => !(d.g > GAP_MAX_REG_H) && !settled(d)).length;
    const pts = use.map(d => [d.t, d.qh / 24]);
    setState(BASE + 'Regression_Tage', pts.length, true);
    setState(BASE + 'WP_Leistung', WP_KW, true);
    setState(BASE + 'Regression_Punkte', JSON.stringify(all.map(d => ({
        d: d.d, t: d.t, p: r1(d.qh / 24, 2), use: use.includes(d),
        why: d.g > GAP_MAX_REG_H ? 'Datenlücke' : (!settled(d) ? 'Heizkurve geändert' : ''),
    }))), true);
    const ww = PERSONS * 0.25;
    const dg = (t) => DG_ZUSATZ_KW * Math.max(0, THETA_I - t) / (THETA_I - THETA_NA);   // DG-Zuschlag skaliert mit ΔT
    const ausgelassen = (nGap || nCurve) ? ` (ohne ${[nCurve ? `${nCurve} Tage nach Heizkurvenänderung` : '', nGap ? `${nGap} Tag(e) mit Datenlücke` : ''].filter(Boolean).join(', ')})` : '';
    let txt, pNA = null;
    if (pts.length >= 3) {
        const n = pts.length, tMin = Math.min(...pts.map(p => p[0])), tMax = Math.max(...pts.map(p => p[0]));
        let model = null;
        if (tMax - tMin >= RANGE_FREE_K) {
            const mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
            const sxy = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0), sxx = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
            const b = sxy / sxx, a = my - b * mx, tb = b < 0 ? -a / b : null;
            if (tb !== null && tb >= 12 && tb <= 22) model = { tb, H: -b, txt: `freie Regression aus ${n} Tagen` };
        }
        if (!model) model = { tb: TB_FIX, H: fitFixed(pts, TB_FIX), txt: `${n} Tage mit fester Heizgrenze ${TB_FIX} °C` };
        const p = (t) => Math.max(0, model.H * (model.tb - t));
        pNA = p(THETA_NA);
        const hMin = fitFixed(pts, TB_MAX), hMax = fitFixed(pts, TB_MIN);
        const pMin = Math.min(pNA, hMin * (TB_MAX - THETA_NA)), pMax = Math.max(pNA, hMax * (TB_MIN - THETA_NA));
        setState(BASE + 'Heizlast_Norm_min', r1(pMin), true);
        setState(BASE + 'Heizlast_Norm_max', r1(pMax), true);
        setState(BASE + 'Heizgrenze', r1(model.tb), true);
        setState(BASE + 'Waermeverlust_H', Math.round(model.H * 1000), true);
        let tBiv = null;
        for (let t = 15; t >= -25; t -= 0.1) { if (p(t) + dg(t) + ww > WP_KW) { tBiv = t; break; } }
        setState(BASE + 'Bivalenzpunkt_10kW', tBiv === null ? -99 : r1(tBiv), true);
        txt = `${model.txt}${ausgelassen}, Tagesmittel ${r1(tMin)}…${r1(tMax)} °C, H = ${Math.round(model.H * 1000)} W/K, ` +
              `Spanne ${r1(pMin)}–${r1(pMax)} kW (Heizgrenze ${TB_MAX}…${TB_MIN} °C)`;
        setState(BASE + 'Heizlast_Methode', txt, true);
    } else if (pts.length >= 1) {
        // Fallback: Verhaeltnisverfahren je Tag, Mittelwert
        const est = pts.filter(p => p[0] < THETA_I - 3).map(p => p[1] * (THETA_I - THETA_NA) / (THETA_I - p[0]));
        if (est.length) pNA = est.reduce((s, v) => s + v, 0) / est.length;
        txt = `vorläufig (${pts.length} Tag${pts.length > 1 ? 'e' : ''}, Hochrechnung)`;
    } else {
        // noch kein voller Tag: alle bisherigen Daten (max. 48 h) hochrechnen, sobald >= 6 h vorliegen
        const now = Date.now(), start = Math.max(LOG_START, now - 2 * DAY), hours = (now - start) / 3600000;
        if (hours >= 6) {
            const st = await stats(start, now);
            if (st.tMean !== null && st.tMean < THETA_I - 3) {
                pNA = (st.qHeat / hours) * (THETA_I - THETA_NA) / (THETA_I - st.tMean);
                txt = `vorläufig aus ${r1(hours)} h Daten (Ø außen ${r1(st.tMean)} °C) – wird mit jedem Tag genauer`;
            }
        }
    }
    if (pNA === null) {
        setState(BASE + 'WP_Bewertung', 'Noch zu wenig Daten – erste vorläufige Bewertung nach 6 h Aufzeichnung (seit 07.11.2026 18:35).', true);
        return;
    }
    if (pts.length < 3) {
        // Bivalenzpunkt im Verhaeltnismodell: Heizlast proportional zu (θi - θa)
        const tBiv = THETA_I - (THETA_I - THETA_NA) * (WP_KW - ww) / (pNA + DG_ZUSATZ_KW);
        setState(BASE + 'Bivalenzpunkt_10kW', r1(tBiv), true);
    }
    const pDG = pNA + DG_ZUSATZ_KW;
    const need = pDG + ww;
    setState(BASE + 'Heizlast_Norm', r1(pNA), true);
    setState(BASE + 'Heizlast_Norm_DG', r1(pDG), true);
    setState(BASE + 'WP_Bedarf', r1(need), true);
    const judge = (n) => n <= WP_KW * 0.9 ? `reicht (Reserve ${r1(WP_KW - n)} kW)`
        : n <= WP_KW * 1.1 ? 'knapp – an den kältesten Tagen Heizstab (monoenergetisch)'
        : `reicht allein nicht – Heizstab/Bivalenz nötig (Fehlbetrag ${r1(n - WP_KW)} kW)`;
    setState(BASE + 'WP_Bewertung',
        `Nach Dachausbau: ${judge(need)} – ${r1(pDG)} kW Heizlast + ${r1(ww)} kW WW = ${r1(need)} kW. ` +
        `EG heute: ${r1(pNA)} kW (${judge(pNA + ww)}). Basis: ${txt}, ${THETA_NA} °C.`, true);
}

async function dailyJob() {
    // alle noch fehlenden vollen Tage der letzten 30 Tage abschliessen (auch Nachtrag nach Neustart)
    const today = midnightOf(Date.now());
    for (let d = today - 30 * DAY; d < today; d += DAY) await closeDay(d);
    await regression();
}

schedule('* * * * *', () => { updateLive().catch(e => log('Heizung live: ' + e, 'warn')); });
schedule('5 0 * * *', () => { dailyJob().catch(e => log('Heizung Tag: ' + e, 'warn')); });
schedule('7 * * * *', () => { regression().catch(e => log('Heizung Regression: ' + e, 'warn')); });  // stuendlich (vorlaeufige Werte)
on({ id: R1, change: 'ne' }, () => setTimeout(() => updateLive().catch(() => {}), 3000));
setTimeout(() => { checkFaktor(); updateLive().catch(() => {}); dailyJob().catch(e => log('Heizung Tag: ' + e, 'warn')); }, 5000);
