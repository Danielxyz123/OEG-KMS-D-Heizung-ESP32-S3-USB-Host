// =============================================================================
// Heizkurve – tägliche Auswertung (witterungsgeführte Fußbodenheizung)
// =============================================================================
// Jeden Morgen um 06:10 wird für die letzten 24 h (06:00 gestern bis 06:00 heute) erfasst:
//   - Außentemperatur gedämpft (t2_set) und roh (t2), zeitgewichtete Mittel
//   - Vorlauf soll / ist der FBH (flow_set / t4)
//   - eingestellte Heizkurve (Mitschrift 0_userdata.0.Heizung.Regler.Heizkurve)
//   - Wohnzimmer 03:00–06:00 heute (ohne Sonne, Kochen, Lüften), zeitgewichtet, mit Lüftungsfilter:
//     fällt die Temperatur in 30 min um >= 0,5 K, zählen die Werte ab dem Abfall
//     bis 60 min danach nicht mit
// Aus allen gespeicherten Tagen wird die Steigung Raum über Außen berechnet:
//   Raum bleibt gleich   → Steigung der Heizkurve passt
//   Raum kühler bei Kälte → Heizkurve zu flach
//   Raum wärmer bei Kälte → Heizkurve zu steil
// Bewertet werden nur Tage mit der AKTUELLEN Heizkurve, ab dem 3. Tag nach einer Änderung
// (Estrich eingeschwungen) – sonst würde eine Niveauänderung als falsche Steigung erscheinen.
// Brennerwerte liefert das Skript Heizung_Brennerleistung (hier nicht mehr doppelt berechnet, 20.11.2026).
// Ergebnisse: 0_userdata.0.Heizung.Kurve.*  (Historie als JSON, max. 90 Tage)
// Beim Start werden die letzten 14 Tage aus der InfluxDB nachgetragen.
// =============================================================================

const HIST      = 'influxdb.0';
const ID = {
    aussenGed: 'mqtt.0.oeg_kmsd.t2_set',
    aussen:    'mqtt.0.oeg_kmsd.t2',
    vlSoll:    'mqtt.0.oeg_kmsd.flow_set',
    vlIst:     'mqtt.0.oeg_kmsd.t4',
    wz:        'mqtt.0.sensor1.temperature',
};
const KURVE_ID        = '0_userdata.0.Heizung.Regler.Heizkurve';
const SETTLE_TAGE     = 2;      // Tag der Änderung + 2 Folgetage nicht bewerten (wie Heizung_Brennerleistung)
const ZIEL_RAUM       = 20.0;   // gewünschte Wohnzimmertemperatur morgens [°C]
const K_VL_PRO_K_RAUM = 1.7;    // gemessen 18.–20.11.2026: +1 K Vorlauf ≈ +0,6 K Raum
const MIN_TAGE        = 7;      // so viele gültige Tage braucht die Bewertung mindestens
const MIN_SPANNE_K    = 4;      // und so viel Spanne der Außentemperatur
const MAX_TAGE        = 90;
const NACHTRAG_TAGE   = 14;
const MAX_ALTER_RAUM  = 6 * 3600 * 1000;  // älterer Raumwert gilt als veraltet (InfluxDB loggt nur Änderungen)

const P = '0_userdata.0.Heizung.Kurve.';
const DPS = {
    Historie:       ['[]', { name: 'Tageswerte Heizkurve (JSON)', type: 'string', role: 'json' }],
    Letzter_Tag:    ['{}', { name: 'Letzter Tageswert (JSON)', type: 'string', role: 'json' }],
    WZ_morgens:     [0,    { name: 'Wohnzimmer 3–6 Uhr', type: 'number', unit: '°C', role: 'value.temperature' }],
    Aussen_ged_24h: [0,    { name: 'Außen gedämpft, Mittel 24 h', type: 'number', unit: '°C', role: 'value.temperature' }],
    VL_soll_24h:    [0,    { name: 'Vorlauf soll, Mittel 24 h', type: 'number', unit: '°C', role: 'value.temperature' }],
    Steigung_Raum:  [0,    { name: 'Raum über Außen [K/K]', type: 'number', unit: 'K/K', role: 'value' }],
    Gueltige_Tage:  [0,    { name: 'Gültige Tage in der Bewertung', type: 'number', role: 'value' }],
    Bewertung:      ['',   { name: 'Bewertung der Heizkurve', type: 'string', role: 'text' }],
};
for (const [k, [def, common]] of Object.entries(DPS)) {
    if (!existsObject(P + k)) createState(P + k, def, Object.assign({ read: true, write: false }, common));
}

const H = 3600 * 1000;

