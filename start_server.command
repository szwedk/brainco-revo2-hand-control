#!/bin/bash
# Double-click this file to start the BrainCo Dev Console.
# macOS will open a Terminal window automatically.

cd "$(dirname "$0")"

echo "============================================"
echo "  BrainCo Revo2Touch — Dev Console"
echo "============================================"
echo ""

# Try to find Python with the required packages
PYTHON=""
for candidate in /opt/anaconda3/bin/python python3 python; do
  if command -v "$candidate" &>/dev/null; then
    PYTHON="$candidate"
    break
  fi
done

if [ -z "$PYTHON" ]; then
  echo "ERROR: Python not found. Install Python 3 and try again."
  read -p "Press Enter to close..."
  exit 1
fi

echo "Starting server with: $PYTHON"
echo "Open your browser at: http://localhost:8765"
echo ""
echo "Press Ctrl+C to stop."
echo ""

# Open browser after a short delay
(sleep 2 && open "http://localhost:8765") &

"$PYTHON" server.py
