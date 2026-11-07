#!/usr/bin/env python3
"""Richtet die Heizungs-Integration in ioBroker ein (idempotent, mehrfach ausfuehrbar).

  1. JavaScript-Skript  script.js.Heizung_Brennerleistung  anlegen/aktualisieren
  2. Datenpunkt 0_userdata.0.Heizung.Analyse_Zeitraum anlegen
  3. Namen, Einheiten und InfluxDB-Logging aller Datenpunkte aus iobroker/datapoints.json setzen
  4. vis-1-Seiten Heizung, Heizung_Schema, Heizung_Analyse in das vis-Projekt importieren
     (vorher Sicherung von vis-views.json; kollidierende Widget-IDs werden neu nummeriert)
  5. optional: Button "Heizung" auf einer Startseite (--nav-view)

Ohne --apply wird nur angezeigt, was passieren wuerde.

  python tools/iobroker_setup.py --host 192.168.178.44:8081
  python tools/iobroker_setup.py --host 192.168.178.44:8081 --apply --nav-view CurrentData

Voraussetzungen in ioBroker: Adapter admin, mqtt (Broker), influxdb, javascript, vis, flot,
vis-justgage. Die mqtt.0.oeg_kmsd.*-Datenpunkte entstehen erst, wenn der ESP32 sendet –
also vorher die Firmware flashen und den Regler anschliessen.
Benoetigt: pip install websocket-client
"""
import argparse, base64, copy, json, os, random, sys, time
import websocket

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IOB = os.path.join(ROOT, "iobroker")
SCRIPT_ID = "script.js.Heizung_Brennerleistung"
RANGE_ID = "0_userdata.0.Heizung.Analyse_Zeitraum"
VIEWS = ["Heizung", "Heizung_Schema", "Heizung_Analyse"]


class IoB:
    def __init__(self, host):
        self.ws = websocket.create_connection(f"ws://{host}/?sid={random.randint(1, 10**9)}&name=admin", timeout=30)
        self.mid = 0
        self.ws.recv()

    def call(self, name, *args):
        self.mid += 1
        self.ws.send(json.dumps([3, self.mid, name, list(args)]))
        end = time.time() + 60
        while time.time() < end:
            raw = self.ws.recv()
            if not raw:
                continue
            m = json.loads(raw)
            if m[0] == 1:
                self.ws.send(json.dumps([2]))
                continue
            if m[0] == 3 and m[1] == self.mid:
                return m[3]
        raise TimeoutError(name)

    def obj(self, oid):
        r = self.call("getObject", oid)
        return None if r[0] else r[1]

    def read_file(self, adapter, path):
        r = self.call("readFile", adapter, path)
        if r[0]:
            raise RuntimeError(f"{adapter}/{path}: {r[0]}")
        return r[1] if isinstance(r[1], str) else (r[1].get("file") or r[1].get("data"))

    def write_file(self, adapter, path, text):
        r = self.call("writeFile64", adapter, path, base64.b64encode(text.encode("utf-8")).decode())
        if r and r[0]:
            raise RuntimeError(f"{adapter}/{path}: {r[0]}")


