// Heizung_Heizlast_Vergleich (Version 2, 20.11.2026)
// Stellt drei UNABHAENGIGE Verfahren fuer die Heizlast bei Normaussentemperatur nebeneinander.
// Rechnet nichts doppelt: die Messung kommt fertig aus "Heizung_Brennerleistung".
//
//   A  Messung Brennerlaufzeit   -> Werte aus 0_userdata.0.Heizung.* (Skript Heizung_Brennerleistung)
//   B  Jahres-Oelverbrauch        -> Oel x Heizwert x Nutzungsgrad - Warmwasser, geteilt durch echte Gradtage
//   C  Raumweise Berechnung       -> eigene Berechnung Okt. 2026 (Documents\Heizleistungsberechnung)
//
// Schreibt nur unter 0_userdata.0.Heizung.Vergleich.* – liest alles andere nur.
// Ersetzt keine Heizlastberechnung nach DIN EN 12831.

// ----------------------------- Annahmen (anpassen) -----------------------------
const THETA_I = 20, THETA_NA = -10;   // wie Heizung_Brennerleistung
// B: Oelverbrauch je Winter und Gradtagzahl G20/15 (VDI 3807) desselben Zeitraums.
//    Gradtage: DWD Open Data hdd_3807, Mittel der Stationen Bielefeld-Deppendorf und Belm (je ca. 17 km von Melle).
//    Saison Jul 2025-Jun 2026: 3321 / 3247 -> 3280 Kd; Mittel 2016-2025: 3232 / 3170 -> 3200 Kd.
const OIL = [
    { label: 'Winter 2025/26', liter: 2300, gtz: 3280 },
    { label: 'früherer Winter', liter: 2400, gtz: 3200 },   // Jahr unbekannt -> 10-Jahres-Mittel
];
const OIL_KWH_L = 10;                     // Heizwert Heizoel EL
const ETA_YEAR = [0.85, 0.88, 0.91];      // Jahresnutzungsgrad Kessel min/wahrsch./max
const WW_KWH_YEAR = [2800, 2400, 2000];   // Warmwasser aus Oel je Jahr (Solar entlastet im Sommer), passend zu min/wahrsch./max
const GTZ_TOL = 50;                       // Unsicherheit Gradtage (Stationsmittel statt Melle)
// C: Raumweise Berechnung (Schreen_ExportHeizlast.xlsx), Zustand NACH Dachausbau (EG ohne Deckenverlust)
const ROOM = {
    eg: 8.34, dg: 2.98,                   // kW, Summe der Raumheizlasten
    ventEg: 1.94, ventDg: 1.52,           // davon Lueftung (n = 0,5/h in jedem Raum)
    areaEg: 153.1, areaDg: 118.5,
};
const VENT_SIMULT = 0.5;                  // Gebaeude: Lueftung nicht in allen Raeumen gleichzeitig (Naeherung)
const CEILING_KW = 0.5;                   // heutiger Verlust EG-Decke -> Dachboden (entfaellt nach Ausbau, wie in DG_ZUSATZ)
// --------------------------------------------------------------------------------

const SRC = '0_userdata.0.Heizung.';
const BASE = SRC + 'Vergleich.';
const r1 = (v, d = 1) => (v === null || v === undefined || !isFinite(v)) ? null : Math.round(v * 10 ** d) / 10 ** d;
const num = (id) => { const s = getState(SRC + id); return s && s.val !== null && s.val !== '' && isFinite(Number(s.val)) ? Number(s.val) : null; };

