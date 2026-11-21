// ioBroker JavaScript-Adapter: Warmwasser-Zapfung aus den Speicherfuehlern erkennen
// Grundlage (Messung 7./8.11.2026, OEG KMS-D):
//   t5 = Speicher oben, t6 = Speicher unten, r5 = Speicherladung, r6 = Solarpumpe
//   Zapfung:      t5 faellt schnell (Duschen ~1 K/min) UND t6 faellt (Kaltwasser von unten)
//   Zirkulation:  nur t5 faellt langsamer (~0,1-0,2 K/min), t6 bleibt konstant
//   Kalibrierung: vom Kessel beheizte Zone ~160 l -> 1 K an t5 ~ 0,19 kWh
// Kleine Zapfungen (Haendewaschen) sind mit diesen Fuehlern nicht sicher erkennbar.

const T5 = 'mqtt.0.oeg_kmsd.t5';
const T6 = 'mqtt.0.oeg_kmsd.t6';
const R5 = 'mqtt.0.oeg_kmsd.relay.r5';
const R6 = 'mqtt.0.oeg_kmsd.relay.r6';
const P  = '0_userdata.0.Heizung.Warmwasser.';

// Parameter (bei Bedarf anpassen)
const ZONE_L          = 160;   // Liter, beheizte Zone oben
const T_KALT          = 10;    // Kaltwassertemperatur °C
const T_DUSCHE        = 38;    // Mischtemperatur fuer Literangabe
const FENSTER_MIN     = 5;     // Betrachtungsfenster fuer Abfall-Rate
const START_STARK_K   = 1.5;   // t5-Abfall im Fenster -> sichere Zapfung
const START_MITTEL_K  = 0.6;   // t5-Abfall im Fenster ...
const T6_ABFALL_K     = 0.3;   // ... plus t6-Abfall innerhalb 10 min -> Zapfung
const ENDE_RATE_K_MIN = 0.1;   // Zapfung endet, wenn t5 langsamer faellt als das
const ENDE_RUHE_MIN   = 3;

const defs = {
    Zapfung_aktiv:      { type: 'boolean', def: false, unit: '',    name: 'Warmwasser wird gerade gezapft' },
    Zapfung_Start:      { type: 'string',  def: '',    unit: '',    name: 'Start der letzten Zapfung' },
    Letzte_Dauer_min:   { type: 'number',  def: 0,     unit: 'min', name: 'Dauer der letzten Zapfung' },
    Letzte_Energie_kWh: { type: 'number',  def: 0,     unit: 'kWh', name: 'Energie der letzten Zapfung' },
    Letzte_Liter_38:    { type: 'number',  def: 0,     unit: 'l',   name: 'Letzte Zapfung als Liter bei 38 °C' },
    Zapfungen_heute:    { type: 'number',  def: 0,     unit: '',    name: 'Erkannte Zapfungen heute' },
    Energie_heute_kWh:  { type: 'number',  def: 0,     unit: 'kWh', name: 'Gezapfte Energie heute' },
    Liter_heute_38:     { type: 'number',  def: 0,     unit: 'l',   name: 'Gezapfte Liter heute bei 38 °C' },
    Zirkulation_Signal: { type: 'boolean', def: false, unit: '',    name: 'Zirkulation vermutlich aktiv (nur t5 faellt)' },
};
for (const [id, d] of Object.entries(defs)) {
    createState(P + id, d.def, { name: d.name, type: d.type, unit: d.unit, read: true, write: false });
}

const hist5 = [], hist6 = [];   // [ts, wert]
let zapfung = null;             // { start, t5Start }
let lastFastTs = 0;
let sperreBis = 0;              // nach einer Zapfung kurz keine neue erkennen (Doppelzaehlung)

const kWhProK = ZONE_L * 1.163 / 1000;
const literProKWh = 1 / ((T_DUSCHE - T_KALT) * 1.163 / 1000);

function push(arr, ts, v) {
    arr.push([ts, v]);
    while (arr.length && ts - arr[0][0] > 15 * 60000) arr.shift();
}
function wertVor(arr, ts, minuten) {
    let v = null;
    for (const [t, w] of arr) { if (t <= ts - minuten * 60000) v = w; else break; }
    return v !== null ? v : (arr.length ? arr[0][1] : null);
}
function aktiv(id) { const s = getState(id); return s && Number(s.val) === 1; }

