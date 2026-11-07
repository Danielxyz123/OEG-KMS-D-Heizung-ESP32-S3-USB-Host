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
const BURNER_KW = 27;     // Feuerungsleistung Brenner (Typenschild); genauer: aus Duese berechnen
const ETA = 0.90;         // Kesselwirkungsgrad (Niedertemperaturkessel 0,88..0,92)
const OIL_KWH_PER_L = 10; // Heizwert Heizoel EL
const THETA_I = 20;       // Innentemperatur fuer Hochrechnung (konservativ)
const THETA_NA = -12;     // Normaussentemperatur am Standort (DIN/TS 12831-1, PLZ) -> anpassen
const PERSONS = 3;        // Personen im Haushalt (WW-Zuschlag 0,25 kW/Person)
const WP_KW = 10;         // betrachtete Waermepumpe: Heizleistung bei θNA laut Datenblatt!
const HEIZGRENZE = 15;    // Tage mit Mittel >= 15 °C nicht in die Regression
// --------------------------------------------------------------------------------

const S = 'mqtt.0.oeg_kmsd.';
const R1 = S + 'relay.r1', R5 = S + 'relay.r5', T2 = S + 't2';
const HIST = 'influxdb.0';
const BASE = '0_userdata.0.Heizung.';
const DAY = 24 * 3600 * 1000;

const NUM = {
    Leistung_1h:            ['Waermeleistung Ø letzte Stunde', 'kW'],
    Leistung_15min:         ['Waermeleistung Ø letzte 15 min', 'kW'],
    Laufzeit_heute:         ['Brenner Laufzeit heute', 'h'],
    Energie_heute:          ['Waerme heute gesamt', 'kWh'],
    Heizenergie_heute:      ['Waerme heute Heizung (ohne WW)', 'kWh'],
    WW_Energie_heute:       ['Waerme heute Warmwasser', 'kWh'],
    Oel_heute:              ['Heizoel heute (geschaetzt)', 'l'],
    Starts_heute:           ['Brenner Starts heute', ''],
    Aussen_Mittel_heute:    ['Aussentemperatur Mittel heute', '°C'],
    Tag_Heizenergie:        ['Tageswert Waerme Heizung', 'kWh'],
    Tag_WW_Energie:         ['Tageswert Waerme Warmwasser', 'kWh'],
    Tag_Heizleistung:       ['Tageswert Ø Heizleistung', 'kW'],
    Tag_Aussen_Mittel:      ['Tageswert Aussentemperatur Mittel', '°C'],
    Tag_Laufzeit:           ['Tageswert Brennerlaufzeit', 'h'],
    Tag_Starts:             ['Tageswert Brennerstarts', ''],
    Heizlast_Norm:          ['Heizlast bei Normaussentemperatur (Regression)', 'kW'],
    WP_Bedarf:              ['Benoetigte WP-Leistung bei θNA (inkl. WW)', 'kW'],
    Bivalenzpunkt_10kW:     ['Aussentemp., ab der die WP nicht mehr reicht', '°C'],
    Regression_Tage:        ['Anzahl Tage in der Regression', ''],
};
for (const [k, [name, unit]] of Object.entries(NUM)) {
    createState(BASE + k, 0, { name, type: 'number', role: 'value', unit, read: true, write: false });
}
createState(BASE + 'Tageswerte', '[]', { name: 'Tageswerte (JSON, fuer Regression)', type: 'string', role: 'json', read: true, write: false });
createState(BASE + 'WP_Bewertung', '', { name: 'Bewertung Waermepumpe', type: 'string', role: 'text', read: true, write: false });

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

// zeitgewichteter Mittelwert
function twMean(pts, start, end) {
    let v = null, t = start, sum = 0, dur = 0;
    for (const p of pts) {
        if (p.ts <= start) { v = Number(p.val); continue; }
        if (p.ts > end) break;
        if (v !== null) { sum += v * (p.ts - t); dur += p.ts - t; }
        v = Number(p.val); t = p.ts;
    }
    if (v !== null) { sum += v * (end - t); dur += end - t; }
    return dur ? sum / dur : null;
}