const NUM = {
    Messung_EG:        ['A Messung: Heizlast EG heute bei θNA', 'kW'],
    Messung_EG_min:    ['A Messung: untere Grenze', 'kW'],
    Messung_EG_max:    ['A Messung: obere Grenze', 'kW'],
    Oel_EG:            ['B Ölverbrauch: Heizlast EG heute bei θNA', 'kW'],
    Oel_EG_min:        ['B Ölverbrauch: untere Grenze', 'kW'],
    Oel_EG_max:        ['B Ölverbrauch: obere Grenze', 'kW'],
    Oel_H:             ['B Ölverbrauch: Wärmeverlust H (bezogen auf 20 °C innen)', 'W/K'],
    Raum_EG:           ['C Raumweise: EG nach Ausbau (ohne Deckenverlust)', 'kW'],
    Raum_DG:           ['C Raumweise: DG', 'kW'],
    Raum_Summe:        ['C Raumweise: Summe aller Räume', 'kW'],
    Raum_Gebaeude:     ['C Raumweise: Gebäudeheizlast (Lüftung × 0,5, Näherung)', 'kW'],
    DG_Zuschlag:       ['DG-Zuschlag aus Heizung_Brennerleistung', 'kW'],
    WW_Zuschlag:       ['WW-Zuschlag aus Heizung_Brennerleistung', 'kW'],
    Ausbau_Messung:    ['Nach Ausbau inkl. WW – Messung', 'kW'],
    Ausbau_Oel:        ['Nach Ausbau inkl. WW – Ölverbrauch', 'kW'],
    Ausbau_Raum:       ['Nach Ausbau inkl. WW – raumweise (Gebäude)', 'kW'],
};
const STR = {
    Tabelle_JSON: ['Vergleichstabelle (JSON)', 'json'],
    Tabelle_HTML: ['Vergleichstabelle (HTML fuer VIS)', 'html'],
    Bewertung:    ['Bewertung Vergleich', 'text'],
    Streudiagramm_HTML: ['Heizleistung ueber Aussentemperatur (SVG fuer VIS)', 'html'],
    Letzter_Lauf: ['Letzte Auswertung', 'text'],
};

async function ensureStates() {
    const mk = (id, def, common) => new Promise((res) => createState(id, def, common, () => res()));
    for (const [k, [name, unit]] of Object.entries(NUM)) await mk(BASE + k, 0, { name, type: 'number', role: 'value', unit, read: true, write: false });
    for (const [k, [name, role]] of Object.entries(STR)) await mk(BASE + k, '', { name, type: 'string', role, read: true, write: false });
}

// B: Heizlast aus einem Winter. i = 0 min, 1 wahrsch., 2 max
function oilLoad(o, i) {
    const gtz = o.gtz + (i === 0 ? GTZ_TOL : i === 2 ? -GTZ_TOL : 0);
    const q = o.liter * OIL_KWH_L * ETA_YEAR[i] - WW_KWH_YEAR[i];   // kWh Heizwaerme
    const H = q / (gtz * 24);                                        // kW/K, bezogen auf θi = 20 °C (G20/15)
    return { q, H, p: H * (THETA_I - THETA_NA) };
}

