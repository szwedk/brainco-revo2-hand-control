#!/usr/bin/env python3
"""
mirror.py — Mirror your hand movements to the BrainCo Revo2Touch in real time.

Uses MediaPipe Hands to track webcam hand landmarks and streams finger
positions to server.py via WebSocket.

Requirements:
    pip install mediapipe opencv-python websockets numpy

Usage:
    python mirror.py
    python mirror.py --ws ws://localhost:8765/ws --cam 0 --alpha 0.35
"""

import asyncio
import json
import argparse
import threading
import time

import numpy as np
import cv2
import mediapipe as mp
import websockets

# ── MediaPipe landmark indices ────────────────────────────────────────────────
FINGER_JOINTS = {
    "index":  [5, 6, 7, 8],
    "middle": [9, 10, 11, 12],
    "ring":   [13, 14, 15, 16],
    "pinky":  [17, 18, 19, 20],
}


def _angle(v1, v2):
    n1, n2 = np.linalg.norm(v1), np.linalg.norm(v2)
    if n1 < 1e-6 or n2 < 1e-6:
        return 0.0
    return float(np.degrees(np.arccos(np.clip(np.dot(v1, v2) / (n1 * n2), -1, 1))))


def _curl(lm, joints):
    """Sum of PIP + DIP bend angles → 0-1 curl value."""
    p = [np.array([lm[j].x, lm[j].y, lm[j].z]) for j in joints]
    v0 = p[1] - p[0]
    v1 = p[2] - p[1]
    v2 = p[3] - p[2]
    return min((_angle(-v0, v1) + _angle(-v1, v2)) / 160.0, 1.0)


def _thumb_curl(lm):
    """Thumb CMC→MCP→IP→TIP bend angles → 0-1 curl."""
    p = [np.array([lm[j].x, lm[j].y, lm[j].z]) for j in [1, 2, 3, 4]]
    v0 = p[1] - p[0]
    v1 = p[2] - p[1]
    v2 = p[3] - p[2]
    return min((_angle(-v0, v1) + _angle(-v1, v2)) / 140.0, 1.0)


def _thumb_aux(lm):
    """
    Thumb abduction → ThAux motor.
    Measures normalised distance from thumb tip to index MCP.
    Close = adducted (1.0), far = spread (0.0).
    """
    tip     = np.array([lm[4].x,  lm[4].y,  lm[4].z])
    idx_mcp = np.array([lm[5].x,  lm[5].y,  lm[5].z])
    wrist   = np.array([lm[0].x,  lm[0].y,  lm[0].z])
    mid_mcp = np.array([lm[9].x,  lm[9].y,  lm[9].z])
    hand_sz = np.linalg.norm(mid_mcp - wrist) + 1e-6
    dist    = np.linalg.norm(tip - idx_mcp) / hand_sz
    # dist ≈ 0.2 (adducted) … 0.7 (abducted)
    return max(0.0, min(1.0, 1.0 - (dist - 0.2) / 0.5))


def lm_to_positions(lm):
    """
    Convert MediaPipe landmarks to 6 motor positions [0..1000].
    Order: [thumb, thaux, index, middle, ring, pinky]
    """
    return [
        int(_thumb_curl(lm)                    * 1000),
        int(_thumb_aux(lm)                     * 1000),
        int(_curl(lm, FINGER_JOINTS["index"])  * 1000),
        int(_curl(lm, FINGER_JOINTS["middle"]) * 1000),
        int(_curl(lm, FINGER_JOINTS["ring"])   * 1000),
        int(_curl(lm, FINGER_JOINTS["pinky"])  * 1000),
    ]


# ── Exponential moving average smoothing ─────────────────────────────────────
class EMA:
    def __init__(self, alpha=0.35):
        self.alpha = alpha
        self.val = None

    def update(self, x):
        if self.val is None:
            self.val = list(x)
        else:
            a = self.alpha
            self.val = [int(a * xv + (1 - a) * sv) for xv, sv in zip(x, self.val)]
        return list(self.val)

    def reset(self):
        self.val = None


# ── WebSocket sender (runs in a background thread) ────────────────────────────
class WSSender:
    def __init__(self, url):
        self.url = url
        self.connected = False
        self._positions = [0] * 6
        self._lock = threading.Lock()
        threading.Thread(target=lambda: asyncio.run(self._loop()), daemon=True).start()

    def send(self, positions):
        with self._lock:
            self._positions = list(positions)

    async def _loop(self):
        while True:
            try:
                async with websockets.connect(self.url, ping_interval=None) as ws:
                    self.connected = True
                    prev = None
                    while True:
                        with self._lock:
                            pos = list(self._positions)
                        if pos != prev:
                            await ws.send(json.dumps({"type": "set_positions", "positions": pos}))
                            prev = pos
                        await asyncio.sleep(1 / 30)
            except Exception:
                self.connected = False
                await asyncio.sleep(1.5)


