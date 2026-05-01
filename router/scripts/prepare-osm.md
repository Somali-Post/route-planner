# Prepare OSM Input

OTP requires `router/data/otp/mogadishu.osm.pbf` before graph build.

For the quickest first test:
1. Download a Somalia `.osm.pbf` extract.
2. Place it at `router/data/otp/mogadishu.osm.pbf` (rename/copy as needed).

Later, replace this with a Mogadishu-only cropped extract for performance.

Do not run Docker until the file exists.

## Checklist

- [ ] Download Somalia `.osm.pbf`
- [ ] Place it at `router/data/otp/mogadishu.osm.pbf`
- [ ] Confirm file exists
- [ ] Then run graph build
