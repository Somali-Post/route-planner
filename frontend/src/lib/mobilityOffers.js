import { findBestJourney } from './routing.js'
import { getStopById, getStopDisplayName, haversineDistanceKm } from './network.js'

const WALKING_SPEED_KPH = 4.5
const NEAREST_STOP_LIMIT = 10
const MAX_ACCESS_WALK_KM = 1.2
const MAX_EGRESS_WALK_KM = 1.2
const FALLBACK_NEAREST_STOP_LIMIT = 14
const FALLBACK_MAX_WALK_KM = 8
const ROUTE_DIVERSE_STOPS_PER_ROUTE = 3
const MAX_CANDIDATE_STOPS = 36
const STOP_PLACE_NEARBY_WALK_KM = 2

export function createStopPlace(stop) {
  if (!stop) {
    return null
  }

  return {
    type: 'stop',
    stopId: stop.id,
    name: getStopDisplayName(stop),
    lat: stop.lat,
    lng: stop.lng,
  }
}

export function createPointPlace(lat, lng, name = 'Map point') {
  return {
    type: 'point',
    stopId: '',
    name,
    lat,
    lng,
  }
}

export function buildMobilityOffers(network, originPlace, destinationPlace, allowedRouteIds = [], options = {}) {
  if (!network || !originPlace || !destinationPlace) {
    return []
  }

  const allowedRouteSet = new Set(
    allowedRouteIds.length ? allowedRouteIds : network.routes.map((route) => route.id),
  )
  const originCandidates = findAccessStops(network, originPlace, MAX_ACCESS_WALK_KM, allowedRouteSet)
  const destinationCandidates = findAccessStops(
    network,
    destinationPlace,
    MAX_EGRESS_WALK_KM,
    allowedRouteSet,
  )
  const offersBySignature = new Map()

  originCandidates.forEach((originCandidate) => {
    destinationCandidates.forEach((destinationCandidate) => {
      if (originCandidate.stop.id === destinationCandidate.stop.id) {
        addWalkOnlyOffer(offersBySignature, network, originPlace, destinationPlace, originCandidate)
        return
      }

      const journey = findBestJourney(
        network,
        originCandidate.stop.id,
        destinationCandidate.stop.id,
        allowedRouteIds,
        options,
      )

      if (!journey) {
        return
      }

      const offer = hydrateOffer(
        network,
        originPlace,
        destinationPlace,
        originCandidate,
        destinationCandidate,
        journey,
      )
      offersBySignature.set(offer.signature, offer)
    })
  })

  return [...offersBySignature.values()]
    .sort((first, second) => compareOffers(first, second))
    .slice(0, 5)
    .map((offer, index) => ({
      ...offer,
      id: `offer-${index + 1}`,
      rank: index + 1,
      label: index === 0 ? 'Recommended' : offer.transferCount === 0 ? 'Direct option' : 'Alternative',
    }))
}

function hydrateOffer(network, originPlace, destinationPlace, originCandidate, destinationCandidate, journey) {
  const accessLeg = buildWalkLeg(
    'access',
    originPlace,
    createStopPlace(originCandidate.stop),
    originCandidate.distanceKm,
  )
  const egressLeg = buildWalkLeg(
    'egress',
    createStopPlace(destinationCandidate.stop),
    destinationPlace,
    destinationCandidate.distanceKm,
  )
  const transitLegs = journey.segments.map((segment, index) => ({
    id: `transit-${index}`,
    mode: segment.type === 'ride' ? 'bus' : 'transfer',
    ...segment,
  }))
  const walkMinutes = accessLeg.minutes + egressLeg.minutes
  const totalMinutes = Math.round(journey.totalMinutes + walkMinutes)
  const routesUsed = [
    ...new Set(journey.segments.filter((segment) => segment.type === 'ride').map((segment) => segment.routeId)),
  ]

  return {
    id: '',
    rank: 0,
    label: '',
    type: 'bus-walk',
    provider: network.metadata.agency?.name || network.metadata.name,
    origin: originPlace,
    destination: destinationPlace,
    accessStopId: originCandidate.stop.id,
    egressStopId: destinationCandidate.stop.id,
    accessWalkMinutes: accessLeg.minutes,
    egressWalkMinutes: egressLeg.minutes,
    walkMinutes,
    rideMinutes: journey.segments
      .filter((segment) => segment.type === 'ride')
      .reduce((sum, segment) => sum + segment.minutes, 0),
    transferMinutes: journey.segments
      .filter((segment) => segment.type === 'transfer')
      .reduce((sum, segment) => sum + segment.transferMinutes, 0),
    waitMinutes: journey.waitMinutes,
    totalMinutes,
    transferCount: journey.transferCount,
    routeIds: routesUsed,
    journey,
    legs: [accessLeg, ...transitLegs, egressLeg].filter((leg) => leg.minutes > 0 || leg.mode !== 'walk'),
    signature: `${routesUsed.join('>')}|${originCandidate.stop.id}|${destinationCandidate.stop.id}|${journey.transferCount}|${totalMinutes}`,
  }
}

