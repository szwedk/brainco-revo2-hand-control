#!/usr/bin/env python3
"""
BrainCo Revo2Touch - WebSocket server + UI
Streams touch sensor data and motor positions to a browser.

Run:
    /opt/anaconda3/bin/python server.py
Then open: http://localhost:8765
"""

import sys, os, asyncio, json, time, pathlib, logging
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "brainco-hand-sdk", "python"))

try:
    from serial.tools import list_ports as _list_ports
    HAS_SERIAL_TOOLS = True
except ImportError:
    HAS_SERIAL_TOOLS = False

from aiohttp import web
from bc_stark_sdk import main_mod as sdk

try:
    from pymodbus.client import AsyncModbusTcpClient
    # Silence pymodbus connection noise — we log our own clean messages
    logging.getLogger("pymodbus").setLevel(logging.CRITICAL)
    HAS_PYMODBUS = True
except ImportError:
    HAS_PYMODBUS = False
    print("[inspire] pymodbus not found — Inspire hands disabled. Run: pip install pymodbus")

# Silence BrainCo SDK internal modbus noise (slave[127] timeout messages)
logging.getLogger("bc_stark_sdk").setLevel(logging.CRITICAL)

PORT      = "/dev/cu.usbserial-FTAHKGS21"

# Allow port override via config file
def _get_active_port() -> str:
    cfg = _load_config() if pathlib.Path(__file__).parent.joinpath("inspire_config.json").exists() else {}
    return cfg.get("port", PORT)
BAUD      = sdk.Baudrate.Baud460800
SLAVE_ID  = 127
HTTP_PORT = 8765
STATIC    = pathlib.Path(__file__).parent / "static"

# ── Inspire Hand Config (from README: github.com/feraco/insprehands) ──────────
# Hardware: Inspire RH56DFTP Dexterous Hand × 2, Modbus TCP
# Finger order: [0:Little, 1:Ring, 2:Middle, 3:Index, 4:Thumb-bend, 5:Thumb-rotate]
# 0 = fully open, 1000 = fully closed
INSPIRE_LEFT_IP   = "192.168.124.210"
INSPIRE_RIGHT_IP  = "192.168.124.211"
INSPIRE_PORT      = 6000
INSPIRE_REG_SPEED  = 1522   # Speed set (1–1000)
INSPIRE_REG_ANGLES = 1486   # Angle set target (0–1000)
INSPIRE_REG_ACTUAL = 1546   # Actual angles (read-only)

# ── Config file (persists IP assignments across restarts) ─────────────────────
CONFIG_FILE = pathlib.Path(__file__).parent / "inspire_config.json"

def _load_config() -> dict:
    cfg = {"left": INSPIRE_LEFT_IP, "right": INSPIRE_RIGHT_IP}
    if CONFIG_FILE.exists():
        try:
            saved = json.loads(CONFIG_FILE.read_text())
            cfg.update({k: v for k, v in saved.items() if k in ("left", "right")})
        except Exception:
            pass
    return cfg

def _save_config(cfg: dict):
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2))

# Mutable — updated at runtime via the /api/inspire/config endpoint
INSPIRE_HANDS: dict = _load_config()

INSPIRE_RETRY_INTERVAL = 10.0   # seconds between reconnect attempts when offline
inspire_retry_after: dict = {"left": 0.0, "right": 0.0}
inspire_logged_offline: dict = {"left": False, "right": False}  # suppress repeat log spam

# Pose library — finger order: [Little, Ring, Middle, Index, Thumb-bend, Thumb-rotate]
INSPIRE_POSES = {
    "open":   [0,    0,    0,    0,    0,    0  ],
    "fist":   [1000, 1000, 1000, 1000, 1000, 500],
    "point":  [1000, 1000, 1000, 0,    1000, 500],
    "peace":  [1000, 1000, 0,    0,    900,  500],
    "pinch":  [1000, 1000, 1000, 500,  500,  500],
    "ok":     [0,    0,    0,    800,  200,  500],
    "gun":    [1000, 1000, 1000, 0,    0,    0  ],
    "claw":   [500,  500,  500,  500,  500,  500],
    "spread": [0,    0,    0,    0,    0,    0  ],
    "relax":  [300,  300,  300,  300,  200,  500],
    "three":  [1000, 0,    0,    0,    1000, 500],
    "rock":   [0,    1000, 1000, 0,    1000, 500],
    "thumbs": [1000, 1000, 1000, 1000, 0,    500],
}

inspire_state = {
    "left_connected":  False,
    "right_connected": False,
    "left_angles":     [0] * 6,
    "right_angles":    [0] * 6,
    "left_ip":         INSPIRE_HANDS["left"],
    "right_ip":        INSPIRE_HANDS["right"],
}
inspire_conns: dict = {}   # "left" | "right" → AsyncModbusTcpClient

