// OEG KMS-D / KMS-D+  ->  ESP32-S3 (nativer USB-Port als Host)  ->  MQTT / Home Assistant
//
// Der Regler meldet sich ueber Mini-USB als CDC-ACM-Geraet ("SELTRON HEATING CONTROLLER")
// und spricht Modbus ASCII, Slave 128, 9600 7E1.
// Register laut github.com/ced2git/oeg_kmsd (unvollstaendig, nur lesend verwendet!).
//
// Serial-Monitor (UART-Port, 115200):  "r <start> [anzahl]"  liest Register von Hand,
//                                      "s <von> <bis>"       scannt einen Bereich.

#include <Arduino.h>
#include <ArduinoOTA.h>
#include <PubSubClient.h>
#include <WiFi.h>

#include "config.h"
#include "modbus_ascii.h"
#include "usb_cdc_host.h"

struct RegDef {
  uint16_t addr;
  const char *key;
  const char *name;
  const char *unit;
  const char *deviceClass;  // nullptr = keine
  float scale;
};

// Zuordnung fuer Hydraulikschema 107b (Oelkessel, Direktheizkreis, Mischerheizkreis/FBH,
// WW-Speicher, Solar), ermittelt per Register-Scan + KMS-D-Anleitung. Nur lesend!
const RegDef REGS[] = {
    {38, "t1", "Solarkollektor (T1)", "°C", "temperature", 0.1f},
    {39, "t2", "Aussentemperatur (T2)", "°C", "temperature", 0.1f},
    {40, "t3", "Oelkessel (T3)", "°C", "temperature", 0.1f},
    {41, "t4", "Vorlauf Mischerkreis FBH (T4)", "°C", "temperature", 0.1f},
    {42, "t5", "Warmwasser oben (T5)", "°C", "temperature", 0.1f},
    {43, "t6", "Warmwasser unten Solar (T6)", "°C", "temperature", 0.1f},
    // Register 49..56 = Sollwerte zu T1..T8 (-500 = kein Sollwert)
    {49, "t1_set", "Kollektor Soll (T1)", "°C", "temperature", 0.1f},
    {50, "t2_set", "Aussentemperatur gedaempft (T2)", "°C", "temperature", 0.1f},
    {52, "flow_set", "Vorlauf Soll Mischerkreis (T4)", "°C", "temperature", 0.1f},
    {51, "boiler_set", "Kessel Soll", "°C", "temperature", 0.1f},
    {53, "dhw_set", "Warmwasser Soll", "°C", "temperature", 0.1f},
    {58, "r58", "Register 58", "", nullptr, 1.0f},
    {35, "relays", "Relais-Bitmaske", "", nullptr, 1.0f},  // Bit0 = R1 ... Bit7 = R8
    {34, "manual", "Handbetrieb-Bitmaske", "", nullptr, 1.0f},
};
constexpr size_t NREGS = sizeof(REGS) / sizeof(REGS[0]);

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);
uint32_t lastPoll = 0, lastMqttTry = 0;
bool discoverySent = false;
volatile bool otaRunning = false;

const String TOPIC_STATE = String(MQTT_BASE) + "/state";
const String TOPIC_AVAIL = String(MQTT_BASE) + "/status";

// ---------------------------------------------------------------- Home Assistant
void sendDiscovery() {
  const String devId = String(MQTT_BASE);
  for (const auto &r : REGS) {
    String topic = String(HA_DISCOVERY_PREFIX) + "/sensor/" + devId + "/" + r.key + "/config";
    String p = "{";
    p += "\"name\":\"" + String(r.name) + "\",";
    p += "\"uniq_id\":\"" + devId + "_" + r.key + "\",";
    p += "\"stat_t\":\"" + TOPIC_STATE + "\",";
    p += "\"avty_t\":\"" + TOPIC_AVAIL + "\",";
    p += "\"val_tpl\":\"{{ value_json." + String(r.key) + " }}\",";
    if (r.unit[0]) p += "\"unit_of_meas\":\"" + String(r.unit) + "\",";
    if (r.deviceClass) p += "\"dev_cla\":\"" + String(r.deviceClass) + "\",\"stat_cla\":\"measurement\",";
    p += "\"dev\":{\"ids\":[\"" + devId + "\"],\"name\":\"OEG KMS-D\",\"mf\":\"OEG / Seltron\",\"mdl\":\"KMS-D\"}";
    p += "}";
    mqtt.publish(topic.c_str(), p.c_str(), true);
  }
  discoverySent = true;
}

