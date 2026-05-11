#!/usr/bin/env python3
"""
BrainCo Revo2Touch - WebSocket server + UI
Streams touch sensor data and motor positions to a browser.

Run:
    /opt/anaconda3/bin/python server.py
Then open: http://localhost:8765
"""

import sys, os, asyncio, json, time, pathlib
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "brainco-hand-sdk", "python"))

from aiohttp import web
from bc_stark_sdk import main_mod as sdk

PORT      = "/dev/cu.usbserial-FTAHKGS21"
BAUD      = sdk.Baudrate.Baud460800
SLAVE_ID  = 127
HTTP_PORT = 8765
STATIC    = pathlib.Path(__file__).parent / "static"

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


# ── hand loop ─────────────────────────────────────────────────────────────────
async def hand_loop(app):
    global hand_ctx
    while True:
        try:
            print(f"[hand] Connecting to {PORT}…")
            hand_ctx = await sdk.modbus_open(PORT, BAUD)
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

        except Exception as e:
            print(f"[hand] Error: {e}. Retrying in 3s…")
            state["connected"] = False
            hand_ctx = None
            await asyncio.sleep(3)


# ── WebSocket handler ─────────────────────────────────────────────────────────
async def ws_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    clients.add(ws)
    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                await handle_command(msg.data)
    finally:
        clients.discard(ws)
    return ws


async def handle_command(data: str):
    if hand_ctx is None:
        return
    try:
        cmd = json.loads(data)
        t = cmd.get("type")
        if t == "set_positions":
            await hand_ctx.set_finger_positions(SLAVE_ID, cmd["positions"])
        elif t == "pose":
            poses = {
                "open":  [0,   0,   0,    0,    0,    0],
                "fist":  [800, 800, 1000, 1000, 1000, 1000],
                "point": [800, 800, 0,    1000, 1000, 1000],
                "peace": [800, 800, 0,    0,    1000, 1000],
                "pinch": [500, 0,   500,  0,    0,    0],
            }
            p = poses.get(cmd.get("name"))
            if p:
                await hand_ctx.set_finger_positions(SLAVE_ID, p)
    except Exception as e:
        print(f"[cmd] {e}")


# ── HTTP ──────────────────────────────────────────────────────────────────────
async def index(request):
    return web.FileResponse(STATIC / "index.html")

async def on_startup(app):
    app["hand_task"] = asyncio.create_task(hand_loop(app))

async def on_cleanup(app):
    app["hand_task"].cancel()
    try:
        await app["hand_task"]
    except asyncio.CancelledError:
        pass


def main():
    STATIC.mkdir(exist_ok=True)
    app = web.Application()
    app.router.add_get("/",    index)
    app.router.add_get("/ws", ws_handler)
    app.router.add_static("/static", STATIC)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    print(f"Open http://localhost:{HTTP_PORT}  (Ctrl+C to stop)")
    web.run_app(app, host="127.0.0.1", port=HTTP_PORT, access_log=None)


if __name__ == "__main__":
    main()