# ── global state ──────────────────────────────────────────────────────────────
state = {
    "connected": False,
    "has_touch": False,
    "device_info": "",
    "positions": [0] * 6,
    "touch": [
        {"normal": 0.0, "tangential": 0.0, "direction": 0.0,
         "proximity": 0.0, "status": 0}
        for _ in range(5)
    ],
    "ts": 0,
}
clients: set = set()
hand_ctx = None
hand_retry_after = 0.0
hand_logged_offline = False


# ── hand loop ─────────────────────────────────────────────────────────────────
async def hand_loop(app):
    global hand_ctx, hand_retry_after, hand_logged_offline
    while True:
        now = time.monotonic()
        if now < hand_retry_after:
            await asyncio.sleep(0.5)
            continue
        active_port = _get_active_port()
        try:
            print(f"[hand] Connecting to {active_port}…")
            hand_ctx = await sdk.modbus_open(active_port, BAUD)
            await hand_ctx.set_finger_unit_mode(SLAVE_ID, sdk.FingerUnitMode.Normalized)

            # detect capabilities
            info = await hand_ctx.get_device_info(SLAVE_ID)
            has_touch = info.uses_revo2_touch_api()
            state["has_touch"] = has_touch
            state["device_info"] = f"{info.hardware_type} · {info.serial_number} · fw {info.firmware_version}"
            print(f"[hand] {info.description}  |  touch={has_touch}")

            # enable touch sensors
            if has_touch:
                try:
                    await hand_ctx.touch_sensor_setup(SLAVE_ID, 0x1F)
                    await asyncio.sleep(1.0)
                except Exception as e:
                    print(f"[hand] touch_sensor_setup skipped: {e}")

            state["connected"] = True
            hand_logged_offline = False
            print("[hand] Streaming…")

            while True:
                # ---- touch ----
                if has_touch:
                    try:
                        statuses = await hand_ctx.get_touch_sensor_status(SLAVE_ID)
                        for i, s in enumerate(statuses[:5]):
                            state["touch"][i] = {
                                "normal":     round(float(s.normal_force1),        2),
                                "tangential": round(float(s.tangential_force1),    2),
                                "direction":  round(float(s.tangential_direction1),1),
                                "proximity":  round(float(s.self_proximity1),      1),
                                "status":     int(s.status),
                            }
                    except Exception:
                        pass

                # ---- motor positions ----
                try:
                    ms = await hand_ctx.get_motor_status(SLAVE_ID)
                    state["positions"] = [round(float(p), 1) for p in ms.now_positions[:6]]
                except Exception:
                    pass

                state["ts"] = round(time.time() * 1000)

                # ---- broadcast ----
                msg = json.dumps(state)
                dead = set()
                for ws in list(clients):
                    try:
                        await ws.send_str(msg)
                    except Exception:
                        dead.add(ws)
                clients.difference_update(dead)

                await asyncio.sleep(0.04)   # ~25 Hz

        except Exception:
            state["connected"] = False
            hand_ctx = None
            hand_retry_after = time.monotonic() + 3.0
            if not hand_logged_offline:
                print("[hand] Not connected — retrying silently every 3s…")
                hand_logged_offline = True
            await asyncio.sleep(0.5)


# ── Inspire Hand helpers ───────────────────────────────────────────────────────
async def _inspire_write(client, angles: list, speed: int = 500):
    await client.write_registers(address=INSPIRE_REG_SPEED,  values=[speed] * 6)
    await client.write_registers(address=INSPIRE_REG_ANGLES, values=angles)


async def _inspire_send_all(angles: list, speed: int = 500):
    """Send the same angle set to every connected Inspire hand."""
    for side, client in list(inspire_conns.items()):
        if client.connected:
            try:
                await _inspire_write(client, angles, speed)
            except Exception as e:
                print(f"[inspire] send {side}: {e}")


async def _inspire_wave():
    for _ in range(3):
        await _inspire_send_all([0] * 6, speed=300)
        await asyncio.sleep(0.4)
        await _inspire_send_all([500] * 6, speed=300)
        await asyncio.sleep(0.4)
    await _inspire_send_all([0] * 6, speed=300)


