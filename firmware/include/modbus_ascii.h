#pragma once
#include <stdint.h>

// Modbus ASCII Master ueber UsbCdcHost.
namespace ModbusAscii {

enum Result : int8_t {
  OK = 0,
  ERR_NOT_CONNECTED = -1,
  ERR_WRITE = -2,
  ERR_TIMEOUT = -3,
  ERR_FRAME = -4,
  ERR_LRC = -5,
  ERR_RESPONSE = -6,
  ERR_EXCEPTION = -7,  // Geraet meldet Modbus-Exception (Code in lastException())
};

// Funktion 03 (Read Holding Registers), max. 60 Register pro Aufruf.
Result readHolding(uint8_t slave, uint16_t start, uint16_t count, int16_t *out, uint32_t timeoutMs);

uint8_t lastException();
const char *resultText(Result r);

}  // namespace ModbusAscii
