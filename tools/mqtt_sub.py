# Minimaler MQTT-3.1.1-Subscriber ohne Abhaengigkeiten: mqtt_sub.py host topic seconds
import socket, sys, time, struct
host, topic, secs = sys.argv[1], sys.argv[2], float(sys.argv[3])
def enc_len(n):
    out = b""
    while True:
        b = n % 128; n //= 128
        out += bytes([b | (0x80 if n else 0)])
        if not n: return out
def s(x): x = x.encode(); return struct.pack(">H", len(x)) + x
sock = socket.create_connection((host, 1883), 5)
vh = s("MQTT") + bytes([4, 2]) + struct.pack(">H", 60) + s("oeg-pc-sub-%d" % int(time.time()))
sock.sendall(b"\x10" + enc_len(len(vh)) + vh)
sock.recv(4)
pl = struct.pack(">H", 1) + s(topic) + b"\x00"
sock.sendall(b"\x82" + enc_len(len(pl)) + pl)
sock.settimeout(1); buf = b""; end = time.time() + secs
while time.time() < end:
    try:
        d = sock.recv(4096)
        if not d: break
        buf += d
    except socket.timeout:
        continue
    while len(buf) >= 2:
        mult, ln, i = 1, 0, 1
        while True:
            if i >= len(buf): break
            b = buf[i]; ln += (b & 127) * mult; mult *= 128; i += 1
            if not b & 128: break
        else: break
        if len(buf) < i + ln: break
        pkt, buf = buf[:i + ln], buf[i + ln:]
        if pkt[0] >> 4 == 3:
            body = pkt[i:]; tl = struct.unpack(">H", body[:2])[0]
            t = body[2:2 + tl].decode(); off = 2 + tl + (2 if (pkt[0] >> 1) & 3 else 0)
            m = body[off:].decode("utf-8", "replace")
            if "/config" not in t: print(time.strftime("%H:%M:%S"), t, m[:300], flush=True)
