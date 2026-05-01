# OTP2 Router Plan

`router/` is isolated from `frontend/`.

Current state:
- GTFS is in `router/data/gtfs/gtfs_mogadishu_pilot/`.
- OSM is not added yet.

Workflow:
- Make OTP2 work independently first.
- Verify OTP2 planning works before frontend integration.

Rule:
- No frontend changes while configuring OTP2 unless explicitly requested.
