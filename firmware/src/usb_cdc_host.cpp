#include "usb_cdc_host.h"

#include <Arduino.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/stream_buffer.h"
#include "freertos/task.h"
#include "usb/usb_host.h"

namespace UsbCdcHost {
namespace {

constexpr uint8_t NO_IF = 0xFF;
constexpr size_t CTRL_BUF = sizeof(usb_setup_packet_t) + 64;

usb_host_client_handle_t client = nullptr;
usb_device_handle_t dev = nullptr;

volatile uint8_t newDevAddr = 0;
volatile bool devGone = false;
volatile bool ready = false;
volatile bool connectedFlag = false;

uint8_t commIf = NO_IF, dataIf = NO_IF;
uint8_t epIn = 0, epOut = 0;
uint16_t mpsIn = 64, mpsOut = 64;
bool claimedComm = false, claimedData = false;

usb_transfer_t *xferCtrl = nullptr, *xferOut = nullptr, *xferIn = nullptr;
SemaphoreHandle_t semCtrl = nullptr, semOut = nullptr;
StreamBufferHandle_t rxBuf = nullptr;
volatile bool ctrlPending = false, outPending = false, inPending = false;

LineCoding lineCoding;

// ---------------------------------------------------------------- callbacks
void clientEventCb(const usb_host_client_event_msg_t *msg, void *) {
  switch (msg->event) {
    case USB_HOST_CLIENT_EVENT_NEW_DEV:
      newDevAddr = msg->new_dev.address;
      break;
    case USB_HOST_CLIENT_EVENT_DEV_GONE:
      devGone = true;
      ready = false;
      break;
    default:
      break;
  }
}

void ctrlCb(usb_transfer_t *t) {
  ctrlPending = false;
  xSemaphoreGive(semCtrl);
}

void outCb(usb_transfer_t *t) {
  outPending = false;
  xSemaphoreGive(semOut);
}

void inCb(usb_transfer_t *t) {
  if (t->status == USB_TRANSFER_STATUS_COMPLETED) {
    if (t->actual_num_bytes > 0) {
      xStreamBufferSend(rxBuf, t->data_buffer, t->actual_num_bytes, 0);
    }
    if (!devGone && usb_host_transfer_submit(t) == ESP_OK) return;  // weiter lauschen
  }
  inPending = false;
}

// ---------------------------------------------------------------- tasks
void hostLibTask(void *) {
  for (;;) {
    uint32_t flags = 0;
    usb_host_lib_handle_events(portMAX_DELAY, &flags);
    if (flags & USB_HOST_LIB_EVENT_FLAGS_NO_CLIENTS) usb_host_device_free_all();
  }
}

void clientTask(void *) {
  for (;;) usb_host_client_handle_events(client, portMAX_DELAY);
}

// ---------------------------------------------------------------- helpers
esp_err_t controlTransfer(uint8_t reqType, uint8_t req, uint16_t value, uint16_t index,
                          const uint8_t *data, uint16_t len) {
  if (ctrlPending || len > CTRL_BUF - sizeof(usb_setup_packet_t)) return ESP_ERR_INVALID_STATE;
  auto *setup = reinterpret_cast<usb_setup_packet_t *>(xferCtrl->data_buffer);
  setup->bmRequestType = reqType;
  setup->bRequest = req;
  setup->wValue = value;
  setup->wIndex = index;
  setup->wLength = len;
  if (len) memcpy(xferCtrl->data_buffer + sizeof(usb_setup_packet_t), data, len);
  xferCtrl->num_bytes = sizeof(usb_setup_packet_t) + len;
  xferCtrl->device_handle = dev;
  xferCtrl->bEndpointAddress = 0;
  xferCtrl->callback = ctrlCb;
  xferCtrl->context = nullptr;
  xferCtrl->timeout_ms = 1000;

  xSemaphoreTake(semCtrl, 0);
  ctrlPending = true;
  esp_err_t err = usb_host_transfer_submit_control(client, xferCtrl);
  if (err != ESP_OK) {
    ctrlPending = false;
    return err;
  }
  if (xSemaphoreTake(semCtrl, pdMS_TO_TICKS(1500)) != pdTRUE) return ESP_ERR_TIMEOUT;
  return xferCtrl->status == USB_TRANSFER_STATUS_COMPLETED ? ESP_OK : ESP_FAIL;
}

void parseConfig(const usb_config_desc_t *cfg) {
  const uint8_t *p = reinterpret_cast<const uint8_t *>(cfg);
  const uint16_t total = cfg->wTotalLength;
  int curIf = -1, curClass = -1, curAlt = 0;
  // Bevorzugt: Interface der Klasse CDC-Data (0x0A) mit Bulk IN + OUT.
  // Fallback: erstes Interface mit Bulk IN + OUT (herstellerspezifische Geraete).
  struct Cand { int ifn = -1; uint8_t in = 0, out = 0; uint16_t mi = 64, mo = 64; } cdcData, anyBulk, cur;

  auto finish = [&]() {
    if (cur.ifn >= 0 && cur.in && cur.out) {
      if (curClass == 0x0A && cdcData.ifn < 0) cdcData = cur;
      if (anyBulk.ifn < 0) anyBulk = cur;
    }
    cur = Cand();
  };

  for (uint16_t i = 0; i + 1 < total;) {
    const uint8_t len = p[i], type = p[i + 1];
    if (len < 2 || i + len > total) break;
    if (type == 0x04 && len >= 9) {  // Interface
      finish();
      curIf = p[i + 2];
      curAlt = p[i + 3];
      curClass = p[i + 5];
      cur.ifn = (curAlt == 0) ? curIf : -1;
      if (curClass == 0x02 && curAlt == 0 && commIf == NO_IF) commIf = curIf;
    } else if (type == 0x05 && len >= 7 && cur.ifn >= 0) {  // Endpoint
      const uint8_t addr = p[i + 2];
      const uint8_t attr = p[i + 3] & 0x03;
      const uint16_t mps = (p[i + 4] | (p[i + 5] << 8)) & 0x7FF;
      if (attr == 0x02) {  // Bulk
        if (addr & 0x80) { if (!cur.in) { cur.in = addr; cur.mi = mps; } }
        else             { if (!cur.out) { cur.out = addr; cur.mo = mps; } }
      }
    }
    i += len;
  }
  finish();

  const Cand &c = (cdcData.ifn >= 0) ? cdcData : anyBulk;
  if (c.ifn >= 0) {
    dataIf = c.ifn;
    epIn = c.in;
    epOut = c.out;
    mpsIn = c.mi ? c.mi : 64;
    mpsOut = c.mo ? c.mo : 64;
  }
}

void freeTransfers() {
  if (xferIn && !inPending) { usb_host_transfer_free(xferIn); xferIn = nullptr; }
  if (xferOut && !outPending) { usb_host_transfer_free(xferOut); xferOut = nullptr; }
}

void closeDevice() {
  ready = false;
  connectedFlag = false;
  const uint32_t t0 = millis();
  while ((inPending || outPending || ctrlPending) && millis() - t0 < 1000) delay(5);
  if (claimedData) { usb_host_interface_release(client, dev, dataIf); claimedData = false; }
  if (claimedComm) { usb_host_interface_release(client, dev, commIf); claimedComm = false; }
  freeTransfers();
  if (dev) { usb_host_device_close(client, dev); dev = nullptr; }
  commIf = dataIf = NO_IF;
  epIn = epOut = 0;
  Serial.println("[USB] Geraet getrennt");
}

bool openDevice(uint8_t addr) {
  if (usb_host_device_open(client, addr, &dev) != ESP_OK) {
    Serial.printf("[USB] Oeffnen von Adresse %u fehlgeschlagen\n", addr);
    dev = nullptr;
    return false;
  }
  const usb_device_desc_t *dd = nullptr;
  usb_host_get_device_descriptor(dev, &dd);
  Serial.printf("[USB] Geraet: VID=%04X PID=%04X Klasse=%02X\n", dd->idVendor, dd->idProduct,
                dd->bDeviceClass);

  const usb_config_desc_t *cfg = nullptr;
  if (usb_host_get_active_config_descriptor(dev, &cfg) != ESP_OK) { closeDevice(); return false; }
  parseConfig(cfg);
  if (dataIf == NO_IF) {
    Serial.println("[USB] Kein Interface mit Bulk IN/OUT gefunden (kein CDC-Geraet?)");
    closeDevice();
    return false;
  }
  Serial.printf("[USB] Comm-IF=%d Data-IF=%u EP-IN=%02X(%u) EP-OUT=%02X(%u)\n",
                commIf == NO_IF ? -1 : commIf, dataIf, epIn, mpsIn, epOut, mpsOut);

  if (commIf != NO_IF && usb_host_interface_claim(client, dev, commIf, 0) == ESP_OK) claimedComm = true;
  if (usb_host_interface_claim(client, dev, dataIf, 0) != ESP_OK) {
    Serial.println("[USB] Data-Interface belegt / Claim fehlgeschlagen");
    closeDevice();
    return false;
  }
  claimedData = true;

  if (usb_host_transfer_alloc(mpsIn, 0, &xferIn) != ESP_OK ||
      usb_host_transfer_alloc(mpsOut, 0, &xferOut) != ESP_OK) {
    closeDevice();
    return false;
  }

  // CDC: SET_LINE_CODING (0x20) und SET_CONTROL_LINE_STATE (0x22, DTR+RTS).
  // Fehler (STALL) werden ignoriert - manche Geraete unterstuetzen das nicht.
  const uint16_t ifForCtrl = (commIf != NO_IF) ? commIf : dataIf;
  uint8_t lc[7] = {
      (uint8_t)(lineCoding.baud), (uint8_t)(lineCoding.baud >> 8),
      (uint8_t)(lineCoding.baud >> 16), (uint8_t)(lineCoding.baud >> 24),
      lineCoding.stopBits, lineCoding.parity, lineCoding.dataBits};
  esp_err_t e1 = controlTransfer(0x21, 0x20, 0, ifForCtrl, lc, sizeof(lc));
  esp_err_t e2 = controlTransfer(0x21, 0x22, 0x0003, ifForCtrl, nullptr, 0);
  Serial.printf("[USB] LineCoding: %s, DTR/RTS: %s\n", esp_err_to_name(e1), esp_err_to_name(e2));

  xStreamBufferReset(rxBuf);
  xferIn->device_handle = dev;
  xferIn->bEndpointAddress = epIn;
  xferIn->num_bytes = mpsIn;  // IN muss Vielfaches der MPS sein
  xferIn->callback = inCb;
  xferIn->context = nullptr;
  inPending = true;
  if (usb_host_transfer_submit(xferIn) != ESP_OK) {
    inPending = false;
    closeDevice();
    return false;
  }

  ready = true;
  connectedFlag = true;
  Serial.println("[USB] CDC-Geraet bereit");
  return true;
}

}  // namespace

// ---------------------------------------------------------------- public API
bool begin(const LineCoding &lc) {
  lineCoding = lc;
  semCtrl = xSemaphoreCreateBinary();
  semOut = xSemaphoreCreateBinary();
  rxBuf = xStreamBufferCreate(1024, 1);

  usb_host_config_t hostCfg = {};
  hostCfg.skip_phy_setup = false;
  hostCfg.intr_flags = ESP_INTR_FLAG_LEVEL1;
  if (usb_host_install(&hostCfg) != ESP_OK) {
    Serial.println("[USB] usb_host_install fehlgeschlagen");
    return false;
  }
  xTaskCreatePinnedToCore(hostLibTask, "usb_lib", 4096, nullptr, 10, nullptr, 0);

  usb_host_client_config_t clientCfg = {};
  clientCfg.is_synchronous = false;
  clientCfg.max_num_event_msg = 5;
  clientCfg.async.client_event_callback = clientEventCb;
  clientCfg.async.callback_arg = nullptr;
  if (usb_host_client_register(&clientCfg, &client) != ESP_OK) {
    Serial.println("[USB] usb_host_client_register fehlgeschlagen");
    return false;
  }
  if (usb_host_transfer_alloc(CTRL_BUF, 0, &xferCtrl) != ESP_OK) return false;
  xTaskCreatePinnedToCore(clientTask, "usb_client", 4096, nullptr, 9, nullptr, 0);
  Serial.println("[USB] Host gestartet - warte auf Regler am nativen USB-Port");
  return true;
}

void poll() {
  if (devGone) {
    devGone = false;
    if (dev) closeDevice();
  }
  if (!dev && newDevAddr) {
    const uint8_t a = newDevAddr;
    newDevAddr = 0;
    openDevice(a);
  }
}

bool connected() { return ready; }

bool justConnected() {
  if (connectedFlag && ready) {
    connectedFlag = false;
    return true;
  }
  return false;
}

bool write(const uint8_t *data, size_t len, uint32_t timeoutMs) {
  while (len) {
    if (!ready || outPending) return false;
    const size_t chunk = len < xferOut->data_buffer_size ? len : xferOut->data_buffer_size;
    memcpy(xferOut->data_buffer, data, chunk);
    xferOut->num_bytes = chunk;
    xferOut->device_handle = dev;
    xferOut->bEndpointAddress = epOut;
    xferOut->callback = outCb;
    xferOut->context = nullptr;
    xSemaphoreTake(semOut, 0);
    outPending = true;
    if (usb_host_transfer_submit(xferOut) != ESP_OK) {
      outPending = false;
      return false;
    }
    if (xSemaphoreTake(semOut, pdMS_TO_TICKS(timeoutMs)) != pdTRUE) return false;
    if (xferOut->status != USB_TRANSFER_STATUS_COMPLETED) return false;
    data += chunk;
    len -= chunk;
  }
  return true;
}

size_t read(uint8_t *buf, size_t maxLen, uint32_t timeoutMs) {
  if (!rxBuf) return 0;
  return xStreamBufferReceive(rxBuf, buf, maxLen, pdMS_TO_TICKS(timeoutMs));
}

void flushRx() {
  uint8_t tmp[64];
  while (rxBuf && xStreamBufferReceive(rxBuf, tmp, sizeof(tmp), 0) > 0) {
  }
}

}  // namespace UsbCdcHost
