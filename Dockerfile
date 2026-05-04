# Single image used by api, poll_worker, and hold_worker.
# The display stack (Xvfb/x11vnc/noVNC) is only used by hold_worker, but
# baking it into one image keeps the build simple ("one image, three commands").
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DEBIAN_FRONTEND=noninteractive \
    # Playwright browsers go here; baked into the image.
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright \
    # Default display for headed Chromium when running the hold worker.
    DISPLAY=:99

# ---------------------------------------------------------------------------
# System packages
# ---------------------------------------------------------------------------
# Split into two apt-get calls so the layer cache stays useful when we tweak
# the display stack without touching base deps.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        wget \
        git \
        tini \
    && rm -rf /var/lib/apt/lists/*

# Display stack: Xvfb (virtual X server), x11vnc (VNC server attached to the
# X display), websockify + noVNC (HTML/WebSocket front for VNC), plus a few
# fonts/utilities so Chromium renders reasonably.
RUN apt-get update && apt-get install -y --no-install-recommends \
        xvfb \
        x11vnc \
        novnc \
        websockify \
        xauth \
        x11-utils \
        fonts-liberation \
        fonts-noto-color-emoji \
        dbus-x11 \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# Python deps
# ---------------------------------------------------------------------------
WORKDIR /app

COPY backend/requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

# Install Chromium for Playwright. --with-deps pulls in the right shared libs
# for Debian slim so Chromium actually launches.
RUN playwright install --with-deps chromium

# ---------------------------------------------------------------------------
# App code
# ---------------------------------------------------------------------------
COPY backend /app

# Entrypoint for the hold worker (starts Xvfb + x11vnc + noVNC, then execs
# the arq worker).
COPY docker/hold-entrypoint.sh /usr/local/bin/hold-entrypoint.sh
COPY docker/novnc-hut-hunter.css /opt/hut-hunter-novnc/novnc-hut-hunter.css
COPY docker/novnc-hut-hunter.js /opt/hut-hunter-novnc/novnc-hut-hunter.js
RUN chmod +x /usr/local/bin/hold-entrypoint.sh

# Default command is the API. Compose overrides this for the workers.
EXPOSE 8000 6080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "run.py"]