function historie(id, start, ende) {
    return new Promise((resolve) => {
        sendTo(HIST, 'getHistory', {
            id, options: { start, end: ende, aggregate: 'none', count: 500000, ignoreNull: true }
        }, (r) => {
            const pts = ((r && r.result) || [])
                .filter(p => p.val !== null && p.val !== undefined && p.val !== '' && !isNaN(Number(p.val)))
                .map(p => ({ ts: p.ts, val: Number(p.val) }))
                .sort((a, b) => a.ts - b.ts);
            resolve(pts);
        });
    });
}

// Zeitgewichtetes Mittel (Wert gilt bis zum nächsten Punkt). Liefert null ohne Daten.
function zeitMittel(pts, start, ende) {
    let wert = null, t = start, summe = 0, dauer = 0;
    for (const p of pts) {
        if (p.ts <= start) { wert = p.val; continue; }
        if (p.ts >= ende) break;
        if (wert !== null) { summe += wert * (p.ts - t); dauer += p.ts - t; }
        wert = p.val; t = p.ts;
    }
    if (wert !== null) { summe += wert * (ende - t); dauer += ende - t; }
    return dauer > 0.5 * (ende - start) ? summe / dauer : null;
}

// Heizkurven-Mitschrift (Text "0,50 / +5,2 K"): Wert zu einem Zeitpunkt und Zeitpunkte der Änderungen
let kurveCache = null;
function kurveLaden() {
    return new Promise((resolve) => {
        sendTo(HIST, 'getHistory', {
            id: KURVE_ID, options: { start: Date.now() - MAX_TAGE * 24 * H, end: Date.now(), aggregate: 'none', count: 100000, ignoreNull: true }
        }, (r) => {
            const pts = ((r && r.result) || []).filter(p => p.val).sort((a, b) => a.ts - b.ts);
            const changes = [];
            let prev;
            for (const p of pts) { if (prev !== undefined && p.val !== prev) changes.push(p.ts); prev = p.val; }
            resolve({ pts, changes });
        });
    });
}
function kurveAm(k, ts) { let v = null; for (const p of k.pts) { if (p.ts > ts) break; v = p.val; } return v; }

// Wohnzimmer morgens, zeitgewichtet (InfluxDB loggt nur Änderungen), gelüftete Abschnitte entfernt.
// Abgetastet wird minütlich: Wert = letzter Messwert davor.
function raumMorgens(pts, start, ende) {
    const sperre = [];                              // [von, bis]
    for (let i = 0; i < pts.length; i++) {
        for (let j = i - 1; j >= 0 && pts[i].ts - pts[j].ts <= 30 * 60000; j--) {
            if (pts[j].val - pts[i].val >= 0.5) { sperre.push([pts[j].ts, pts[i].ts + 60 * 60000]); break; }
        }
    }
    let k = -1, summe = 0, gut = 0, gesperrt = 0, minuten = 0;
    for (let t = start; t < ende; t += 60000) {
        minuten++;
        while (k + 1 < pts.length && pts[k + 1].ts <= t) k++;
        if (k < 0 || t - pts[k].ts > MAX_ALTER_RAUM) continue;   // kein Wert oder veraltet (Sensor aus)
        if (sperre.some(([a, b]) => t >= a && t <= b)) { gesperrt++; continue; }
        summe += pts[k].val; gut++;
    }
    if (gut < 0.5 * minuten) return null;
    return { wert: summe / gut, gefiltert: gesperrt };          // gefiltert = gesperrte Minuten
}

const r1 = (x) => x === null ? null : Math.round(x * 10) / 10;

// Tageswert für den Morgen des Datums d (lokale Zeit)
async function tagErfassen(d) {
    const ende  = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 6, 0, 0).getTime();
    const start = ende - 24 * H;
    const morgenStart = ende - 3 * H;
    const lade = (id) => historie(id, start - 12 * H, ende);
    const [ag, a, vs, vi, wz] = await Promise.all([ID.aussenGed, ID.aussen, ID.vlSoll, ID.vlIst, ID.wz].map(lade));
    const raum = raumMorgens(wz, morgenStart, ende);
    if (!kurveCache) kurveCache = await kurveLaden();
    return {
        datum: formatDate(ende, 'YYYY-MM-DD'),
        aussenGed: r1(zeitMittel(ag, start, ende)),
        aussen:    r1(zeitMittel(a, start, ende)),
        vlSoll:    r1(zeitMittel(vs, start, ende)),
        vlIst:     r1(zeitMittel(vi, start, ende)),
        wzMorgens: raum ? Math.round(raum.wert * 100) / 100 : null,
        wzGefiltert: raum ? raum.gefiltert : null,
        kurve: kurveAm(kurveCache, ende),
        eingeschwungen: !kurveCache.changes.some(c => c > start - SETTLE_TAGE * 24 * H && c <= ende),
    };
}