// ----------------------------- Streudiagramm --------------------------------------
// x = Tagesmittel aussen, y = mittlere Heizleistung des Tages; Modellgerade bis θNA, Spanne,
// Linie "nach Ausbau inkl. WW", WP-Leistung, Bivalenzpunkt, Verfahren A/B bei θNA.
const de = (v, d = 1) => v.toFixed(d).replace('.', ',');
function scatterSvg(o) {
    const W = 1190, Hh = 380, L = 56, R = 250, T = 16, B = 40;
    const X0 = -16, X1 = 18, Y0 = 0, Y1 = 11;
    const px = (t) => L + (t - X0) / (X1 - X0) * (W - L - R);
    const py = (p) => Hh - B - (p - Y0) / (Y1 - Y0) * (Hh - T - B);
    const C = { grid: '#e3e9ee', axis: '#78909c', text: '#455a64', eg: '#e8663a', band: 'rgba(232,102,58,0.13)',
                dg: '#1d3c5a', wp: '#2e7d32', na: '#8e24aa', mess: 'rgba(66,165,245,0.10)', excl: '#90a4ae', oil: '#6d4c41' };
    const line = (pts, st) => `<polyline fill="none" points="${pts.map(([t, p]) => `${px(t).toFixed(1)},${py(p).toFixed(1)}`).join(' ')}" ${st}/>`;
    const txt = (x, y, s, st = '') => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" ${st}>${s}</text>`;
    const steps = []; for (let t = X0; t <= X1 + 1e-9; t += 0.5) steps.push(t);
    let s = `<svg viewBox="0 0 ${W} ${Hh}" width="100%" style="display:block;font:12px Segoe UI,Arial;fill:${C.text}" xmlns="http://www.w3.org/2000/svg">`;
    s += `<style>.h{paint-order:stroke;stroke:#fff;stroke-width:4px;stroke-linejoin:round}</style>`;
    s += `<defs><clipPath id="hlclip"><rect x="${L}" y="${T}" width="${W - L - R}" height="${Hh - T - B}"/></clipPath></defs>`;
    // Gitter + Achsen
    for (let t = X0; t <= X1; t += 2) s += `<line x1="${px(t)}" x2="${px(t)}" y1="${T}" y2="${Hh - B}" stroke="${C.grid}"/>` + txt(px(t), Hh - B + 16, de(t, 0), 'text-anchor="middle"');
    for (let p = Y0; p <= Y1; p += 1) s += `<line x1="${L}" x2="${W - R}" y1="${py(p)}" y2="${py(p)}" stroke="${C.grid}"/>` + txt(L - 6, py(p) + 4, de(p, 0), 'text-anchor="end"');
    s += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${Hh - T - B}" fill="none" stroke="${C.axis}"/>`;
    s += txt((L + W - R) / 2, Hh - 6, 'Außentemperatur Tagesmittel (°C)', 'text-anchor="middle"');
    s += txt(14, (T + Hh - B) / 2, 'Heizleistung (kW)', `text-anchor="middle" transform="rotate(-90 14 ${(T + Hh - B) / 2})"`);
    s += `<g clip-path="url(#hlclip)">`;
    // Messbereich
    const used = o.pts.filter(p => p.use);
    if (used.length) {
        const a = Math.min(...used.map(p => p.t)), b = Math.max(...used.map(p => p.t));
        s += `<rect x="${px(a)}" y="${T}" width="${Math.max(2, px(b) - px(a))}" height="${Hh - T - B}" fill="${C.mess}"/>`;
        s += txt(px((a + b) / 2), T + 14, 'gemessen', `text-anchor="middle" style="fill:#1e88e5"`);
        s += txt((px(o.na) + px(a)) / 2, T + 14, '← Hochrechnung', `text-anchor="middle" style="fill:#1e88e5"`);
    }
    // Spanne (Heizgrenze 20 / 15 °C) und Modell
    if (o.pMin !== null && o.pMax !== null) {
        const lo = (t) => Math.max(0, o.pMin * (20 - t) / (20 - o.na)), hi = (t) => Math.max(0, o.pMax * (15 - t) / (15 - o.na));
        const poly = steps.map(t => [t, lo(t)]).concat(steps.slice().reverse().map(t => [t, hi(t)]));
        s += `<polygon points="${poly.map(([t, p]) => `${px(t).toFixed(1)},${py(p).toFixed(1)}`).join(' ')}" fill="${C.band}"/>`;
    }
    const model = (t) => Math.max(0, o.H * (o.tb - t));
    s += line(steps.filter(t => t <= o.tb).map(t => [t, model(t)]), `stroke="${C.eg}" stroke-width="2.5"`);
    if (o.dgAdd !== null && o.wwAdd !== null) {
        const after = (t) => model(t) + o.dgAdd * Math.max(0, 20 - t) / (20 - o.na) + o.wwAdd;
        s += line(steps.filter(t => t <= o.tb).map(t => [t, after(t)]), `stroke="${C.dg}" stroke-width="2" stroke-dasharray="7 5"`);
    }
    if (o.wp) s += `<line x1="${L}" x2="${W - R}" y1="${py(o.wp)}" y2="${py(o.wp)}" stroke="${C.wp}" stroke-width="2"/>`;
    if (o.biv !== null && o.biv > X0 && o.biv < X1) s += `<line x1="${px(o.biv)}" x2="${px(o.biv)}" y1="${py(o.wp)}" y2="${Hh - B}" stroke="${C.wp}" stroke-dasharray="3 3"/>`;
    s += `<line x1="${px(o.na)}" x2="${px(o.na)}" y1="${T}" y2="${Hh - B}" stroke="${C.na}" stroke-dasharray="4 4"/>`;
    s += `</g>`;
    // Beschriftungen an θNA
    s += txt(px(o.na) + 4, Hh - B - 6, `θNA ${de(o.na, 0)} °C`, `class="h" style="fill:${C.na}"`);
    if (o.biv !== null && o.biv > X0) s += txt(px(o.biv) + 4, Hh - B - 22, `Bivalenz ${de(o.biv)} °C`, `class="h" style="fill:${C.wp}"`);
    if (o.wp) s += txt(px(X1) - 4, py(o.wp) - 5, `WP ${de(o.wp, 0)} kW`, `class="h" text-anchor="end" style="fill:${C.wp}"`);
    const pNA = model(o.na);
    s += `<circle cx="${px(o.na)}" cy="${py(pNA)}" r="5" fill="${C.eg}" stroke="#fff" stroke-width="1.5"/>`;
    s += txt(px(o.na) + 10, py(pNA) + 22, `EG heute ${de(pNA)} kW`, `class="h" style="fill:${C.eg};font-weight:600;font-size:13px"`);
    if (o.dgAdd !== null && o.wwAdd !== null) {
        const pa = pNA + o.dgAdd + o.wwAdd;
        s += `<circle cx="${px(o.na)}" cy="${py(pa)}" r="5" fill="${C.dg}" stroke="#fff" stroke-width="1.5"/>`;
        s += txt(px(o.na) + 10, py(pa) + 4, `nach Ausbau inkl. WW ${de(pa)} kW`, `class="h" style="fill:${C.dg};font-weight:600;font-size:13px"`);
    }
    // Verfahren A (Messung) und B (Oel) als Fehlerbalken bei θNA
    const bar = (x, a, b, m, col, lab) => a === null || b === null ? '' :
        `<line x1="${x}" x2="${x}" y1="${py(a)}" y2="${py(b)}" stroke="${col}" stroke-width="2"/>` +
        `<line x1="${x - 4}" x2="${x + 4}" y1="${py(a)}" y2="${py(a)}" stroke="${col}" stroke-width="2"/>` +
        `<line x1="${x - 4}" x2="${x + 4}" y1="${py(b)}" y2="${py(b)}" stroke="${col}" stroke-width="2"/>` +
        `<rect x="${x - 3}" y="${py(m) - 3}" width="6" height="6" fill="${col}"/>` + txt(x, py(b) - 6, lab, `class="h" text-anchor="middle" style="fill:${col};font-weight:600"`);
    s += bar(px(o.na) - 24, o.mMin, o.mMax, pNA, C.eg, 'A');
    s += bar(px(o.na) - 48, o.oMin, o.oMax, o.oEg, C.oil, 'B');
    // Tagespunkte
    for (const p of o.pts) {
        const tip = `<title>${p.d}: ${de(p.t)} °C, ${de(p.p, 2)} kW${p.use ? '' : ' – nicht verwendet: ' + p.why}</title>`;
        s += p.use
            ? `<circle cx="${px(p.t)}" cy="${py(p.p)}" r="5" fill="${C.eg}" stroke="#fff" stroke-width="1">${tip}</circle>`
            : `<circle cx="${px(p.t)}" cy="${py(p.p)}" r="5" fill="#fff" stroke="${C.excl}" stroke-width="2">${tip}</circle>`;
    }
    // Legende
    const lx = W - R + 18; let ly = T + 8;
    const leg = (sym, label) => { const r = sym(lx, ly) + txt(lx + 28, ly + 4, label); ly += 22; return r; };
    s += leg((x, y) => `<circle cx="${x + 10}" cy="${y}" r="5" fill="${C.eg}"/>`, 'Tag in der Rechnung');
    s += leg((x, y) => `<circle cx="${x + 10}" cy="${y}" r="5" fill="#fff" stroke="${C.excl}" stroke-width="2"/>`, 'Tag ausgelassen');
    s += leg((x, y) => `<line x1="${x}" x2="${x + 20}" y1="${y}" y2="${y}" stroke="${C.eg}" stroke-width="2.5"/>`, `EG heute (H ${Math.round(o.H * 1000)} W/K)`);
    s += leg((x, y) => `<rect x="${x}" y="${y - 6}" width="20" height="12" fill="${C.band}"/>`, `Spanne Heizgrenze 15–20 °C`);
    s += leg((x, y) => `<line x1="${x}" x2="${x + 20}" y1="${y}" y2="${y}" stroke="${C.dg}" stroke-width="2" stroke-dasharray="7 5"/>`, 'nach Ausbau inkl. WW');
    s += leg((x, y) => `<line x1="${x}" x2="${x + 20}" y1="${y}" y2="${y}" stroke="${C.wp}" stroke-width="2"/>`, 'WP-Leistung bei θNA');
    s += leg((x, y) => `<rect x="${x}" y="${y - 6}" width="20" height="12" fill="${C.mess}" stroke="#90caf9"/>`, 'gemessener Bereich');
    s += leg((x, y) => `<line x1="${x + 10}" x2="${x + 10}" y1="${y - 7}" y2="${y + 7}" stroke="${C.eg}" stroke-width="2"/>`, 'A Messung (Spanne)');
    s += leg((x, y) => `<line x1="${x + 10}" x2="${x + 10}" y1="${y - 7}" y2="${y + 7}" stroke="${C.oil}" stroke-width="2"/>`, 'B Ölverbrauch (Spanne)');
    ly += 6;
    s += txt(lx, ly, `Heizgrenze ${de(o.tb)} °C`, `style="font-size:11px"`); ly += 16;
    s += txt(lx, ly, `${used.length} von ${o.pts.length} Tagen verwendet`, `style="font-size:11px"`); ly += 16;
    const byWhy = {};
    for (const p of o.pts.filter(p => !p.use)) (byWhy[p.why || 'sonstiges'] = byWhy[p.why || 'sonstiges'] || []).push(p.d.slice(8, 10) + '.' + p.d.slice(5, 7) + '.');
    for (const [why, ds] of Object.entries(byWhy)) { s += txt(lx, ly, `ausgelassen: ${ds.join(', ')}`, `style="font-size:11px;fill:${C.excl}"`); ly += 14; s += txt(lx + 8, ly, `(${why})`, `style="font-size:11px;fill:${C.excl}"`); ly += 16; }
    return s + '</svg>';
}

