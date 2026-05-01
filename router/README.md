# Router Workspace (OpenTripPlanner 2)

This `router/` folder is an isolated backend workspace for OpenTripPlanner 2 (OTP2).
It is intentionally separate from `frontend/` and `busmap/`.

## OTP Base Directory

OTP base directory is:
- `router/data/otp/`

Inside this folder OTP should use:
- `otp-config.json`
- `build-config.json`
- `mogadishu.gtfs.zip` (already created)
- `mogadishu.osm.pbf` (still needs to be added)
- graph output files (for example `graph.obj`) after build

## Current Status

- GTFS zip exists: `router/data/otp/mogadishu.gtfs.zip`
- OSM file is missing and must be added later as:
  - `router/data/otp/mogadishu.osm.pbf`
- Graph has not been built in this workflow yet.
- Frontend is not connected to OTP.

## Docker Compose Services

`docker-compose.yml` defines:
- `otp-build`: first graph build command (`--build --save /var/opentripplanner`)
- `otp-serve`: serve command after graph exists (`--load --serve /var/opentripplanner`)

Both services mount only:
- `./data/otp:/var/opentripplanner`

## Required Run Order

1. Add OSM extract to `router/data/otp/mogadishu.osm.pbf`.
2. Build graph first.
3. Start serve only after graph files exist (for example `graph.obj`).

## Add OSM Extract

OTP requires `router/data/otp/mogadishu.osm.pbf` before graph build.

For the quickest first test:
1. Download a Somalia `.osm.pbf` extract.
2. Rename or copy it to `router/data/otp/mogadishu.osm.pbf`.

Later, we can switch to a Mogadishu-only cropped extract for better performance.

Do not run Docker until `router/data/otp/mogadishu.osm.pbf` exists.

## Manual Commands (later)

From `router/`:

```bash
docker compose run --rm otp-build
```

Then:

```bash
docker compose up -d otp-serve
```

To view logs:

```bash
docker compose logs -f otp-serve
```

## Integration Rule

Do not connect `frontend/` until OTP `/otp/routers/default/plan` or GraphQL works independently.
