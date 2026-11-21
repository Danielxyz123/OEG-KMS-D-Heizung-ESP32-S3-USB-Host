// =============================================================================
// Heizung → MQTT für das M5-Display
// =============================================================================
// Schickt Brennerwerte per MQTT, damit das M5-Display sie anzeigen kann:
//   Heizung/Brenner_Laufzeit_heute   [h]   aus 0_userdata.0.Heizung.Laufzeit_heute
//   Heizung/Brenner_Starts_heute     [-]   aus 0_userdata.0.Heizung.Starts_heute
//   Heizung/Brenner_Anteil_24h       [%]   aus 0_userdata.0.Heizung.Laufzeit_Anteil_24h
// Alle Werte berechnet das Skript Heizung_Brennerleistung (mit Erkennung von Datenlücken
// und Abzug der Zeit ohne Flamme je Start). Dieses Skript spiegelt sie nur.
// Gesendet wird bei jeder Änderung und zusätzlich jede Minute.
// (20.11.2026: eigene 24-h-Berechnung aus R1 entfernt – war doppelt und ohne Korrekturen.)
// =============================================================================

const QUELLEN = {
    'Heizung/Brenner_Laufzeit_heute': '0_userdata.0.Heizung.Laufzeit_heute',
    'Heizung/Brenner_Starts_heute':   '0_userdata.0.Heizung.Starts_heute',
    'Heizung/Brenner_Anteil_24h':     '0_userdata.0.Heizung.Laufzeit_Anteil_24h',
};

// Der MQTT-Adapter veröffentlicht Datenpunkte unter mqtt.0.*, die mit ack=false gesetzt werden.
// Die Datenpunkte mqtt.0.Heizung.* legt der Adapter an, sobald das Display die Topics abonniert.
function senden(topic, wert) {
    const id = 'mqtt.0.' + topic.replace(/\//g, '.');
    // existsObject statt existsState: Die Datenpunkte sind anfangs noch ohne Wert
    if (!existsObject(id)) {
        log(`Heizung → MQTT: ${id} fehlt (Display noch nicht verbunden?)`, 'warn');
        return;
    }
    setState(id, String(wert));
}

function alleSenden() {
    for (const topic of Object.keys(QUELLEN)) {
        const s = getState(QUELLEN[topic]);
        if (s && s.val !== null && s.val !== undefined) senden(topic, s.val);
    }
}

// Bei Änderung sofort senden
for (const topic of Object.keys(QUELLEN)) {
    on({ id: QUELLEN[topic], change: 'ne' }, (obj) => senden(topic, obj.state.val));
}
schedule('* * * * *', alleSenden);

setTimeout(alleSenden, 3000);
log('🔥 Heizung → MQTT für das Display gestartet', 'info');
