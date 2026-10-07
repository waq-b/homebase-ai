# Remote access

Homebase is built to run on one machine and is not meant to be exposed to the public internet. If you want to reach it from another device (a phone, a tablet, another computer), put both devices on a private network rather than opening a port.

## Option: a private overlay network (for example Tailscale or WireGuard)

1. Install the overlay network client on the machine running Homebase and on the device you want to call it from, and sign both into the same network.
2. Find the host's private address (for Tailscale, `tailscale ip -4`).
3. Call `http://<private-address>:3000` from the other device. No port forwarding or public DNS is needed.

The server listens on the port set by `PORT` (default `3000`).

## Auth

Auth is off by default. If anything other than your own machine can reach the server, set `HOMEBASE_API_KEY` in `.env`. All routes except `/health` and the dashboard's static files then require `Authorization: Bearer <key>`. The dashboard asks for the key in the browser. This is a single shared token, not per-user auth.

## Not provided

There is no TLS termination, rate limiting or request logging. If you need those, put a reverse proxy in front.
