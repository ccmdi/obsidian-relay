#!/bin/sh
set -e

CALDAV_USER="${RELAY_CALDAV_USER:-relay}"
CALENDAR_DIR="/app/radicale/data/collection-root/${CALDAV_USER}/calendar"

# Generate htpasswd on first run
if [ ! -f /app/users ]; then
  htpasswd -bcB /app/users "$CALDAV_USER" "$RELAY_CALDAV_PASS"
  echo "Created CalDAV user: $CALDAV_USER"
fi

# Ensure calendar collection exists with Radicale props
mkdir -p "$CALENDAR_DIR"

if [ ! -f "$CALENDAR_DIR/.Radicale.props" ]; then
  cat > "$CALENDAR_DIR/.Radicale.props" << 'PROPS'
{"tag": "VCALENDAR", "D:displayname": "Relay", "C:supported-calendar-component-set": "VEVENT"}
PROPS
  echo "Initialized calendar collection"
fi

# Start Radicale in background
CALDAV_PORT="${RELAY_PORT_CALDAV:-5232}"
radicale --config /app/radicale/config --server-hosts "0.0.0.0:${CALDAV_PORT}" &

# Start the REST API
exec node /app/dist/index.cjs