// Laufzeiten im Intervall: gesamt, waehrend WW-Ladung, Heizbetrieb, Starts
async function stats(start, end) {
    const [p1, p5, pt] = await Promise.all([getHist(R1, start, end), getHist(R5, start, end), getHist(T2, start, end)]);
    const a = steps(p1, start, end), b = steps(p5, start, end);
    const ev = a.ev.map(e => [e[0], 'b', e[1]]).concat(b.ev.map(e => [e[0], 'w', e[1]])).sort((x, y) => x[0] - y[0]);
    let br = a.init, ww = b.init, t = start, on = 0, onWW = 0, starts = 0;
    const acc = (until) => { const d = until - t; if (br) { on += d; if (ww) onWW += d; } t = until; };
    for (const [ts, k, v] of ev) {
        acc(ts);
        if (k === 'b') { if (!br && v) starts++; br = v; } else { ww = v; }
    }
    acc(end);
    const covered = p1.filter(p => p.ts > start && p.ts <= end).length;
    return {
        hOn: on / 3600000, hWW: onWW / 3600000, starts,
        qAll: BURNER_KW * ETA * on / 3600000,
        qWW: BURNER_KW * ETA * onWW / 3600000,
        qHeat: BURNER_KW * ETA * (on - onWW) / 3600000,
        tMean: twMean(pt, start, end),
        covered,
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
    if (today.tMean !== null) setState(BASE + 'Aussen_Mittel_heute', r1(today.tMean), true);
}

// ----------------------------- Tageswerte + Regression ---------------------------
function loadDays() { try { return JSON.parse(getState(BASE + 'Tageswerte').val || '[]'); } catch (e) { return []; } }

async function closeDay(dayStart) {
    const key = dayKey(dayStart);
    const days = loadDays();
    if (days.some(d => d.d === key)) return false;
    const st = await stats(dayStart, dayStart + DAY);
    // nur vollstaendig erfasste Tage (Relais wird mind. alle 10 min geloggt -> >= 120 Punkte)
    if (st.covered < 120 || st.tMean === null) return false;
    const rec = { d: key, t: r1(st.tMean), qh: r1(st.qHeat), qw: r1(st.qWW), h: r1(st.hOn, 2), s: st.starts };
    days.push(rec);
    days.sort((a, b) => a.d.localeCompare(b.d));
    while (days.length > 180) days.shift();
    setState(BASE + 'Tageswerte', JSON.stringify(days), true);
    const noon = dayStart + DAY / 2;   // Tageswert mittags einloggen -> Balken sitzen auf dem Tag
    setState(BASE + 'Tag_Heizenergie', { val: rec.qh, ack: true, ts: noon });
    setState(BASE + 'Tag_WW_Energie', { val: rec.qw, ack: true, ts: noon });
    setState(BASE + 'Tag_Heizleistung', { val: r1(rec.qh / 24, 2), ack: true, ts: noon });
    setState(BASE + 'Tag_Aussen_Mittel', { val: rec.t, ack: true, ts: noon });
    setState(BASE + 'Tag_Laufzeit', { val: rec.h, ack: true, ts: noon });
    setState(BASE + 'Tag_Starts', { val: rec.s, ack: true, ts: noon });
    log(`Heizung Tageswert ${key}: Aussen ${rec.t} °C, Heizung ${rec.qh} kWh, WW ${rec.qw} kWh, Laufzeit ${rec.h} h`);
    return true;
}

function regression() {
    const pts = loadDays().filter(d => d.t < HEIZGRENZE).map(d => [d.t, d.qh / 24]);
    setState(BASE + 'Regression_Tage', pts.length, true);
    const ww = PERSONS * 0.25;
    let txt, pNA = null;
    if (pts.length >= 3 && Math.max(...pts.map(p => p[0])) - Math.min(...pts.map(p => p[0])) >= 3) {
        const n = pts.length, mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
        const sxy = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0), sxx = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
        const b = sxy / sxx, a = my - b * mx;
        pNA = a + b * THETA_NA;
        const tBiv = b < 0 ? (WP_KW - ww - a) / b : null;
        setState(BASE + 'Bivalenzpunkt_10kW', tBiv === null ? 0 : r1(tBiv), true);
        txt = `Regression aus ${n} Tagen`;
    } else if (pts.length >= 1) {
        // Fallback: Verhaeltnisverfahren je Tag, Mittelwert
        const est = pts.filter(p => p[0] < THETA_I - 3).map(p => p[1] * (THETA_I - THETA_NA) / (THETA_I - p[0]));
        if (est.length) pNA = est.reduce((s, v) => s + v, 0) / est.length;
        txt = `vorläufig (${pts.length} Tag${pts.length > 1 ? 'e' : ''}, Hochrechnung)`;
    }
    if (pNA === null) {
        setState(BASE + 'WP_Bewertung', 'Noch keine vollständigen Tage – Bewertung ab dem ersten vollen Tag (Logging seit 07.11.2026).', true);
        return;
    }
    const need = pNA + ww;
    setState(BASE + 'Heizlast_Norm', r1(pNA), true);
    setState(BASE + 'WP_Bedarf', r1(need), true);
    let verdict;
    if (need <= WP_KW * 0.9) verdict = `reicht (Reserve ${r1(WP_KW - need)} kW)`;
    else if (need <= WP_KW * 1.1) verdict = 'knapp – an den kältesten Tagen Heizstab (monoenergetisch)';
    else verdict = `reicht allein nicht – Heizstab/Bivalenz nötig (Fehlbetrag ${r1(need - WP_KW)} kW)`;
    setState(BASE + 'WP_Bewertung',
        `${WP_KW} kW WP: ${verdict}. Heizlast bei ${THETA_NA} °C ≈ ${r1(pNA)} kW + WW ${r1(ww)} kW = ${r1(need)} kW (${txt}).`, true);
}

async function dailyJob() {
    // alle noch fehlenden vollen Tage der letzten 30 Tage abschliessen (auch Nachtrag nach Neustart)
    const today = midnightOf(Date.now());
    for (let d = today - 30 * DAY; d < today; d += DAY) await closeDay(d);
    regression();
}

schedule('* * * * *', () => { updateLive().catch(e => log('Heizung live: ' + e, 'warn')); });
schedule('5 0 * * *', () => { dailyJob().catch(e => log('Heizung Tag: ' + e, 'warn')); });
on({ id: R1, change: 'ne' }, () => setTimeout(() => updateLive().catch(() => {}), 3000));
setTimeout(() => { updateLive().catch(() => {}); dailyJob().catch(e => log('Heizung Tag: ' + e, 'warn')); }, 5000);
