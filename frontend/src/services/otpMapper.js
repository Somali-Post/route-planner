const DEFAULT_ROUTE_COLOR = '#1677f2'
const WALK_METERS_PER_MINUTE = 80

export function mapOtpItinerariesToJourneyOptions({
  itineraries,
  originPlace,
  destinationPlace,
  routeOptions = [],
}) {
  if (!Array.isArray(itineraries) || !originPlace || !destinationPlace) {
    return []
  }

  const offers = itineraries
    .map((itinerary, index) =>
      mapItineraryToOffer({
        itinerary,
        index,
        originPlace,
        destinationPlace,
        routeOptions,
      }),
    )
    .filter(Boolean)

  return offers.map((offer, index) => ({
    ...offer,
    rank: index + 1,
    label: index === 0 ? 'Recommended' : offer.transferCount === 0 ? 'Direct option' : 'Alternative',
  }))
}

function mapItineraryToOffer({ itinerary, index, originPlace, destinationPlace, routeOptions }) {
  if (!itinerary || !Array.isArray(itinerary.legs) || !itinerary.legs.length) {
    return null
  }

  const busLegs = itinerary.legs.filter((leg) => normalizeMode(leg?.mode) === 'BUS')
  const walkLegs = itinerary.legs.filter((leg) => normalizeMode(leg?.mode) === 'WALK')

  if (!busLegs.length) {
    return null
  }

  const walkOfferLegs = walkLegs
    .map((leg, walkIndex) =>
      mapWalkLegToOfferLeg({
        leg,
        walkIndex,
        legCount: itinerary.legs.length,
      }),
    )
    .filter(Boolean)

  const rideSegments = busLegs
    .map((leg, busIndex) => mapBusLegToRideSegment(leg, busIndex, routeOptions))
    .filter(Boolean)

  const transferSegments = buildTransferSegments(itinerary.legs, rideSegments)

  const orderedSegments = buildOrderedSegments(rideSegments, transferSegments)
  const routeIds = [...new Set(rideSegments.map((segment) => segment.routeId).filter(Boolean))]

  const totalMinutes = toMinutes(itinerary.duration)
  const rideMinutes = rideSegments.reduce((sum, segment) => sum + (segment.minutes || 0), 0)
  const walkMinutesFromLegs = walkOfferLegs.reduce((sum, leg) => sum + (leg.minutes || 0), 0)
  const walkMinutesFromDistance = Number.isFinite(itinerary.walkDistance)
    ? Math.max(0, Math.round(itinerary.walkDistance / WALK_METERS_PER_MINUTE))
    : 0
  const walkMinutes = walkMinutesFromLegs > 0 ? walkMinutesFromLegs : walkMinutesFromDistance
  const transferMinutes = transferSegments.reduce(
    (sum, segment) => sum + (segment.transferMinutes || 0),
    0,
  )
  const transferCount = Math.max(0, rideSegments.length - 1)
  const waitMinutes = 0

  const departureMinutes = epochMsToMinutes(itinerary.startTime)
  const firstStopId = rideSegments[0]?.fromStopId || originPlace.stopId || originPlace.name || 'origin'
  const lastStopId =
    rideSegments[rideSegments.length - 1]?.toStopId ||
    destinationPlace.stopId ||
    destinationPlace.name ||
    'destination'

  const accessWalkMinutes = walkOfferLegs[0]?.minutes || 0
  const egressWalkMinutes = walkOfferLegs[walkOfferLegs.length - 1]?.minutes || 0

  return {
    id: `offer-${index + 1}`,
    rank: index + 1,
    label: '',
    type: rideSegments.length ? 'bus-walk' : 'walk',
    provider: 'OpenTripPlanner',
    origin: originPlace,
    destination: destinationPlace,
    accessStopId: firstStopId,
    egressStopId: lastStopId,
    accessWalkMinutes,
    egressWalkMinutes,
    walkMinutes,
    rideMinutes,
    transferMinutes,
    waitMinutes,
    totalMinutes,
    transferCount,
    routeIds,
    journey: {
      originId: firstStopId,
      destinationId: lastStopId,
      totalMinutes,
      departureMinutes,
      transferCount,
      waitMinutes,
      originName: originPlace.name || 'Origin',
      destinationName: destinationPlace.name || 'Destination',
      segments: orderedSegments,
    },
    legs: walkOfferLegs,
    signature: buildSignature(routeIds, firstStopId, lastStopId, transferCount, totalMinutes),
    otpItinerary: itinerary,
  }
}