function run() {
    // A
    const mEg = num('Heizlast_Norm'), mMin = num('Heizlast_Norm_min'), mMax = num('Heizlast_Norm_max');
    const mDg = num('Heizlast_Norm_DG'), mNeed = num('WP_Bedarf');
    const dgAdd = (mDg !== null && mEg !== null) ? mDg - mEg : null;
    const wwAdd = (mNeed !== null && mDg !== null) ? mNeed - mDg : null;
    const methode = (getState(SRC + 'Heizlast_Methode') || {}).val || '';

    // B
    const per = OIL.map(o => ({ o, lo: oilLoad(o, 0), mid: oilLoad(o, 1), hi: oilLoad(o, 2) }));
    const oEg = per[0].mid.p;                                    // juengster Winter = Referenz
    const oMin = Math.min(...per.map(x => x.lo.p)), oMax = Math.max(...per.map(x => x.hi.p));

    // C
    const rSum = ROOM.eg + ROOM.dg;
    const rBuild = rSum - (1 - VENT_SIMULT) * (ROOM.ventEg + ROOM.ventDg);

    const set = (k, v, d = 2) => setState(BASE + k, r1(v, d), true);
    set('Messung_EG', mEg); set('Messung_EG_min', mMin); set('Messung_EG_max', mMax);
    set('Oel_EG', oEg); set('Oel_EG_min', oMin); set('Oel_EG_max', oMax); setState(BASE + 'Oel_H', Math.round(per[0].mid.H * 1000), true);
    set('Raum_EG', ROOM.eg); set('Raum_DG', ROOM.dg); set('Raum_Summe', rSum); set('Raum_Gebaeude', rBuild);
    set('DG_Zuschlag', dgAdd); set('WW_Zuschlag', wwAdd);
    const after = (eg) => (eg === null || dgAdd === null || wwAdd === null) ? null : eg + dgAdd + wwAdd;
    set('Ausbau_Messung', after(mEg)); set('Ausbau_Oel', after(oEg)); set('Ausbau_Raum', wwAdd === null ? null : rBuild + wwAdd);

    const rows = [
        { m: 'A Messung Brennerlaufzeit', eg: mEg, rng: [mMin, mMax], aus: after(mEg), aus_rng: [after(mMin), after(mMax)],
          note: `Echte Wärme aus dem Haus, Gewinne enthalten. ${methode}` },
        { m: 'B Jahres-Ölverbrauch', eg: oEg, rng: [oMin, oMax], aus: after(oEg), aus_rng: [after(oMin), after(oMax)],
          note: per.map(x => `${x.o.label}: ${x.o.liter} l, ${x.o.gtz} Kd → ${r1(x.mid.p)} kW`).join(' · ') +
                ` · Nutzungsgrad ${ETA_YEAR[0]}–${ETA_YEAR[2]}, WW ${WW_KWH_YEAR[2]}–${WW_KWH_YEAR[0]} kWh/a. Enthält Kessel-Bereitschaftsverluste → eher zu hoch.` },
        { m: 'C Raumweise Berechnung', eg: null, rng: null, aus: wwAdd === null ? null : rBuild + wwAdd, aus_rng: wwAdd === null ? null : [rBuild + wwAdd, rSum + wwAdd],
          note: `EG ${r1(ROOM.eg)} kW (${Math.round(ROOM.eg * 1000 / ROOM.areaEg)} W/m², schon ohne Decke) + DG ${r1(ROOM.dg)} kW (${Math.round(ROOM.dg * 1000 / ROOM.areaDg)} W/m²) = ${r1(rSum)} kW Raumsumme, Gebäude ≈ ${r1(rBuild)} kW. Lüftung 0,5/h überall, keine Gewinne → für Raumauslegung, nicht für WP-Größe.` },
    ];

    // Bewertung
    const msg = [];
    if (mEg !== null) {
        const lo = Math.max(mMin, oMin), hi = Math.min(mMax, oMax);
        msg.push(lo <= hi
            ? `Messung (${r1(mEg)} kW) und Ölverbrauch (${r1(oEg)} kW) überlappen bei ${r1(lo)}–${r1(hi)} kW.`
            : `⚠ Messung (${r1(mMin)}–${r1(mMax)} kW) und Ölverbrauch (${r1(oMin)}–${r1(oMax)} kW) überlappen nicht – Annahmen prüfen.`);
        msg.push(`Raumweise liegt das EG ${Math.round((ROOM.eg / (mEg - CEILING_KW) - 1) * 100)} % über der Messung ohne Deckenverlust (vorsichtige Rechnung, normal 30–50 %).`);
    }
    if (after(mEg) !== null) msg.push(`Nach Ausbau inkl. WW: Messung ${r1(after(mEg))} kW, Öl ${r1(after(oEg))} kW, raumweise ${r1(rBuild + wwAdd)}–${r1(rSum + wwAdd)} kW. Für die WP-Größe zählen A und B.`);
    const wpTxt = (getState(SRC + 'WP_Bewertung') || {}).val;
    if (wpTxt) msg.push(wpTxt.split(' Basis:')[0]);

    setState(BASE + 'Tabelle_JSON', JSON.stringify(rows.map(r => ({ ...r, eg: r1(r.eg), aus: r1(r.aus) }))), true);
    const td = 'style="padding:3px 6px;border-bottom:1px solid #8884;vertical-align:top"';
    const kw = (v, rng) => v === null || v === undefined ? '–' :
        `<b>${v.toFixed(1)}</b>` + (rng && rng[0] !== null && rng[1] !== null ? `<br><span style="opacity:.7">${rng[0].toFixed(1)}–${rng[1].toFixed(1)}</span>` : '');
    const html = `<table style="border-collapse:collapse;font:13px sans-serif;width:100%">` +
        `<tr><th ${td} align="left">Verfahren</th><th ${td} align="right">EG heute</th><th ${td} align="right">nach Ausbau inkl. WW</th><th ${td} align="left">Hinweis</th></tr>` +
        rows.map(r => `<tr><td ${td}>${r.m}</td><td ${td} align="right">${kw(r.eg, r.rng)}</td><td ${td} align="right">${kw(r.aus, r.aus_rng)}</td><td ${td}>${r.note}</td></tr>`).join('') +
        `</table><div style="font:12px sans-serif;margin-top:4px">${msg.join('<br>')}</div>`;
    setState(BASE + 'Tabelle_HTML', html, true);
    setState(BASE + 'Bewertung', msg.join(' '), true);

    // Streudiagramm
    let pts = [];
    try { pts = JSON.parse((getState(SRC + 'Regression_Punkte') || {}).val || '[]'); } catch (e) { pts = []; }
    const H = num('Waermeverlust_H'), tb = num('Heizgrenze');
    if (H && tb && pts.length) {
        const svg = scatterSvg({ pts, H: H / 1000, tb, na: THETA_NA, pMin: mMin, pMax: mMax, dgAdd, wwAdd,
            wp: num('WP_Leistung'), biv: num('Bivalenzpunkt_10kW'), mMin, mMax, oMin, oMax, oEg });
        setState(BASE + 'Streudiagramm_HTML',
            `<div style="background:#fff;border:1px solid #b0bec5;border-radius:6px;padding:6px">${svg}</div>`, true);
    }
    setState(BASE + 'Letzter_Lauf', new Date().toLocaleString('de-DE'), true);
    log(`Heizlast-Vergleich: A ${r1(mEg)} | B ${r1(oEg)} | C Gebäude ${r1(rBuild)} kW`);
}

let pending = null;
const runSoon = () => { clearTimeout(pending); pending = setTimeout(() => { try { run(); } catch (e) { log('Heizlast-Vergleich: ' + e, 'warn'); } }, 2000); };
ensureStates().then(runSoon).catch(e => log('Heizlast-Vergleich: ' + e, 'warn'));
on({ id: [SRC + 'Heizlast_Norm', SRC + 'Heizlast_Norm_min', SRC + 'Heizlast_Norm_max', SRC + 'WP_Bedarf', SRC + 'Regression_Punkte'], change: 'ne' }, runSoon);
schedule('20 0 * * *', runSoon);
