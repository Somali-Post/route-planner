# Routing Adapter

`frontend/src/services/journeyPlanner.js` is the only routing boundary.

Current state:
- `planJourney(...)` delegates to existing custom routing/mobility offer logic.

Future state:
- `planJourney(...)` will call OTP2.

Rules:
- UI should call `planJourney` only.
- Do not import `buildMobilityOffers` directly into `App.jsx`.