function mapBusLegToRideSegment(leg, busIndex, routeOptions) {
  if (!leg || normalizeMode(leg.mode) !== 'BUS') {
    return null
  }

  const matchedRoute = matchRouteOption(leg.route, routeOptions)
  const routeId =
    matchedRoute?.id ||
    leg.route?.shortName ||
    leg.route?.longName ||
    `otp-route-${busIndex + 1}`
  const routeName = leg.route?.shortName || leg.route?.longName || matchedRoute?.name || 'Bus'
  const fromStopId = leg.from?.stop?.gtfsId || leg.from?.name || `from-${busIndex + 1}`
  const toStopId = leg.to?.stop?.gtfsId || leg.to?.name || `to-${busIndex + 1}`
  const fromStopName = leg.from?.stop?.name || leg.from?.name || 'Boarding stop'
  const toStopName = leg.to?.stop?.name || leg.to?.name || 'Alighting stop'
  const departureTime = formatEpochMsHHmm(leg.startTime)
  const arrivalTime = formatEpochMsHHmm(leg.endTime)
  const minutes = toMinutes(leg.duration)

  return {
    type: 'ride',
    routeId,
    routeName,
    headsign: leg.to?.name || leg.route?.longName || routeName,
    color: matchedRoute?.color || DEFAULT_ROUTE_COLOR,
    tripId: `${routeId}-${busIndex + 1}-${leg.startTime ?? 'na'}`,
    fromStopId,
    toStopId,
    fromStopName,
    toStopName,
    minutes,
    stopCount: 1,
    departureTime,
    arrivalTime,
    stopIds: [fromStopId, toStopId],
    stopTimes: [
      {
        stopId: fromStopId,
        departure: departureTime,
        arrival: departureTime,
      },
      {
        stopId: toStopId,
        departure: arrivalTime,
        arrival: arrivalTime,
      },
    ],
  }
}

function mapWalkLegToOfferLeg({ leg, walkIndex, legCount }) {
  if (!leg || normalizeMode(leg.mode) !== 'WALK') {
    return null
  }

  const kind = legCount === 1 ? 'walk' : walkIndex === 0 ? 'access' : walkIndex === legCount - 1 ? 'egress' : 'walk'
  const from = {
    name: leg.from?.name || 'Origin',
    lat: leg.from?.lat ?? null,
    lon: leg.from?.lon ?? null,
  }
  const to = {
    name: leg.to?.name || 'Destination',
    lat: leg.to?.lat ?? null,
    lon: leg.to?.lon ?? null,
  }

  return {
    id: `walk-${kind}-${walkIndex + 1}`,
    mode: 'walk',
    kind,
    from,
    to,
    minutes: toMinutes(leg.duration),
  }
}

function buildTransferSegments(allLegs, rideSegments) {
  if (rideSegments.length < 2) {
    return []
  }

  const transfers = []

  for (let index = 0; index < rideSegments.length - 1; index += 1) {
    const currentRide = rideSegments[index]
    const nextRide = rideSegments[index + 1]
    const betweenWalk = findWalkBetweenBusLegs(allLegs, index)
    const transferMinutes = betweenWalk ? toMinutes(betweenWalk.duration) : 0
    const stopName = currentRide.toStopName || nextRide.fromStopName || 'Transfer'

    transfers.push({
      type: 'transfer',
      fromStopId: currentRide.toStopId,
      toStopId: nextRide.fromStopId,
      fromRouteName: currentRide.routeName,
      toRouteName: nextRide.routeName,
      transferMinutes,
      waitMinutes: 0,
      stopName,
    })
  }

  return transfers
}

function buildOrderedSegments(rideSegments, transferSegments) {
  if (!rideSegments.length) {
    return []
  }

  const result = []
  rideSegments.forEach((ride, index) => {
    result.push(ride)
    if (transferSegments[index]) {
      result.push(transferSegments[index])
    }
  })
  return result
}

function findWalkBetweenBusLegs(allLegs, busPairIndex) {
  const busIndexes = allLegs
    .map((leg, index) => ({ mode: normalizeMode(leg?.mode), index }))
    .filter((entry) => entry.mode === 'BUS')

  const currentBus = busIndexes[busPairIndex]
  const nextBus = busIndexes[busPairIndex + 1]
  if (!currentBus || !nextBus) {
    return null
  }

  for (let index = currentBus.index + 1; index < nextBus.index; index += 1) {
    const leg = allLegs[index]
    if (normalizeMode(leg?.mode) === 'WALK') {
      return leg
    }
  }

  return null
}

function matchRouteOption(route, routeOptions) {
  if (!route || !Array.isArray(routeOptions) || !routeOptions.length) {
    return null
  }

  const names = [
    route.shortName,
    route.longName,
    route.name,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase())

  return (
    routeOptions.find((option) => {
      const optionName = String(option?.name || '').trim().toLowerCase()
      return names.includes(optionName)
    }) || null
  )
}

function normalizeMode(mode) {
  return String(mode || '').toUpperCase()
}

function toMinutes(seconds) {
  if (!Number.isFinite(seconds)) {
    return 1
  }
  return Math.max(1, Math.round(seconds / 60))
}

function formatEpochMsHHmm(value) {
  if (!Number.isFinite(value)) {
    return ''
  }

  const date = new Date(value)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function epochMsToMinutes(value) {
  if (!Number.isFinite(value)) {
    return 0
  }
  const date = new Date(value)
  return date.getHours() * 60 + date.getMinutes()
}

function buildSignature(routeIds, originId, destinationId, transferCount, totalMinutes) {
  const routePart = routeIds.length ? routeIds.join('>') : 'walk'
  return `${routePart}|${originId}|${destinationId}|${transferCount}|${totalMinutes}`
}

// Self-check intent:
// mapOtpItinerariesToJourneyOptions({ itineraries, originPlace, destinationPlace, routeOptions })
// -> returns Offer[] compatible with existing planner UI contracts.