function addWalkOnlyOffer(offersBySignature, network, originPlace, destinationPlace, originCandidate) {
  const distanceKm = haversineDistanceKm(originPlace, destinationPlace)
  if (distanceKm > 1.2 || originPlace.type === 'stop' || destinationPlace.type === 'stop') {
    return
  }

  const leg = buildWalkLeg('walk', originPlace, destinationPlace, distanceKm)
  const offer = {
    id: '',
    rank: 0,
    label: '',
    type: 'walk',
    provider: 'Walking',
    origin: originPlace,
    destination: destinationPlace,
    accessStopId: originCandidate.stop.id,
    egressStopId: originCandidate.stop.id,
    accessWalkMinutes: leg.minutes,
    egressWalkMinutes: 0,
    walkMinutes: leg.minutes,
    rideMinutes: 0,
    transferMinutes: 0,
    waitMinutes: 0,
    totalMinutes: leg.minutes,
    transferCount: 0,
    routeIds: [],
    journey: null,
    legs: [leg],
    signature: `walk|${Math.round(distanceKm * 1000)}`,
  }
  offersBySignature.set(offer.signature, offer)
}

function findAccessStops(network, place, maxDistanceKm, allowedRouteSet) {
  if (place.type === 'stop') {
    const stop = getStopById(network, place.stopId)
    if (!stop) {
      return []
    }

    const nearbyCandidates = findPointAccessStops(
      network,
      { lat: stop.lat, lng: stop.lng },
      Math.max(maxDistanceKm, STOP_PLACE_NEARBY_WALK_KM),
      allowedRouteSet,
    ).filter((candidate) => candidate.stop.id !== stop.id)

    return [{ stop, distanceKm: 0, minutes: 0 }, ...nearbyCandidates]
  }

  return findPointAccessStops(network, place, maxDistanceKm, allowedRouteSet)
}

function findPointAccessStops(network, point, maxDistanceKm, allowedRouteSet) {
  const candidates = network.stops
    .filter((stop) => stop.routeIds.some((routeId) => allowedRouteSet.has(routeId)))
    .map((stop) => {
      const distanceKm = haversineDistanceKm(point, stop)
      return {
        stop,
        distanceKm,
        minutes: estimateWalkMinutes(distanceKm),
      }
    })
    .sort((first, second) => first.distanceKm - second.distanceKm)
  const walkableCandidates = candidates
    .filter((candidate) => candidate.distanceKm <= maxDistanceKm)
    .slice(0, NEAREST_STOP_LIMIT)
  const fallbackCandidates = candidates.filter(
    (candidate) => candidate.distanceKm <= FALLBACK_MAX_WALK_KM,
  )
  const routeDiverseCandidates = network.routes
    .filter((route) => allowedRouteSet.has(route.id))
    .flatMap((route) =>
      fallbackCandidates
        .filter((candidate) => candidate.stop.routeIds.includes(route.id))
        .slice(0, ROUTE_DIVERSE_STOPS_PER_ROUTE),
    )

  if (walkableCandidates.length > 0) {
    return uniqueCandidates([...walkableCandidates, ...routeDiverseCandidates])
      .sort((first, second) => first.distanceKm - second.distanceKm)
      .slice(0, MAX_CANDIDATE_STOPS)
  }

  return uniqueCandidates([
    ...fallbackCandidates.slice(0, FALLBACK_NEAREST_STOP_LIMIT),
    ...routeDiverseCandidates,
  ])
    .sort((first, second) => first.distanceKm - second.distanceKm)
    .slice(0, MAX_CANDIDATE_STOPS)
}

function uniqueCandidates(candidates) {
  const byStopId = new Map()
  candidates.forEach((candidate) => {
    if (!byStopId.has(candidate.stop.id)) {
      byStopId.set(candidate.stop.id, candidate)
    }
  })

  return [...byStopId.values()]
}

function buildWalkLeg(kind, from, to, distanceKm) {
  return {
    id: `walk-${kind}-${from.name}-${to.name}`,
    mode: 'walk',
    kind,
    from,
    to,
    distanceKm,
    minutes: estimateWalkMinutes(distanceKm),
  }
}

function estimateWalkMinutes(distanceKm) {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0.01) {
    return 0
  }

  return Math.max(1, Math.round((distanceKm / WALKING_SPEED_KPH) * 60))
}

function compareOffers(first, second) {
  if (first.totalMinutes !== second.totalMinutes) {
    return first.totalMinutes - second.totalMinutes
  }

  if (first.transferCount !== second.transferCount) {
    return first.transferCount - second.transferCount
  }

  return first.walkMinutes - second.walkMinutes
}
