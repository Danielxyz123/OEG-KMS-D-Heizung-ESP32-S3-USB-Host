// Heizung_Regler_Parameter
// Liest die Heizkurven-Einstellungen des OEG KMS-D (Heizkreis 1, Fussboden) regelmaessig aus
// und schreibt sie nach 0_userdata.0.Heizung.Regler.* (in InfluxDB geloggt, nur Aenderungen).
// Weg: ioBroker -> mqtt.0.oeg_kmsd.cmd "scan <von> <bis>" -> ESP32 liest Register NUR LESEND
// (Modbus 0x03) -> Antwort auf mqtt.0.oeg_kmsd.scan als {"s":start,"v":[...]} und {"done":[von,bis]}.
// Register-Zuordnung siehe OEG-Repo docs/REGLERVERHALTEN.md.

const CMD = 'mqtt.0.oeg_kmsd.cmd';
const SCAN = 'mqtt.0.oeg_kmsd.scan';
const STATUS = 'mqtt.0.oeg_kmsd.status';
const BASE = '0_userdata.0.Heizung.Regler.';

// Register -> [Datenpunkt, Name, Einheit, Divisor]
const REGS = {
    1170: ['P2_1_Steilheit', 'P2.1 Steilheit Heizkurve Kreis 1', '', 100],
    1171: ['P2_2_Parallelverschiebung', 'P2.2 Parallelverschiebung Kreis 1', 'K', 10],
    1172: ['P2_3_Boost_Dauer', 'P2.3 Dauer Boost-Heizen Kreis 1', 'min', 1],
    1173: ['P2_4_Boost_Anhebung', 'P2.4 Raumanhebung Boost Kreis 1', 'K', 10],
    7:    ['Raum_Soll_Nacht', 'Raum-Sollwert Nacht Kreis 1 (Register 7, vermutet)', '°C', 10],
    8:    ['Raum_Soll_Tag', 'Raum-Sollwert Tag Kreis 1 (Register 8, vermutet)', '°C', 10],
};
// abwechselnd scannen -> der Befehl aendert sich jedes Mal (MQTT liefert sicher aus)
const RANGES = [[1170, 1173], [7, 8]];
const INTERVAL_MIN = 15;
const TIMEOUT_MS = 30000;

for (const [, [id, name, unit]] of Object.entries(REGS)) {
    createState(BASE + id, null, { name, type: 'number', role: 'value', unit, read: true, write: false });
}
createState(BASE + 'Heizkurve', '', { name: 'Heizkurve Kreis 1 (Steilheit / Parallelverschiebung)', type: 'string', role: 'text', read: true, write: false });
createState(BASE + 'Letzte_Abfrage', 0, { name: 'Zeitpunkt der letzten erfolgreichen Registerabfrage', type: 'number', role: 'date', read: true, write: false });

let queue = [], busy = null, timer = null;

function next() {
    if (busy || !queue.length) return;
    if (!existsState(STATUS) || getState(STATUS).val !== 'online') { queue = []; return; }
    busy = queue.shift();
    setState(CMD, `scan ${busy[0]} ${busy[1]}`, false);
    timer = setTimeout(() => { log(`Regler-Parameter: keine Antwort auf scan ${busy[0]} ${busy[1]}`, 'warn'); busy = null; next(); }, TIMEOUT_MS);
}

function round(v, d) { const f = Math.pow(10, d); return Math.round(v * f) / f; }

function updateCurve() {
    const s = getState(BASE + 'P2_1_Steilheit').val, p = getState(BASE + 'P2_2_Parallelverschiebung').val;
    if (s === null || p === null) return;
    const txt = `${s.toFixed(2).replace('.', ',')} / ${p >= 0 ? '+' : ''}${p.toFixed(1).replace('.', ',')} K`;
    if (getState(BASE + 'Heizkurve').val !== txt) {
        if (getState(BASE + 'Heizkurve').val) log(`Heizkurve geaendert: ${getState(BASE + 'Heizkurve').val} -> ${txt}`);
        setState(BASE + 'Heizkurve', txt, true);
    }
}

on({ id: SCAN, change: 'any' }, (obj) => {
    let j;
    try { j = JSON.parse(obj.state.val); } catch (e) { return; }
    if (j.done) {
        if (busy && j.done[0] === busy[0] && j.done[1] === busy[1]) {
            clearTimeout(timer); busy = null;
            setState(BASE + 'Letzte_Abfrage', Date.now(), true);
            updateCurve();
            next();
        }
        return;
    }
    if (!Array.isArray(j.v)) return;
    j.v.forEach((raw, i) => {
        const r = REGS[j.s + i];
        if (!r || raw === null || raw === undefined) return;
        const val = round(raw / r[3], 2);
        const st = getState(BASE + r[0]);
        if (!st || st.val !== val) setState(BASE + r[0], val, true);
    });
});

function poll() { queue = RANGES.slice(); next(); }

schedule(`*/${INTERVAL_MIN} * * * *`, poll);
on({ id: STATUS, change: 'ne', val: 'online' }, () => setTimeout(poll, 10000));   // nach Wiederverbindung / Stromausfall
setTimeout(poll, 5000);
