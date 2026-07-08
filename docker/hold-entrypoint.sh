#!/usr/bin/env bash
# Entrypoint for the hold_worker container.
#
# Starts the display stack so headed Chromium (launched by Playwright from
# the arq worker) has somewhere to draw, then exposes that display via VNC
# over a WebSocket (noVNC) so the /pay/{job_id} page can embed it in an
# iframe.
#
# Layout:
#   Xvfb        :99               - virtual X server (frame buffer only)
#   x11vnc      :0 on :99         - VNC server attached to the X display
#   websockify  :6080 -> :5900    - HTTP/WebSocket proxy serving noVNC UI
#
# Finally, exec the arq hold worker as PID 1's child; tini (from the
# Dockerfile ENTRYPOINT) reaps the helpers when the worker exits.

set -euo pipefail

DISPLAY_NUM="${DISPLAY_NUM:-99}"
# Public noVNC HTTP/WebSocket port. Keep VNC_PORT as the primary env name
# because the API also uses it when building the /pay iframe URL.
NOVNC_PORT="${VNC_PORT:-${NOVNC_PORT:-6080}}"
# Raw RFB/VNC port exposed only inside the container. Keep it distinct from
# the public noVNC port so setting VNC_PORT in .env does not break startup.
X11VNC_PORT="${X11VNC_PORT:-5900}"
# Must comfortably contain the headed Chromium window the hold worker launches:
# Playwright uses a 1440x900 context viewport (see _shared.py _browser_page),
# and the headed window adds ~85px of tab strip + toolbar on top, for a
# ~1440x985 window drawn at (0,0) with no window manager. A smaller framebuffer
# clips the window's right/bottom edges *before* VNC ever captures them — no
# noVNC client setting can recover pixels that aren't in the framebuffer — which
# is exactly the right-edge clipping seen on the /pay page. Keep this at least as
# large as the window (with a little headroom).
SCREEN_GEOMETRY="${SCREEN_GEOMETRY:-1440x1000x24}"

export DISPLAY=":${DISPLAY_NUM}"

NOVNC_HTML="/usr/share/novnc/vnc.html"
NOVNC_CSS_TARGET="/usr/share/novnc/app/styles/hut-hunter-mobile.css"
NOVNC_JS_TARGET="/usr/share/novnc/app/hut-hunter-mobile.js"

if [[ -f /opt/hut-hunter-novnc/novnc-hut-hunter.css ]]; then
    cp /opt/hut-hunter-novnc/novnc-hut-hunter.css "${NOVNC_CSS_TARGET}"
fi
if [[ -f /opt/hut-hunter-novnc/novnc-hut-hunter.js ]]; then
    cp /opt/hut-hunter-novnc/novnc-hut-hunter.js "${NOVNC_JS_TARGET}"
fi

if [[ -f "${NOVNC_HTML}" ]]; then
    if ! grep -q 'hut-hunter-mobile.css' "${NOVNC_HTML}"; then
        sed -i \
            's#<link rel="stylesheet" href="app/styles/input.css">#<link rel="stylesheet" href="app/styles/input.css">\n    <link rel="stylesheet" href="app/styles/hut-hunter-mobile.css">#' \
            "${NOVNC_HTML}"
    fi
    if ! grep -q 'hut-hunter-mobile.js' "${NOVNC_HTML}"; then
        sed -i \
            's#</head>#    <script type="module" crossorigin="anonymous" src="app/hut-hunter-mobile.js"></script>\n</head>#' \
            "${NOVNC_HTML}"
    fi
fi

# Clean up any stale X11 state left over from a previous run of this
# container. With `restart: unless-stopped` Docker reuses the container's
# writable layer, so /tmp survives restarts — if Xvfb was killed before it
# could clean up (which is what happens on a worker crash or `docker stop`
# with a short grace period), the lock file sticks around and the next
# boot dies with "Server is already active for display 99".
X_LOCK="/tmp/.X${DISPLAY_NUM}-lock"
X_SOCK="/tmp/.X11-unix/X${DISPLAY_NUM}"
if [[ -e "${X_LOCK}" || -e "${X_SOCK}" ]]; then
    echo "[hold-entrypoint] removing stale X lock/socket (${X_LOCK}, ${X_SOCK})"
    rm -f "${X_LOCK}" "${X_SOCK}" || true
fi

echo "[hold-entrypoint] starting Xvfb on ${DISPLAY} (${SCREEN_GEOMETRY})"
Xvfb "${DISPLAY}" -screen 0 "${SCREEN_GEOMETRY}" -ac +extension RANDR &
XVFB_PID=$!

# Wait for the X server to come up before starting things that attach to it.
for i in $(seq 1 50); do
    if xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; then
        break
    fi
    sleep 0.1
done

echo "[hold-entrypoint] starting x11vnc on :${X11VNC_PORT}"
# -forever    keep running after first client disconnects
# -shared     allow multiple simultaneous viewers
# -nopw       no auth (the whole service is behind the app / local network)
# -rfbport    VNC port
# -quiet      reduce log noise
x11vnc \
    -display "${DISPLAY}" \
    -forever \
    -shared \
    -nopw \
    -rfbport "${X11VNC_PORT}" \
    -quiet \
    -bg \
    -o /tmp/x11vnc.log

echo "[hold-entrypoint] starting noVNC (websockify) on :${NOVNC_PORT}"
# websockify serves the noVNC HTML/JS from /usr/share/novnc and proxies
# WebSocket traffic to the VNC port. Opening http://host:6080/vnc.html
# (or the vnc_lite.html) connects.
websockify \
    --web=/usr/share/novnc \
    "${NOVNC_PORT}" \
    "localhost:${X11VNC_PORT}" &
WEBSOCKIFY_PID=$!

cleanup() {
    echo "[hold-entrypoint] shutting down helpers"
    kill "${WEBSOCKIFY_PID}" 2>/dev/null || true
    kill "${XVFB_PID}" 2>/dev/null || true
    # x11vnc ran with -bg; it's a detached child of init, tini will reap it.
    # Remove lock/socket so the next boot doesn't see them as "server already
    # active". Xvfb normally does this itself on SIGTERM, but belt-and-braces.
    rm -f "${X_LOCK}" "${X_SOCK}" 2>/dev/null || true
}
trap cleanup EXIT

echo "[hold-entrypoint] exec: $*"
exec "$@"