# ── Inspire hand connection loop ───────────────────────────────────────────────
async def inspire_loop(app):
    if not HAS_PYMODBUS:
        return
    while True:
        now = time.monotonic()

        # Attempt (re)connection only after backoff expires
        for side in ("left", "right"):
            ip = INSPIRE_HANDS.get(side, "")
            if not ip:
                continue
            already = inspire_conns.get(side)
            if already and already.connected:
                continue
            if now < inspire_retry_after.get(side, 0.0):
                continue   # still in backoff window
            client = AsyncModbusTcpClient(ip, port=INSPIRE_PORT, timeout=2)
            try:
                await client.connect()
                if client.connected:
                    inspire_conns[side] = client
                    inspire_state[f"{side}_connected"] = True
                    inspire_retry_after[side] = 0.0
                    inspire_logged_offline[side] = False
                    print(f"[inspire] {side} hand connected ✓  ({ip})")
                else:
                    inspire_state[f"{side}_connected"] = False
                    inspire_retry_after[side] = now + INSPIRE_RETRY_INTERVAL
                    if not inspire_logged_offline[side]:
                        print(f"[inspire] {side} unreachable ({ip}) — retrying silently every {int(INSPIRE_RETRY_INTERVAL)}s")
                        inspire_logged_offline[side] = True
            except Exception:
                inspire_state[f"{side}_connected"] = False
                inspire_retry_after[side] = now + INSPIRE_RETRY_INTERVAL
                if not inspire_logged_offline[side]:
                    print(f"[inspire] {side} unreachable ({ip}) — retrying silently every {int(INSPIRE_RETRY_INTERVAL)}s")
                    inspire_logged_offline[side] = True

        # Poll angles on connected hands
        for side, client in list(inspire_conns.items()):
            if not client.connected:
                inspire_state[f"{side}_connected"] = False
                inspire_logged_offline[side] = False   # allow one log on next failure
                inspire_conns.pop(side, None)
                inspire_retry_after[side] = time.monotonic() + INSPIRE_RETRY_INTERVAL
                continue
            try:
                r = await client.read_holding_registers(address=INSPIRE_REG_ACTUAL, count=6)
                if not r.isError():
                    inspire_state[f"{side}_angles"] = list(r.registers)
                inspire_state[f"{side}_connected"] = True
            except Exception:
                inspire_state[f"{side}_connected"] = False
                inspire_logged_offline[side] = False   # allow one log on next failure
                inspire_conns.pop(side, None)
                inspire_retry_after[side] = time.monotonic() + INSPIRE_RETRY_INTERVAL

        # Always broadcast current IPs so the UI stays in sync
        inspire_state["left_ip"]  = INSPIRE_HANDS.get("left",  "")
        inspire_state["right_ip"] = INSPIRE_HANDS.get("right", "")

        msg = json.dumps({"type": "inspire", **inspire_state})
        dead = set()
        for ws in list(clients):
            try:
                await ws.send_str(msg)
            except Exception:
                dead.add(ws)
        clients.difference_update(dead)

        await asyncio.sleep(0.2)   # 5 Hz — light polling


# ── WebSocket handler ─────────────────────────────────────────────────────────
async def ws_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    clients.add(ws)
    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                await handle_command(msg.data)
    except asyncio.CancelledError:
        pass
    finally:
        clients.discard(ws)
    return ws


async def handle_command(data: str):
    try:
        cmd = json.loads(data)
        t = cmd.get("type")

        # ── BrainCo commands ──────────────────────────────────────────────────
        if t in ("set_positions", "pose"):
            if hand_ctx is None:
                return
            if t == "set_positions":
                await hand_ctx.set_finger_positions(SLAVE_ID, cmd["positions"])
            elif t == "pose":
                poses = {
                    "open":   [0,   0,   0,    0,    0,    0],
                    "fist":   [800, 800, 1000, 1000, 1000, 1000],
                    "point":  [800, 800, 0,    1000, 1000, 1000],
                    "peace":  [800, 800, 0,    0,    1000, 1000],
                    "pinch":  [500, 0,   500,  0,    0,    0],
                    "ok":     [700, 600, 700,  0,    0,    0],
                    "gun":    [0,   0,   0,    1000, 1000, 1000],
                    "claw":   [0,   0,   500,  500,  500,  500],
                    "spread": [0,   0,   0,    0,    0,    0],
                    "relax":  [300, 200, 300,  300,  300,  300],
                    "three":  [800, 800, 0,    0,    0,    1000],
                    "rock":   [0,   0,   1000, 1000, 0,    0],
                }
                p = poses.get(cmd.get("name"))
                if p:
                    await hand_ctx.set_finger_positions(SLAVE_ID, p)

        # ── Inspire commands ──────────────────────────────────────────────────
        elif t == "inspire_pose":
            angles = INSPIRE_POSES.get(cmd.get("name"))
            if angles:
                await _inspire_send_all(angles, speed=cmd.get("speed", 500))
        elif t == "inspire_set_positions":
            angles = cmd.get("positions", [0] * 6)
            await _inspire_send_all(angles, speed=cmd.get("speed", 500))
        elif t == "inspire_wave":
            asyncio.create_task(_inspire_wave())

    except Exception as e:
        if isinstance(e, asyncio.CancelledError):
            return
        print(f"[cmd] {e}")