# ── Visual overlay ────────────────────────────────────────────────────────────
MOTOR_NAMES  = ["Thumb", "ThAux", "Index", "Middle", "Ring", "Pinky"]
MOTOR_COLORS = [
    (250, 139, 167),  # purple  (BGR)
    (253, 181, 196),  # light purple
    (250, 165,  96),  # blue
    (153, 211,  52),  # green
    ( 36, 191, 251),  # yellow
    (113, 113, 248),  # red
]


def draw_overlay(frame, positions, connected, fps):
    h, w = frame.shape[:2]

    # Top status bar
    sc = (60, 200, 80) if connected else (80, 80, 200)
    st = "Connected to server.py" if connected else "Reconnecting to server.py..."
    cv2.rectangle(frame, (0, 0), (w, 34), (15, 17, 25), -1)
    cv2.putText(frame, f"BrainCo Mirror  |  {st}  |  {fps:.0f} fps",
                (10, 22), cv2.FONT_HERSHEY_DUPLEX, 0.5, sc, 1, cv2.LINE_AA)

    # Finger bars (bottom-right)
    BAR_W, BAR_H = 20, 150
    BAR_X = w - 170
    BAR_Y = h - BAR_H - 40

    for i, (name, pos, col) in enumerate(zip(MOTOR_NAMES, positions, MOTOR_COLORS)):
        bx = BAR_X + i * 27
        # background
        cv2.rectangle(frame, (bx, BAR_Y), (bx + BAR_W, BAR_Y + BAR_H), (28, 31, 42), -1)
        # fill
        fill_h = int(BAR_H * pos / 1000)
        if fill_h > 0:
            cv2.rectangle(frame, (bx, BAR_Y + BAR_H - fill_h), (bx + BAR_W, BAR_Y + BAR_H), col, -1)
        # border
        cv2.rectangle(frame, (bx, BAR_Y), (bx + BAR_W, BAR_Y + BAR_H), (60, 65, 80), 1)
        # value
        cv2.putText(frame, str(pos), (max(bx - 4, 0), BAR_Y + BAR_H + 16),
                    cv2.FONT_HERSHEY_PLAIN, 0.72, (180, 185, 200), 1, cv2.LINE_AA)
        # abbrev name
        cv2.putText(frame, name[:2], (bx + 2, BAR_Y - 5),
                    cv2.FONT_HERSHEY_PLAIN, 0.85, col, 1, cv2.LINE_AA)

    cv2.putText(frame, "Q: quit", (10, h - 10),
                cv2.FONT_HERSHEY_PLAIN, 0.9, (80, 85, 100), 1)


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Mirror hand movements to BrainCo Revo2Touch")
    parser.add_argument("--ws",    default="ws://localhost:8765/ws", help="Server WebSocket URL")
    parser.add_argument("--cam",   default=0, type=int, help="Camera device index")
    parser.add_argument("--alpha", default=0.35, type=float,
                        help="EMA smoothing (0=max smooth, 1=raw). Default 0.35")
    args = parser.parse_args()

    mp_hands = mp.solutions.hands
    mp_draw  = mp.solutions.drawing_utils
    mp_style = mp.solutions.drawing_styles
    hands    = mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=1,
        min_detection_confidence=0.6,
        min_tracking_confidence=0.5,
    )

    cap = cv2.VideoCapture(args.cam)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    cap.set(cv2.CAP_PROP_FPS, 30)

    if not cap.isOpened():
        print(f"[mirror] Cannot open camera {args.cam}")
        return

    sender   = WSSender(args.ws)
    smoother = EMA(alpha=args.alpha)
    positions = [0] * 6

    print(f"[mirror] Tracking hand → {args.ws}")
    print(f"[mirror] Smoothing alpha={args.alpha}  (lower=smoother)")
    print("[mirror] Hold your hand in front of the camera. Press Q to quit.")

    fps_t = time.time()
    fps_count = 0
    fps = 0.0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame = cv2.flip(frame, 1)  # mirror view (natural for user)
        rgb   = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False
        results = hands.process(rgb)
        rgb.flags.writeable = True

        detected = False
        if results.multi_hand_landmarks:
            lms = results.multi_hand_landmarks[0]
            mp_draw.draw_landmarks(
                frame, lms, mp_hands.HAND_CONNECTIONS,
                mp_style.get_default_hand_landmarks_style(),
                mp_style.get_default_hand_connections_style(),
            )
            raw = lm_to_positions(lms.landmark)
            positions = smoother.update(raw)
            sender.send(positions)
            detected = True

        if not detected:
            # Smoothly relax to open when hand leaves frame
            positions = smoother.update([0] * 6)
            sender.send(positions)

        # FPS counter
        fps_count += 1
        if time.time() - fps_t >= 1.0:
            fps = fps_count / (time.time() - fps_t)
            fps_count = 0
            fps_t = time.time()

        draw_overlay(frame, positions, sender.connected, fps)
        cv2.imshow("BrainCo Mirror", frame)

        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    # Open hand on exit
    sender.send([0] * 6)
    time.sleep(0.2)
    hands.close()
    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
