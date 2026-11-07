# scan.py host from to outfile  -> sendet "scan from to" an oeg_kmsd/cmd und sammelt Antworten
import socket, sys, time, struct, json
host, a, b, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
def enc_len(n):
    o = b""
    while True:
        x = n % 128; n //= 128; o += bytes([x | (0x80 if n else 0)])
        if not n: return o
def s(x): x = x.encode(); return struct.pack(">H", len(x)) + x
sock = socket.create_connection((host, 1883), 5)
vh = s("MQTT") + bytes([4, 2]) + struct.pack(">H", 60) + s("oeg-pc-scan-%d" % int(time.time()))
sock.sendall(b"\x10" + enc_len(len(vh)) + vh); sock.recv(4)
pl = struct.pack(">H", 1) + s("oeg_kmsd/scan") + b"\x00"
sock.sendall(b"\x82" + enc_len(len(pl)) + pl); time.sleep(0.5)
msg = s("oeg_kmsd/cmd") + f"scan {a} {b}".encode()
sock.sendall(b"\x30" + enc_len(len(msg)) + msg)
regs = {}; buf = b""; end = time.time() + 240; done = False
sock.settimeout(1)
while time.time() < end and not done:
    try:
        d = sock.recv(8192)
        if not d: break
        buf += d
    except socket.timeout:
        continue
    while len(buf) >= 2:
        mult, ln, i = 1, 0, 1
        while i < len(buf):
            x = buf[i]; ln += (x & 127) * mult; mult *= 128; i += 1
            if not x & 128: break
        if len(buf) < i + ln: break
        pkt, buf = buf[:i + ln], buf[i + ln:]
        if pkt[0] >> 4 != 3: continue
        body = pkt[i:]; tl = struct.unpack(">H", body[:2])[0]
        try: j = json.loads(body[2 + tl:].decode())
        except Exception: continue
        if "done" in j:
            if j["done"] == [a, b]: done = True; break
            continue
        if not (a <= j["s"] <= b): continue
        for k, v in enumerate(j["v"]): regs[j["s"] + k] = v
json.dump(regs, open(out, "w"), indent=0)
ok = {k: v for k, v in regs.items() if v is not None}
print(f"{a}-{b}: {len(regs)} gelesen, {len(ok)} gueltig, done={done}")
