import { buildMobilityOffers } from '../lib/mobilityOffers'

export function planJourney({
  network,
  originPlace,
  destinationPlace,
  originStop,
  destinationStop,
  visibleRouteIds,
  departureTime,
}) {
  void originStop
  void destinationStop

  return buildMobilityOffers(
    network,
    originPlace,
    destinationPlace,
    visibleRouteIds,
    { departureTime },
  )
}