void mqttMaintain() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (mqtt.connected()) {
    mqtt.loop();
    return;
  }
  if (millis() - lastMqttTry < 5000) return;
  lastMqttTry = millis();
  const String cid = String(MQTT_BASE) + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  const bool ok = strlen(MQTT_USER)
                      ? mqtt.connect(cid.c_str(), MQTT_USER, MQTT_PASS, TOPIC_AVAIL.c_str(), 0, true, "offline")
                      : mqtt.connect(cid.c_str(), TOPIC_AVAIL.c_str(), 0, true, "offline");
  if (ok) {
    Serial.println("[MQTT] verbunden");
    discoverySent = false;
    mqtt.subscribe((String(MQTT_BASE) + "/cmd").c_str());
  } else {
    Serial.printf("[MQTT] Verbindung fehlgeschlagen (rc=%d)\n", mqtt.state());
  }
}

// ---------------------------------------------------------------- MQTT-Befehle
// Topic <MQTT_BASE>/cmd:  "scan <von> <bis>"  -> liest Register (nur lesend!) und
// veroeffentlicht Bloecke auf <MQTT_BASE>/scan als {"s":start,"v":[wert|null,...]}
String pendingCmd;

void onMqttMessage(char *topic, byte *payload, unsigned int len) {
  pendingCmd = "";
  for (unsigned int i = 0; i < len && i < 64; i++) pendingCmd += (char)payload[i];
}

void mqttScan(uint32_t from, uint32_t to) {
  const String topic = String(MQTT_BASE) + "/scan";
  constexpr uint16_t BLK = 20;
  for (uint32_t s = from; s <= to; s += BLK) {
    const uint16_t n = (uint16_t)min<uint32_t>(BLK, to - s + 1);
    int16_t vals[BLK];
    bool okv[BLK];
    auto res = ModbusAscii::readHolding(MODBUS_SLAVE, s, n, vals, MODBUS_TIMEOUT_MS);
    if (res == ModbusAscii::ERR_NOT_CONNECTED) break;
    for (uint16_t i = 0; i < n; i++) okv[i] = (res == ModbusAscii::OK);
    if (res != ModbusAscii::OK) {  // Block nicht lesbar -> einzeln versuchen
      for (uint16_t i = 0; i < n; i++) {
        okv[i] = ModbusAscii::readHolding(MODBUS_SLAVE, s + i, 1, &vals[i], 300) == ModbusAscii::OK;
        mqtt.loop();
      }
    }
    String js = "{\"s\":" + String(s) + ",\"v\":[";
    for (uint16_t i = 0; i < n; i++) {
      if (i) js += ",";
      js += okv[i] ? String(vals[i]) : String("null");
    }
    js += "]}";
    mqtt.publish(topic.c_str(), js.c_str());
    mqtt.loop();
    ArduinoOTA.handle();
  }
  mqtt.publish(topic.c_str(), ("{\"done\":[" + String(from) + "," + String(to) + "]}").c_str());
}

void handleMqttCommand() {
  if (pendingCmd.isEmpty()) return;
  String cmd = pendingCmd;
  pendingCmd = "";
  unsigned a = 0, b = 0;
  if (sscanf(cmd.c_str(), "scan %u %u", &a, &b) == 2 && b >= a && b - a < 2000) {
    Serial.printf("[CMD] scan %u..%u\n", a, b);
    mqttScan(a, b);
  }
}

