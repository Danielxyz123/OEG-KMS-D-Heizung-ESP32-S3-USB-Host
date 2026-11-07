#pragma once
#include <stddef.h>
#include <stdint.h>

// Minimaler USB-Host-Treiber fuer CDC-ACM-Geraete (virtueller COM-Port)
// auf dem nativen USB-OTG-Port des ESP32-S2/S3.
// Ein Geraet gleichzeitig; Hot-Plug wird unterstuetzt.
namespace UsbCdcHost {

struct LineCoding {
  uint32_t baud;
  uint8_t stopBits;  // 0 = 1, 1 = 1.5, 2 = 2
  uint8_t parity;    // 0 = none, 1 = odd, 2 = even, 3 = mark, 4 = space
  uint8_t dataBits;  // 5, 6, 7, 8
};

bool begin(const LineCoding &lc);

// Regelmaessig aus loop() aufrufen: oeffnet neue Geraete, schliesst abgezogene.
void poll();

bool connected();
bool justConnected();  // true genau einmal nach jedem erfolgreichen Verbinden

bool write(const uint8_t *data, size_t len, uint32_t timeoutMs = 500);
size_t read(uint8_t *buf, size_t maxLen, uint32_t timeoutMs);
void flushRx();

}  // namespace UsbCdcHost
