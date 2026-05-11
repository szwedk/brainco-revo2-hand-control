# BrainCo Revo2Touch Hand Control

A real-time web dashboard for the **BrainCo Revo2Touch** prosthetic hand — live tactile sensor readouts, force history chart, finger control sliders, and a pose library with custom code runner.

## Features

- **Tactile sensors** — per-finger normal/tangential force, proximity, contact detection with ripple effects
- **Force arc gauges** — circular progress rings that change color (green → yellow → red) at 500 N / 1500 N
- **Animated SVG hand** — gradient bones, energy dots, scan line, force-reactive glow at fingertips
- **Finger control** — drag, click-to-toggle, scroll, or use the tile sliders to set positions
- **Poses** — 12 presets (Open, Fist, Point, Peace, Pinch, OK, Gun, Claw, Relax, Rock, Three, Spread) + animated demo
- **Custom code runner** — write async JS with `send()`, `pose()`, `sleep()`, `log()` API
- **Force history chart** — rolling 200-sample canvas plot per finger
- **Resizable panels** — drag column handles to adjust layout

## Requirements

- Python 3.12 (bc-stark-sdk is incompatible with 3.13+)
- `bc-stark-sdk` — BrainCo SDK
- `aiohttp`

```bash
pip install aiohttp
# bc-stark-sdk install per BrainCo instructions
```

## Usage

```bash
python server.py
# Open http://localhost:8765
```

Edit `server.py` to match your device port and baud rate:

```python
PORT     = "/dev/cu.usbserial-XXXXXXX"
BAUDRATE = sdk.Baudrate.Baud460800
SLAVE_ID = 127
```

## Keyboard Shortcuts

| Key | Pose |
|-----|------|
| O | Open |
| F | Fist |
| P | Point |
| V | Peace |
| N | Pinch |
| K | OK |
| Space | Open |

## Stack

- Python + aiohttp WebSocket server
- Vanilla HTML/CSS/JS (no build step)
- SVG hand with CSS animations
- Canvas force history chart