void publishAvailability() {
  if (mqtt.connected()) mqtt.publish(TOPIC_AVAIL.c_str(), UsbCdcHost::connected() ? "online" : "offline", true);
}

// ---------------------------------------------------------------- Regler
// Relais einzeln: oeg_kmsd/relay/r1 .. r8 (0/1)
int32_t lastRelays = -1;
void publishRelays(int16_t v) {
  if (!mqtt.connected()) return;
  lastRelays = (uint16_t)v;
  for (int b = 0; b < 8; b++) {
    const String t = String(MQTT_BASE) + "/relay/r" + String(b + 1);
    mqtt.publish(t.c_str(), ((uint16_t)v >> b) & 1 ? "1" : "0", true);
  }
  mqtt.publish((String(MQTT_BASE) + "/relays").c_str(), String((uint16_t)v).c_str(), true);
}

// Schnelle Relais-Abfrage (alle RELAY_POLL_MS), sendet nur bei Aenderung -
// damit kurze Mischer- und Brennerimpulse nicht verloren gehen.
constexpr uint32_t RELAY_POLL_MS = 2000;
uint32_t lastRelayPoll = 0;
void pollRelaysFast() {
  if (millis() - lastRelayPoll < RELAY_POLL_MS) return;
  lastRelayPoll = millis();
  int16_t v;
  if (ModbusAscii::readHolding(MODBUS_SLAVE, 35, 1, &v, MODBUS_TIMEOUT_MS) != ModbusAscii::OK) return;
  if ((int32_t)(uint16_t)v != lastRelays) {
    Serial.printf("[MB] Relais geaendert: %d -> %u\n", (int)lastRelays, (uint16_t)v);
    publishRelays(v);
  }
}

void pollController() {
  String json = "{";
  bool any = false;
  for (const auto &r : REGS) {
    int16_t v;
    auto res = ModbusAscii::readHolding(MODBUS_SLAVE, r.addr, 1, &v, MODBUS_TIMEOUT_MS);
    if (res != ModbusAscii::OK) {
      Serial.printf("[MB] Reg %u: %s\n", r.addr, ModbusAscii::resultText(res));
      if (res == ModbusAscii::ERR_NOT_CONNECTED) return;
      continue;
    }
    const float f = v * r.scale;
    Serial.printf("[MB] %-6s (Reg %u) = %d -> %.1f %s\n", r.key, r.addr, v, f, r.unit);
    const String val = String(f, r.scale < 1.0f ? 1 : 0);
    if (any) json += ",";
    json += "\"" + String(r.key) + "\":" + val;
    any = true;
    // Einzelwert zusaetzlich als eigenes Topic (ioBroker: mqtt.0.oeg_kmsd.<key>)
    if (mqtt.connected()) mqtt.publish((String(MQTT_BASE) + "/" + r.key).c_str(), val.c_str(), true);
    if (r.addr == 35) publishRelays(v);
  }
  json += "}";
  if (any && mqtt.connected()) mqtt.publish(TOPIC_STATE.c_str(), json.c_str());
}

void scanRegisters(uint16_t from, uint16_t to) {
  Serial.printf("[SCAN] Register %u..%u\n", from, to);
  for (uint32_t a = from; a <= to; a++) {
    int16_t v;
    auto res = ModbusAscii::readHolding(MODBUS_SLAVE, a, 1, &v, 300);
    if (res == ModbusAscii::OK)
      Serial.printf("  %4u = %6d  (0x%04X)\n", (unsigned)a, v, (uint16_t)v);
    else if (res == ModbusAscii::ERR_EXCEPTION)
      Serial.printf("  %4u : Exception %u\n", (unsigned)a, ModbusAscii::lastException());
    else if (res == ModbusAscii::ERR_NOT_CONNECTED)
      return;
    else
      Serial.printf("  %4u : %s\n", (unsigned)a, ModbusAscii::resultText(res));
    mqtt.loop();
  }
}