def influx_custom(cfg):
    base = {"enabled": True, "storageType": "", "aliasId": "", "debounceTime": 0, "blockTime": 0,
            "changesOnly": True, "changesRelogInterval": 600, "changesMinDelta": 0, "ignoreBelowNumber": "",
            "disableSkippedValueLogging": False, "enableDebugLogs": False, "debounce": 1000}
    base.update(cfg)
    return {"influxdb.0": base}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="localhost:8081", help="ioBroker Admin (Host:Port)")
    ap.add_argument("--vis-project", default="main")
    ap.add_argument("--nav-view", help="vorhandene vis-Seite, auf die ein Button 'Heizung' kommt (z. B. CurrentData)")
    ap.add_argument("--nav-pos", default="633,478", help="Position des Buttons links,oben in px")
    ap.add_argument("--apply", action="store_true", help="Aenderungen wirklich schreiben")
    a = ap.parse_args()
    io = IoB(a.host)
    do = a.apply
    say = lambda s: print(("  " if do else "  [Probe] ") + s)

    # 1. Skript
    src = open(os.path.join(IOB, "Heizung_Brennerleistung.js"), encoding="utf-8").read()
    cur = io.obj(SCRIPT_ID)
    if cur and cur["common"].get("source") == src:
        say("Skript ist aktuell")
    else:
        say(("aktualisiere" if cur else "lege an") + f" {SCRIPT_ID}")
        if do:
            if cur:
                io.call("extendObject", SCRIPT_ID, {"common": {"source": src, "enabled": True}})
            else:
                io.call("setObject", SCRIPT_ID, {"type": "script", "native": {}, "common": {
                    "name": "Heizung_Brennerleistung", "expert": True, "engineType": "Javascript/js",
                    "engine": "system.adapter.javascript.0", "debug": False, "verbose": False,
                    "enabled": True, "source": src}})

    # 2. Zeitraum-Datenpunkt
    dps = json.load(open(os.path.join(IOB, "datapoints.json"), encoding="utf-8"))
    if not io.obj(RANGE_ID):
        say(f"lege {RANGE_ID} an")
        if do:
            io.call("setObject", "0_userdata.0.Heizung", {"type": "folder", "common": {"name": "Heizung"}, "native": {}})
            c = {k: v for k, v in dps[RANGE_ID].items() if k != "influxdb"}
            c.update({"read": True, "write": True, "def": 1440})
            io.call("setObject", RANGE_ID, {"type": "state", "common": c, "native": {}})
            io.call("setState", RANGE_ID, {"val": 1440, "ack": True})

    # 3. Namen/Einheiten/Logging (Skript-Datenpunkte entstehen erst nach dem Skriptstart)
    if do:
        for _ in range(30):
            if io.obj("0_userdata.0.Heizung.Leistung_1h"):
                break
            time.sleep(2)
    missing, changed = [], 0
    for oid, cfg in sorted(dps.items()):
        if oid == RANGE_ID:
            continue
        o = io.obj(oid)
        if not o:
            missing.append(oid)
            continue
        common = {k: cfg[k] for k in ("name", "unit") if k in cfg}
        if "influxdb" in cfg:
            common["custom"] = influx_custom(cfg["influxdb"])
        changed += 1
        if do:
            io.call("extendObject", oid, {"common": common})
    say(f"Namen/Einheiten/Logging fuer {changed} Datenpunkte gesetzt")
    if missing:
        print(f"  HINWEIS: {len(missing)} Datenpunkte fehlen noch (ESP32 sendet noch nicht?) – "
              f"Skript spaeter erneut ausfuehren:\n    " + "\n    ".join(missing[:12]) + (" …" if len(missing) > 12 else ""))

    # 4./5. vis
    path = f"{a.vis_project}/vis-views.json"
    raw = io.read_file("vis.0", path)
    views = json.loads(raw)
    used = {wid for name, v in views.items() if isinstance(v, dict) and name not in VIEWS for wid in v.get("widgets", {})}
    nxt = max([int(w[1:]) for w in used if w[1:].isdigit()] + [0]) + 1
    for name in VIEWS:
        view = json.load(open(os.path.join(IOB, "vis", name + ".json"), encoding="utf-8"))
        new_w = {}
        for wid, w in view["widgets"].items():
            if wid in used:
                while f"w{nxt:05d}" in used:
                    nxt += 1
                wid = f"w{nxt:05d}"
            used.add(wid)
            new_w[wid] = w
        view["widgets"] = new_w
        view["activeWidgets"] = []
        say(("ersetze" if name in views else "importiere") + f" vis-Seite {name} ({len(new_w)} Widgets)")
        views[name] = view
    if a.nav_view:
        if a.nav_view not in views:
            print(f"  FEHLER: vis-Seite {a.nav_view} gibt es nicht")
        elif any(w.get("data", {}).get("href", "").endswith("#Heizung") for w in views[a.nav_view]["widgets"].values()):
            say(f"Button 'Heizung' auf {a.nav_view} ist schon da")
        else:
            tpl = next(w for w in views["Heizung"]["widgets"].values() if w["tpl"] == "tplJquiButtonLink")
            b = copy.deepcopy(tpl)
            left, top = a.nav_pos.split(",")
            b["data"].update({"buttontext": "Heizung", "href": "/vis/index.html#Heizung"})
            b["style"] = {"left": f"{left}px", "top": f"{top}px", "width": "147px", "height": "50px", "bindings": []}
            while f"w{nxt:05d}" in used:
                nxt += 1
            views[a.nav_view]["widgets"][f"w{nxt:05d}"] = b
            say(f"Button 'Heizung' auf {a.nav_view} bei {a.nav_pos}")
    if do:
        bak = f"{path}.bak-{time.strftime('%Y%m%d-%H%M%S')}"
        io.write_file("vis.0", bak, raw)
        io.write_file("vis.0", path, json.dumps(views, ensure_ascii=False, indent=2))
        say(f"vis gespeichert (Sicherung: vis.0/{bak}) – vis-Editor neu laden!")
    print("Fertig." if do else "Probelauf beendet – mit --apply ausfuehren.")


if __name__ == "__main__":
    main()
