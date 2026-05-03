# TRMNL Server

A self-hosted server for TRMNL e-ink displays, running as a [BYOS (Bring Your Own Server)](https://docs.trmnl.com/go/diy/byos) backend.

## Features

- **Extensible widgets**: build your own, or use the included ones: weather (conditions, hourly forecast, UV/pollen) and iCloud Photos (cycles through a shared album).
- **TRMNL BYOS compatible**: devices register, poll for content, and receive a PNG to display. Drop-in replacement for the TRMNL cloud.
- **Local dashboard**: a management UI served alongside the API to configure and monitor the server.
- **SQLite logging**: all device activity and logs are stored locally, no external database.