function pruefen(ts) {
    if (hist5.length < 2) return;
    const t5 = hist5[hist5.length - 1][1];
    const t5vor = wertVor(hist5, ts, FENSTER_MIN);
    const t6 = hist6.length ? hist6[hist6.length - 1][1] : null;
    const t6vor = hist6.length ? wertVor(hist6, ts, 10) : null;
    const abfall5 = t5vor - t5;
    const abfall6 = (t6 !== null && t6vor !== null) ? t6vor - t6 : 0;
    const laden = aktiv(R5), solar = aktiv(R6);

    if (!zapfung) {
        if (laden || ts < sperreBis) return; // waehrend der Ladung steigt t5; Sperre nach Zapfung
        const stark  = abfall5 >= START_STARK_K;
        const mittel = abfall5 >= START_MITTEL_K && !solar && abfall6 >= T6_ABFALL_K;
        if (stark || mittel) {
            zapfung = { start: ts, t5Start: t5vor };
            lastFastTs = ts;
            setState(P + 'Zapfung_aktiv', true, true);
            setState(P + 'Zapfung_Start', formatDate(new Date(ts), 'DD.MM. hh:mm'), true);
            setState(P + 'Zirkulation_Signal', false, true);
        } else {
            // nur t5 faellt, t6 stabil -> Zirkulation
            const zirk = abfall5 >= 0.4 && Math.abs(abfall6) < 0.2;
            if (getState(P + 'Zirkulation_Signal').val !== zirk) setState(P + 'Zirkulation_Signal', zirk, true);
        }
        return;
    }

    // laufende Zapfung: Ende bei Ruhe oder Ladestart
    const rate = (wertVor(hist5, ts, 1) - t5); // K pro Minute
    if (rate >= ENDE_RATE_K_MIN) lastFastTs = ts;
    if (laden || ts - lastFastTs >= ENDE_RUHE_MIN * 60000) beenden(ts, t5);
}

function beenden(ts, t5) {
    const dT = Math.max(0, zapfung.t5Start - t5);
    const kWh = Math.round(dT * kWhProK * 100) / 100;
    const liter = Math.round(kWh * literProKWh);
    const dauer = Math.round((ts - zapfung.start) / 6000) / 10;
    setState(P + 'Zapfung_aktiv', false, true);
    setState(P + 'Letzte_Dauer_min', dauer, true);
    setState(P + 'Letzte_Energie_kWh', kWh, true);
    setState(P + 'Letzte_Liter_38', liter, true);
    setState(P + 'Zapfungen_heute', getState(P + 'Zapfungen_heute').val + 1, true);
    setState(P + 'Energie_heute_kWh', Math.round((getState(P + 'Energie_heute_kWh').val + kWh) * 100) / 100, true);
    setState(P + 'Liter_heute_38', getState(P + 'Liter_heute_38').val + liter, true);
    log(`Warmwasser-Zapfung: ${dauer} min, t5 -${dT.toFixed(1)} K, ~${kWh} kWh, ~${liter} l bei ${T_DUSCHE} °C`);
    zapfung = null;
    sperreBis = ts + FENSTER_MIN * 60000;
}

on({ id: T5, change: 'ne' }, (o) => { push(hist5, o.state.ts, Number(o.state.val)); pruefen(o.state.ts); });
on({ id: T6, change: 'ne' }, (o) => { push(hist6, o.state.ts, Number(o.state.val)); pruefen(o.state.ts); });
on({ id: R5, change: 'ne' }, (o) => { if (zapfung && Number(o.state.val) === 1) beenden(o.state.ts, hist5.length ? hist5[hist5.length - 1][1] : zapfung.t5Start); });

// Tageswerte um Mitternacht zuruecksetzen
schedule('0 0 * * *', () => {
    setState(P + 'Zapfungen_heute', 0, true);
    setState(P + 'Energie_heute_kWh', 0, true);
    setState(P + 'Liter_heute_38', 0, true);
});