# ── HTTP ──────────────────────────────────────────────────────────────────────
async def index(request):
    return web.FileResponse(STATIC / "index.html")


async def api_inspire_config_get(request):
    """Return current Inspire hand IP configuration."""
    return web.json_response({
        "left":  INSPIRE_HANDS.get("left",  ""),
        "right": INSPIRE_HANDS.get("right", ""),
        "port":  INSPIRE_PORT,
    })


async def api_inspire_config_post(request):
    """Update Inspire hand IPs, close stale connections, persist to disk."""
    try:
        body = await request.json()
        new_left  = str(body.get("left",  INSPIRE_HANDS.get("left",  ""))).strip()
        new_right = str(body.get("right", INSPIRE_HANDS.get("right", ""))).strip()
        for side, new_ip in (("left", new_left), ("right", new_right)):
            if INSPIRE_HANDS.get(side) != new_ip:
                old = inspire_conns.pop(side, None)
                if old:
                    try: old.close()
                    except Exception: pass
                inspire_state[f"{side}_connected"] = False
                inspire_retry_after[side] = 0.0   # connect immediately
        INSPIRE_HANDS["left"]  = new_left
        INSPIRE_HANDS["right"] = new_right
        inspire_state["left_ip"]  = new_left
        inspire_state["right_ip"] = new_right
        _save_config({"left": new_left, "right": new_right})
        print(f"[inspire] config updated — left={new_left}  right={new_right}")
        return web.json_response({"ok": True, "left": new_left, "right": new_right})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=400)


async def api_inspire_scan(request):
    """Scan 192.168.124.200-215 + known IPs and return responding Inspire hands."""
    if not HAS_PYMODBUS:
        return web.json_response({"error": "pymodbus not installed"}, status=500)
    found = {}
    candidates = {f"192.168.124.{i}" for i in range(200, 216)}
    candidates.update([INSPIRE_LEFT_IP, INSPIRE_RIGHT_IP])
    async def _probe(ip):
        c = AsyncModbusTcpClient(ip, port=INSPIRE_PORT, timeout=1)
        try:
            await c.connect()
            if c.connected:
                r = await c.read_holding_registers(address=1000, count=1)
                if not r.isError():
                    found[ip] = {"hand_id": r.registers[0]}
                c.close()
        except Exception:
            pass
    await asyncio.gather(*[_probe(ip) for ip in candidates])
    return web.json_response(found)

async def api_restart(request):
    """Restart the server process (used by the UI restart button)."""
    import threading
    def _do_restart():
        import time
        time.sleep(0.3)
        os.execv(sys.executable, [sys.executable] + sys.argv)
    threading.Thread(target=_do_restart, daemon=True).start()
    return web.json_response({"ok": True})

async def api_ports(request):
    """List available serial ports."""
    current = _get_active_port()
    ports = []
    if HAS_SERIAL_TOOLS:
        ports = sorted(p.device for p in _list_ports.comports())
    if current not in ports:
        ports.insert(0, current)
    return web.json_response({"ports": ports, "current": current})

async def api_set_port(request):
    """Persist a new serial port selection to config and return ok."""
    try:
        body = await request.json()
        new_port = str(body.get("port", "")).strip()
        if not new_port:
            return web.json_response({"ok": False, "error": "empty port"}, status=400)
        cfg = _load_config()
        cfg["port"] = new_port
        _save_config(cfg)
        return web.json_response({"ok": True, "port": new_port})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=400)

async def on_startup(app):
    app["hand_task"]    = asyncio.create_task(hand_loop(app))
    app["inspire_task"] = asyncio.create_task(inspire_loop(app))

async def on_cleanup(app):
    for key in ("hand_task", "inspire_task"):
        task = app.get(key)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass


def main():
    STATIC.mkdir(exist_ok=True)
    app = web.Application()
    app.router.add_get("/",    index)
    app.router.add_get("/ws", ws_handler)
    app.router.add_get( "/api/inspire/config", api_inspire_config_get)
    app.router.add_post("/api/inspire/config", api_inspire_config_post)
    app.router.add_get( "/api/inspire/scan",   api_inspire_scan)
    app.router.add_post("/api/restart",         api_restart)
    app.router.add_get( "/api/ports",            api_ports)
    app.router.add_post("/api/port",             api_set_port)
    app.router.add_static("/static", STATIC)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    cfg = _load_config()
    print(f"Open http://localhost:{HTTP_PORT}  (Ctrl+C to stop)")
    print(f"[inspire] Left={cfg['left']}  Right={cfg['right']}  Port={INSPIRE_PORT}")
    web.run_app(app, host="0.0.0.0", port=HTTP_PORT, access_log=None)


if __name__ == "__main__":
    main()
