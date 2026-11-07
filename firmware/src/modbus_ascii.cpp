#include "modbus_ascii.h"

#include <Arduino.h>

#include "usb_cdc_host.h"

namespace ModbusAscii {
namespace {

uint8_t lastExc = 0;
const char HEXCHARS[] = "0123456789ABCDEF";

int hexVal(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  return -1;
}

}  // namespace

Result readHolding(uint8_t slave, uint16_t start, uint16_t count, int16_t *out, uint32_t timeoutMs) {
  if (count == 0 || count > 60) return ERR_RESPONSE;
  if (!UsbCdcHost::connected()) return ERR_NOT_CONNECTED;

  // Anfrage:  ':' ADR FC STARTH STARTL CNTH CNTL LRC CR LF  (alles als Hex-Text)
  const uint8_t pdu[6] = {slave, 0x03, (uint8_t)(start >> 8), (uint8_t)start,
                          (uint8_t)(count >> 8), (uint8_t)count};
  uint8_t lrc = 0;
  for (uint8_t b : pdu) lrc += b;
  lrc = (uint8_t)(-lrc);

  char frame[1 + 2 * 7 + 2];
  size_t n = 0;
  frame[n++] = ':';
  for (uint8_t b : pdu) {
    frame[n++] = HEXCHARS[b >> 4];
    frame[n++] = HEXCHARS[b & 0x0F];
  }
  frame[n++] = HEXCHARS[lrc >> 4];
  frame[n++] = HEXCHARS[lrc & 0x0F];
  frame[n++] = '\r';
  frame[n++] = '\n';

  UsbCdcHost::flushRx();
  if (!UsbCdcHost::write(reinterpret_cast<const uint8_t *>(frame), n)) return ERR_WRITE;

  // Antwort einlesen bis LF
  char line[2 * (3 + 2 * 60 + 1) + 8];
  size_t len = 0;
  bool started = false, done = false;
  const uint32_t t0 = millis();
  while (!done && millis() - t0 < timeoutMs) {
    uint8_t c;
    if (UsbCdcHost::read(&c, 1, 10) == 0) {
      if (!UsbCdcHost::connected()) return ERR_NOT_CONNECTED;
      continue;
    }
    c &= 0x7F;
    if (c == ':') { started = true; len = 0; continue; }
    if (!started || c == '\r') continue;
    if (c == '\n') { done = true; break; }
    if (len < sizeof(line)) line[len++] = (char)c;
    else return ERR_FRAME;
  }
  if (!done) return ERR_TIMEOUT;
  if (len < 6 || (len & 1)) return ERR_FRAME;

  uint8_t bytes[sizeof(line) / 2];
  const size_t nb = len / 2;
  uint8_t sum = 0;
  for (size_t i = 0; i < nb; i++) {
    const int hi = hexVal(line[2 * i]), lo = hexVal(line[2 * i + 1]);
    if (hi < 0 || lo < 0) return ERR_FRAME;
    bytes[i] = (uint8_t)((hi << 4) | lo);
    sum += bytes[i];
  }
  if (sum != 0) return ERR_LRC;  // Summe inkl. LRC muss 0 ergeben
  if (bytes[0] != slave) return ERR_RESPONSE;
  if (bytes[1] == 0x83) {
    lastExc = bytes[2];
    return ERR_EXCEPTION;
  }
  if (bytes[1] != 0x03 || bytes[2] != 2 * count || nb != 3u + 2u * count + 1u) return ERR_RESPONSE;

  for (uint16_t i = 0; i < count; i++) out[i] = (int16_t)((bytes[3 + 2 * i] << 8) | bytes[4 + 2 * i]);
  return OK;
}

uint8_t lastException() { return lastExc; }

const char *resultText(Result r) {
  switch (r) {
    case OK: return "OK";
    case ERR_NOT_CONNECTED: return "nicht verbunden";
    case ERR_WRITE: return "Schreibfehler";
    case ERR_TIMEOUT: return "Timeout";
    case ERR_FRAME: return "Rahmenfehler";
    case ERR_LRC: return "LRC falsch";
    case ERR_RESPONSE: return "unerwartete Antwort";
    case ERR_EXCEPTION: return "Modbus-Exception";
  }
  return "?";
}

}  // namespace ModbusAscii