function bewerten(liste) {
    const aktuell = (getState(KURVE_ID) || {}).val || null;
    const g = liste.filter(t => t.wzMorgens !== null && t.aussenGed !== null && t.eingeschwungen === true && aktuell && t.kurve === aktuell);
    setState(P + 'Gueltige_Tage', g.length, true);
    if (g.length < MIN_TAGE) {
        setState(P + 'Bewertung', `Noch zu wenig Daten mit der aktuellen Heizkurve ${aktuell || '?'}: ` +
            `${g.length} von ${MIN_TAGE} gültigen Tagen (Tag der Änderung + ${SETTLE_TAGE} Folgetage zählen nicht)`, true);
        return;
    }
    const xs = g.map(t => t.aussenGed), ys = g.map(t => t.wzMorgens);
    const mx = xs.reduce((s, x) => s + x, 0) / g.length, my = ys.reduce((s, y) => s + y, 0) / g.length;
    const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    const spanne = Math.max(...xs) - Math.min(...xs);
    const niveau = (ZIEL_RAUM - my) * K_VL_PRO_K_RAUM;
    const niveauText = Math.abs(my - ZIEL_RAUM) <= 0.3 ? 'Niveau passt'
        : `Niveau ${niveau > 0 ? 'anheben' : 'absenken'} um ca. ${Math.abs(niveau).toFixed(1)} K Vorlauf`;
    if (spanne < MIN_SPANNE_K || sxx === 0) {
        setState(P + 'Bewertung', `Raum morgens im Mittel ${my.toFixed(1)} °C (Ziel ${ZIEL_RAUM}) → ${niveauText}. ` +
            `Steigung noch nicht bewertbar: Außen-Spanne erst ${spanne.toFixed(1)} K (mind. ${MIN_SPANNE_K} K)`, true);
        return;
    }
    const b = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / sxx;
    setState(P + 'Steigung_Raum', Math.round(b * 1000) / 1000, true);
    const steigText = Math.abs(b) <= 0.05 ? 'Steigung passt'
        : b > 0 ? `Heizkurve zu flach (Raum ${(b * 10).toFixed(1)} K kühler je 10 K kälter) → Steigung erhöhen`
                : `Heizkurve zu steil (Raum ${(-b * 10).toFixed(1)} K wärmer je 10 K kälter) → Steigung verringern`;
    setState(P + 'Bewertung', `Heizkurve ${aktuell}, ${g.length} Tage, Außen ${Math.min(...xs).toFixed(1)}…${Math.max(...xs).toFixed(1)} °C: ` +
        `${steigText}. Raum morgens Ø ${my.toFixed(1)} °C (Ziel ${ZIEL_RAUM}) → ${niveauText}`, true);
}

function listeLesen() {
    try { return JSON.parse(getState(P + 'Historie').val || '[]'); } catch (e) { return []; }
}

function speichern(liste) {
    liste.sort((a, b) => a.datum < b.datum ? -1 : 1);
    while (liste.length > MAX_TAGE) liste.shift();
    setState(P + 'Historie', JSON.stringify(liste), true);
    const t = liste[liste.length - 1];
    if (t) {
        setState(P + 'Letzter_Tag', JSON.stringify(t), true);
        if (t.wzMorgens !== null) setState(P + 'WZ_morgens', t.wzMorgens, true);
        if (t.aussenGed !== null) setState(P + 'Aussen_ged_24h', t.aussenGed, true);
        if (t.vlSoll !== null) setState(P + 'VL_soll_24h', t.vlSoll, true);
    }
    bewerten(liste);
}

// Der heutige Morgen ist erst ab 06:00 vollständig
function heuteFertig() {
    const j = new Date();
    return j.getHours() >= 6;
}

async function tagesLauf(tageZurueck) {
    kurveCache = await kurveLaden();
    const liste = listeLesen();
    for (let i = tageZurueck; i >= (heuteFertig() ? 0 : 1); i--) {
        const d = new Date(Date.now() - i * 24 * H);
        const t = await tagErfassen(d);
        if (t.aussenGed === null && t.wzMorgens === null) continue;     // keine Daten
        const alt = liste.findIndex(x => x.datum === t.datum);
        if (alt >= 0) liste[alt] = t; else liste.push(t);
        log(`Heizkurve ${t.datum}: außen ${t.aussenGed} °C, VL ${t.vlSoll}/${t.vlIst}, WZ morgens ${t.wzMorgens}` +
            (t.wzGefiltert ? ` (${t.wzGefiltert} min gelüftet)` : '') + `, Kurve ${t.kurve}${t.eingeschwungen ? '' : ' (nicht eingeschwungen)'}`, 'info');
    }
    speichern(liste);
    log('Heizkurve: ' + getState(P + 'Bewertung').val, 'info');
}

schedule('10 6 * * *', () => tagesLauf(0).catch(e => log('Heizkurve: ' + e, 'error')));
// Nachtrag beim Start
setTimeout(() => tagesLauf(NACHTRAG_TAGE).catch(e => log('Heizkurve: ' + e, 'error')), 3000);
log('🌡️ Heizkurven-Auswertung gestartet', 'info');
