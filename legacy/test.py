#!/usr/bin/env python3
"""
BrainCo Revolimb Hand - Quick Test
Device: Revo2, slave_id=127
Port:   /dev/cu.usbserial-FTAHKGS21  @  460800 baud
Uses:   /opt/anaconda3/bin/python  (Python 3.12 required)

Run:
    /opt/anaconda3/bin/python test.py          # Full demo (default)
    /opt/anaconda3/bin/python test.py open     # Open hand
    /opt/anaconda3/bin/python test.py close    # Close hand (fist)
    /opt/anaconda3/bin/python test.py demo     # Open/close/gesture sequence
    /opt/anaconda3/bin/python test.py menu     # Interactive menu

Revo2 finger layout (6 values, normalized 0-1000):
  [Thumb, ThumbAux, Index, Middle, Ring, Pinky]
"""

import sys
import os
import asyncio

# Add SDK python dir to path
SDK_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "brainco-hand-sdk", "python")
sys.path.insert(0, SDK_DIR)

from bc_stark_sdk import main_mod as sdk

PORT     = "/dev/cu.usbserial-FTAHKGS21"
BAUD     = sdk.Baudrate.Baud460800
SLAVE_ID = 127

# Normalized positions (0 = open, 1000 = fully closed)
OPEN  = [0,   0,   0,    0,    0,    0]
FIST  = [800, 800, 1000, 1000, 1000, 1000]
POINT = [800, 800, 0,    1000, 1000, 1000]  # index extended
PEACE = [800, 800, 0,    0,    1000, 1000]  # index + middle extended
PINCH = [500, 0,   500,  0,    0,    0]     # thumb + index

FINGER_IDX = {"Thumb": 0, "ThumbAux": 1, "Index": 2, "Middle": 3, "Ring": 4, "Pinky": 5}


async def connect():
    print(f"Connecting to Revo2 on {PORT} @ 460800, slave_id={SLAVE_ID}...")
    ctx = await sdk.modbus_open(PORT, BAUD)
    await ctx.set_finger_unit_mode(SLAVE_ID, sdk.FingerUnitMode.Normalized)
    info = await ctx.get_device_info(SLAVE_ID)
    print(f"  Device: {info.description}")
    return ctx


async def set_pose(ctx, positions, label="", delay=2.0):
    if label:
        print(f"  {label}")
    await ctx.set_finger_positions(SLAVE_ID, positions)
    if delay > 0:
        await asyncio.sleep(delay)


async def open_hand(ctx):
    await set_pose(ctx, OPEN, "Open")


async def close_hand(ctx):
    await set_pose(ctx, FIST, "Fist")


async def demo_sequence(ctx):
    print("\n--- Revo2 Demo ---")
    await set_pose(ctx, OPEN,  "1. Open")
    await set_pose(ctx, FIST,  "2. Fist")
    await set_pose(ctx, POINT, "3. Point")
    await set_pose(ctx, PEACE, "4. Peace / V")
    await set_pose(ctx, PINCH, "5. Pinch")
    await set_pose(ctx, OPEN,  "6. Open")
    print("Demo complete!")


async def interactive_menu(ctx):
    print("\nCommands: o=open  c=close  p=point  v=peace  n=pinch  q=quit")
    while True:
        try:
            cmd = input("\n> ").strip().lower()
        except EOFError:
            break
        if cmd in ("q", "quit"):
            break
        elif cmd == "o":
            await set_pose(ctx, OPEN, delay=0)
        elif cmd in ("c", "f"):
            await set_pose(ctx, FIST, delay=0)
        elif cmd == "p":
            await set_pose(ctx, POINT, delay=0)
        elif cmd == "v":
            await set_pose(ctx, PEACE, delay=0)
        elif cmd == "n":
            await set_pose(ctx, PINCH, delay=0)
        elif cmd == "demo":
            await demo_sequence(ctx)
        else:
            print("  Unknown command")


async def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "demo"
    ctx = await connect()
    try:
        if cmd == "open":
            await open_hand(ctx)
        elif cmd == "close":
            await close_hand(ctx)
        elif cmd in ("demo", ""):
            await demo_sequence(ctx)
        elif cmd == "menu":
            await interactive_menu(ctx)
        else:
            print(f"Unknown command '{cmd}'. Try: open / close / demo / menu")
    finally:
        sdk.modbus_close(ctx)
        print("Disconnected.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nInterrupted.")