void handleSerialCommand() {
  static String buf;
  while (Serial.available()) {
    char c = Serial.read();
    if (c != '\n' && c != '\r') {
      buf += c;
      continue;
    }
    buf.trim();
    if (buf.length()) {
      unsigned a = 0, b = 0;
      if (buf[0] == 'r') {
        int n = sscanf(buf.c_str() + 1, "%u %u", &a, &b);
        if (n < 2) b = 1;
        if (b < 1 || b > 60) b = 1;
        int16_t vals[60];
        auto res = ModbusAscii::readHolding(MODBUS_SLAVE, a, b, vals, MODBUS_TIMEOUT_MS);
        if (res == ModbusAscii::OK)
          for (unsigned i = 0; i < b; i++) Serial.printf("  %4u = %6d\n", a + i, vals[i]);
        else
          Serial.printf("  Fehler: %s\n", ModbusAscii::resultText(res));
      } else if (buf[0] == 's' && sscanf(buf.c_str() + 1, "%u %u", &a, &b) == 2) {
        scanRegisters(a, b);
      } else {
        Serial.println("Befehle: r <start> [anzahl]  |  s <von> <bis>");
      }
    }
    buf = "";
  }
}

// ---------------------------------------------------------------- setup / loop
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\nOEG KMS-D -> MQTT (ESP32-S3 USB-Host)");

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(1024);
  mqtt.setCallback(onMqttMessage);

  ArduinoOTA.setHostname(OTA_HOSTNAME);
  ArduinoOTA.setPassword(OTA_PASS);
  ArduinoOTA.onStart([]() {
    otaRunning = true;
    Serial.println("[OTA] Update startet");
    if (mqtt.connected()) mqtt.publish(TOPIC_AVAIL.c_str(), "offline", true);
  });
  ArduinoOTA.onEnd([]() { Serial.println("[OTA] fertig - Neustart"); });
  ArduinoOTA.onError([](ota_error_t e) {
    otaRunning = false;
    Serial.printf("[OTA] Fehler %u\n", e);
  });
  // ArduinoOTA.begin() erst nach WLAN-Verbindung (wegen mDNS), siehe loop()

  UsbCdcHost::LineCoding lc{CDC_BAUD, CDC_STOPBITS, CDC_PARITY, CDC_DATABITS};
  UsbCdcHost::begin(lc);
}

void loop() {
  static bool wifiWasUp = false, otaStarted = false;
  if ((WiFi.status() == WL_CONNECTED) != wifiWasUp) {
    wifiWasUp = !wifiWasUp;
    if (wifiWasUp) {
      Serial.printf("[WLAN] verbunden, IP %s, Hostname %s.local\n", WiFi.localIP().toString().c_str(),
                    OTA_HOSTNAME);
      if (!otaStarted) {
        ArduinoOTA.begin();
        otaStarted = true;
      }
    }
  }
  if (otaStarted) ArduinoOTA.handle();
  if (otaRunning) return;

  UsbCdcHost::poll();
  mqttMaintain();
  handleSerialCommand();
  if (UsbCdcHost::connected()) handleMqttCommand();

  static bool lastConn = false;
  const bool conn = UsbCdcHost::connected();
  if (conn != lastConn) {
    lastConn = conn;
    publishAvailability();
  }

  if (mqtt.connected() && !discoverySent) {
    sendDiscovery();
    publishAvailability();
  }

  if (UsbCdcHost::justConnected()) {
    delay(300);
#if SCAN_ON_CONNECT
    scanRegisters(0, SCAN_LAST);
#endif
    lastPoll = 0;
  }

  if (conn && (lastPoll == 0 || millis() - lastPoll >= POLL_INTERVAL_MS)) {
    lastPoll = millis();
    pollController();
  } else if (conn) {
    pollRelaysFast();
  }
  delay(10);
}
