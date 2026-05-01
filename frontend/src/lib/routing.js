import {
  formatServiceTime,
  getRouteById,
  getStopById,
  getStopDisplayName,
  haversineDistanceKm,
} from './network.js'

const MAX_WALK_TRANSFER_KM = 0.75
const WALKING_SPEED_KPH = 4.5
const DEFAULT_TRANSFER_MINUTES = 3

export function findBestJourney(rawNetwork, originId, destinationId, allowedRouteIds = [], options = {}) {
  const network = rawNetwork

  if (!originId || !destinationId || originId === destinationId) {
    return null
  }

  const departureMinutes = parseTimeToMinutes(options.departureTime) ?? getCurrentMinutes()
  const serviceDate = options.serviceDate ?? new Date()
  const activeRouteIds = Array.isArray(allowedRouteIds)
    ? new Set(allowedRouteIds)
    : new Set(network.routes.map((route) => route.id))
  const trips = (network.trips ?? []).filter(
    (trip) => activeRouteIds.has(trip.routeId) && isTripActive(network, trip, serviceDate),
  )

  if (!trips.length) {
    return null
  }

  const tripById = new Map(trips.map((trip) => [trip.id, trip]))
  const stopEntries = buildStopEntries(trips)

  if (!stopEntries.has(originId) || !trips.some((trip) => trip.stopTimes.some((stopTime) => stopTime.stopId === destinationId))) {
    return null
  }

  const transfersByStop = buildTransfersByStop(network, stopEntries)
  const sourceNodeId = '__source__'

  function getEdges(nodeId, currentCost) {
    if (nodeId === sourceNodeId) {
      return buildBoardingEdges(originId, stopEntries, tripById, departureMinutes)
    }

    const { tripId, stopIndex } = fromNodeId(nodeId)
    const trip = tripById.get(tripId)
    const stopTime = trip?.stopTimes[stopIndex]

    if (!trip || !stopTime) {
      return []
    }

    const edges = []

    if (stopTime.stopId === destinationId) {
      edges.push({
        to: '__target__',
        cost: 0,
        meta: {
          type: 'arrive',
          routeId: trip.routeId,
          tripId: trip.id,
          stopId: stopTime.stopId,
        },
      })
    }

    const nextStopTime = trip.stopTimes[stopIndex + 1]
    if (nextStopTime) {
      const segmentMinutes = Math.max(1, nextStopTime.arrivalMinutes - stopTime.departureMinutes)
      edges.push({
        to: toNodeId(trip.id, stopIndex + 1),
        cost: segmentMinutes,
        meta: {
          type: 'ride',
          routeId: trip.routeId,
          tripId: trip.id,
          headsign: trip.headsign,
          fromStopId: stopTime.stopId,
          toStopId: nextStopTime.stopId,
          fromStopIndex: stopIndex,
          toStopIndex: stopIndex + 1,
        },
      })
    }

    const absoluteReadyMinutes = departureMinutes + currentCost.minutes
    const transferOptions = transfersByStop.get(stopTime.stopId) ?? []
    transferOptions.forEach((transfer) => {
      const readyAfterTransfer = absoluteReadyMinutes + transfer.minutes
      const candidates = stopEntries.get(transfer.toStopId) ?? []

      candidates.forEach((candidate) => {
        if (candidate.tripId === trip.id) {
          return
        }

        const candidateTrip = tripById.get(candidate.tripId)
        if (!candidateTrip) {
          return
        }

        const fromRouteId = trip.routeId
        const toRouteId = candidateTrip.routeId
        const constrained =
          (transfer.fromRouteId && transfer.fromRouteId !== fromRouteId) ||
          (transfer.toRouteId && transfer.toRouteId !== toRouteId)

        if (constrained) {
          return
        }

        const nextDeparture = nextDepartureForStop(candidateTrip, candidate.stopIndex, readyAfterTransfer)
        if (nextDeparture === null) {
          return
        }

        const waitMinutes = Math.max(0, nextDeparture - readyAfterTransfer)

        edges.push({
          to: toNodeId(candidate.tripId, candidate.stopIndex),
          cost: transfer.minutes + waitMinutes,
        meta: {
          type: 'transfer',
            fromStopId: stopTime.stopId,
            toStopId: transfer.toStopId,
            fromRouteId,
            toRouteId,
            fromTripId: trip.id,
            toTripId: candidateTrip.id,
            transferMinutes: transfer.minutes,
          waitMinutes,
          departureMinutes: nextDeparture,
          distanceKm: transfer.distanceKm ?? 0,
          source: transfer.source,
        },
        })
      })
    })

    return edges
  }

  const result = dijkstra(getEdges, sourceNodeId, '__target__')

  if (!result) {
    return null
  }

  return hydrateJourney(network, originId, destinationId, departureMinutes, result)
}

export function buildJourneySummary(network, journey) {
  const instructions = journey.segments.map((segment, index) => {
    if (segment.type === 'ride') {
      const route = getRouteById(network, segment.routeId)

      return {
        id: `${segment.routeId}-${index}`,
        text: `${index === 0 ? 'Board' : 'Take'} ${route.name} toward ${
          segment.headsign
        } at ${segment.fromStopName} and stay on until ${segment.toStopName} (${
          segment.stopCount
        } stops, ${segment.minutes} min).`,
      }
    }

    return {
      id: `${segment.fromStopId}-${segment.toStopId}-${index}`,
      text: `Transfer from ${segment.fromRouteName} to ${segment.toRouteName} (${segment.minutes} min).`,
    }
  })

  instructions.push({
    id: 'arrival',
    text: `Arrive at ${journey.destinationName}.`,
  })

  return {
    totalMinutes: journey.totalMinutes,
    transferCount: journey.transferCount,
    routesUsed: [
      ...new Set(journey.segments.filter((segment) => segment.type === 'ride').map((segment) => segment.routeId)),
    ],
    instructions,
  }
}

function buildBoardingEdges(stopId, stopEntries, tripById, departureMinutes) {
  return (stopEntries.get(stopId) ?? []).flatMap((entry) => {
    const trip = tripById.get(entry.tripId)
    const nextDeparture = trip ? nextDepartureForStop(trip, entry.stopIndex, departureMinutes) : null

    if (nextDeparture === null) {
      return []
    }

    return [
      {
        to: toNodeId(entry.tripId, entry.stopIndex),
        cost: Math.max(0, nextDeparture - departureMinutes),
        meta: {
          type: 'board',
          routeId: trip.routeId,
          tripId: trip.id,
          stopId,
          waitMinutes: Math.max(0, nextDeparture - departureMinutes),
          departureMinutes: nextDeparture,
        },
      },
    ]
  })
}

function buildStopEntries(trips) {
  const stopEntries = new Map()

  trips.forEach((trip) => {
    trip.stopTimes.forEach((stopTime, stopIndex) => {
      if (!trip.stopTimes[stopIndex + 1]) {
        return
      }

      if (!stopEntries.has(stopTime.stopId)) {
        stopEntries.set(stopTime.stopId, [])
      }

      stopEntries.get(stopTime.stopId).push({
        tripId: trip.id,
        routeId: trip.routeId,
        stopIndex,
      })
    })
  })

  return stopEntries
}

function buildTransfersByStop(network, stopEntries) {
  const transfersByStop = new Map()
  const explicitPairs = new Set()

  function addTransfer(fromStopId, transfer) {
    if (!stopEntries.has(fromStopId) || !stopEntries.has(transfer.toStopId)) {
      return
    }

    if (!transfersByStop.has(fromStopId)) {
      transfersByStop.set(fromStopId, [])
    }

    transfersByStop.get(fromStopId).push(transfer)
  }

  ;(network.transfers ?? []).forEach((transfer) => {
    explicitPairs.add(`${transfer.fromStopId}->${transfer.toStopId}`)
    addTransfer(transfer.fromStopId, {
      toStopId: transfer.toStopId,
      fromRouteId: transfer.fromRouteId,
      toRouteId: transfer.toRouteId,
      minutes: transfer.minTransferMinutes,
      source: 'gtfs',
    })
  })

  stopEntries.forEach((_entries, stopId) => {
    addTransfer(stopId, {
      toStopId: stopId,
      minutes: DEFAULT_TRANSFER_MINUTES,
      source: 'same-stop',
    })
  })

  const activeStops = [...stopEntries.keys()].map((stopId) => getStopById(network, stopId)).filter(Boolean)
  for (let firstIndex = 0; firstIndex < activeStops.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < activeStops.length; secondIndex += 1) {
      const firstStop = activeStops[firstIndex]
      const secondStop = activeStops[secondIndex]
      const distanceKm = haversineDistanceKm(firstStop, secondStop)

      if (distanceKm > MAX_WALK_TRANSFER_KM) {
        continue
      }

      const minutes = estimateWalkTransferMinutes(distanceKm)

      if (!explicitPairs.has(`${firstStop.id}->${secondStop.id}`)) {
        addTransfer(firstStop.id, {
          toStopId: secondStop.id,
          minutes,
          distanceKm,
          source: 'walk',
        })
      }

      if (!explicitPairs.has(`${secondStop.id}->${firstStop.id}`)) {
        addTransfer(secondStop.id, {
          toStopId: firstStop.id,
          minutes,
          distanceKm,
          source: 'walk',
        })
      }
    }
  }

  return transfersByStop
}

function hydrateJourney(network, originId, destinationId, departureMinutes, result) {
  const segments = []
  const routeSegments = []
  let currentRide = null
  let pendingBoard = null

  result.edges.forEach((edge) => {
    if (edge.meta.type === 'board') {
      pendingBoard = edge.meta
      return
    }

    if (edge.meta.type === 'ride') {
      const route = getRouteById(network, edge.meta.routeId)
      const fromStop = getStopById(network, edge.meta.fromStopId)
      const toStop = getStopById(network, edge.meta.toStopId)
      const trip = network.trips?.find((candidate) => candidate.id === edge.meta.tripId)
      const fromStopTime = trip?.stopTimes[edge.meta.fromStopIndex]
      const toStopTime = trip?.stopTimes[edge.meta.toStopIndex]
      const timeOffset =
        currentRide?.tripId === edge.meta.tripId
          ? currentRide.timeOffset
          : (pendingBoard?.departureMinutes ?? fromStopTime?.departureMinutes ?? 0) -
            (fromStopTime?.departureMinutes ?? 0)

      if (
        !currentRide ||
        currentRide.type !== 'ride' ||
        currentRide.tripId !== edge.meta.tripId ||
        currentRide.toStopId !== fromStop.id
      ) {
        currentRide = {
          type: 'ride',
          routeId: route.id,
          routeName: route.name,
          tripId: edge.meta.tripId,
          headsign: edge.meta.headsign,
          color: route.color,
          fromStopId: fromStop.id,
          fromStopName: getStopDisplayName(fromStop),
          toStopId: toStop.id,
          toStopName: getStopDisplayName(toStop),
          stopCount: 1,
          minutes: edge.cost,
          waitMinutes: pendingBoard?.waitMinutes ?? 0,
          timeOffset,
          departureTime: formatServiceTime((fromStopTime?.departureMinutes ?? 0) + timeOffset),
          arrivalTime: formatServiceTime((toStopTime?.arrivalMinutes ?? 0) + timeOffset),
          stopIds: [fromStop.id, toStop.id],
          stopTimes: [
            {
              stopId: fromStop.id,
              departure: formatServiceTime((fromStopTime?.departureMinutes ?? 0) + timeOffset),
              arrival: formatServiceTime((fromStopTime?.arrivalMinutes ?? 0) + timeOffset),
            },
            {
              stopId: toStop.id,
              departure: formatServiceTime((toStopTime?.departureMinutes ?? 0) + timeOffset),
              arrival: formatServiceTime((toStopTime?.arrivalMinutes ?? 0) + timeOffset),
            },
          ],
        }
        segments.push(currentRide)
      } else {
        currentRide.toStopId = toStop.id
        currentRide.toStopName = getStopDisplayName(toStop)
        currentRide.stopCount += 1
        currentRide.minutes += edge.cost
        currentRide.arrivalTime = formatServiceTime(
          (toStopTime?.arrivalMinutes ?? 0) + currentRide.timeOffset,
        )
        currentRide.stopIds.push(toStop.id)
        currentRide.stopTimes.push({
          stopId: toStop.id,
          departure: formatServiceTime((toStopTime?.departureMinutes ?? 0) + currentRide.timeOffset),
          arrival: formatServiceTime((toStopTime?.arrivalMinutes ?? 0) + currentRide.timeOffset),
        })
      }

      pendingBoard = null
      return
    }

    currentRide = null
    pendingBoard = null

    if (edge.meta.type === 'transfer') {
      const fromRoute = getRouteById(network, edge.meta.fromRouteId)
      const toRoute = getRouteById(network, edge.meta.toRouteId)
      const fromStop = getStopById(network, edge.meta.fromStopId)
      const toStop = getStopById(network, edge.meta.toStopId)

      segments.push({
        type: 'transfer',
        stopId: toStop.id,
        stopName:
          fromStop.id === toStop.id
            ? getStopDisplayName(toStop)
            : `${getStopDisplayName(fromStop)} to ${getStopDisplayName(toStop)}`,
        fromStopId: fromStop.id,
        fromStopName: getStopDisplayName(fromStop),
        toStopId: toStop.id,
        toStopName: getStopDisplayName(toStop),
        fromRouteId: fromRoute.id,
        fromRouteName: fromRoute.name,
        toRouteId: toRoute.id,
        toRouteName: toRoute.name,
        transferMinutes: edge.meta.transferMinutes,
        waitMinutes: edge.meta.waitMinutes,
        minutes: edge.cost,
        distanceKm: edge.meta.distanceKm ?? 0,
        source: edge.meta.source,
      })

      pendingBoard = {
        waitMinutes: 0,
        departureMinutes: edge.meta.departureMinutes,
      }
    }
  })

  segments
    .filter((segment) => segment.type === 'ride')
    .forEach((segment) => {
      routeSegments.push({
        routeId: segment.routeId,
        color: segment.color,
        coordinates: segment.stopIds.map((stopId) => {
          const stop = getStopById(network, stopId)
          return [stop.lat, stop.lng]
        }),
      })
    })

  return {
    originId,
    destinationId,
    originName: getStopDisplayName(getStopById(network, originId)) || originId,
    destinationName: getStopDisplayName(getStopById(network, destinationId)) || destinationId,
    departureMinutes,
    totalMinutes: Math.round(result.cost),
    transferCount: segments.filter((segment) => segment.type === 'transfer').length,
    waitMinutes: Math.round(
      segments.reduce((sum, segment) => sum + (segment.waitMinutes ?? 0), 0),
    ),
    segments,
    routeSegments,
  }
}

function nextDepartureForStop(trip, stopIndex, readyMinutes) {
  const stopTime = trip.stopTimes[stopIndex]
  const tripStart = trip.stopTimes[0]?.departureMinutes ?? 0
  const stopOffset = stopTime.departureMinutes - tripStart

  if (!trip.frequencies?.length) {
    return stopTime.departureMinutes >= readyMinutes ? stopTime.departureMinutes : null
  }

  let bestDeparture = null

  trip.frequencies.forEach((frequency) => {
    const firstDeparture = frequency.startMinutes + stopOffset
    const lastDeparture = frequency.endMinutes + stopOffset
    const headwayMinutes = Math.max(1, frequency.headwayMinutes)

    if (readyMinutes > lastDeparture) {
      return
    }

    const missedHeadways = Math.max(0, Math.ceil((readyMinutes - firstDeparture) / headwayMinutes))
    const departure = firstDeparture + missedHeadways * headwayMinutes

    if (departure <= lastDeparture && (bestDeparture === null || departure < bestDeparture)) {
      bestDeparture = departure
    }
  })

  return bestDeparture
}

function isTripActive(network, trip, date) {
  const service = network.services?.find((candidate) => candidate.id === trip.serviceId)
  if (!service) {
    return true
  }

  const dateKey = toDateKey(date)
  if (dateKey < service.startDate || dateKey > service.endDate) {
    return false
  }

  const dayKey = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
    date.getDay()
  ]

  return service.days?.[dayKey] !== false
}

function estimateWalkTransferMinutes(distanceKm) {
  const walkingMinutes = (distanceKm / WALKING_SPEED_KPH) * 60
  return Math.max(DEFAULT_TRANSFER_MINUTES, Math.round(walkingMinutes + 2))
}

function dijkstra(getEdges, start, goal) {
  const distances = new Map([[start, { minutes: 0, transfers: 0, rideCount: 0 }]])
  const previous = new Map()
  const pending = [{ nodeId: start, minutes: 0, transfers: 0, rideCount: 0 }]
  const visited = new Set()

  while (pending.length > 0) {
    pending.sort((a, b) => compareJourneyCost(a, b))
    const current = pending.shift()

    if (!current || visited.has(current.nodeId)) {
      continue
    }

    if (current.nodeId === goal) {
      return reconstructPath(previous, goal, distances.get(goal)?.minutes ?? 0)
    }

    visited.add(current.nodeId)

    getEdges(current.nodeId, current).forEach((edge) => {
      const currentCost = distances.get(current.nodeId) ?? {
        minutes: Infinity,
        transfers: Infinity,
        rideCount: 0,
      }

      if (edge.meta.type === 'transfer' && currentCost.rideCount === 0) {
        return
      }

      const nextCost = {
        minutes: currentCost.minutes + edge.cost,
        transfers: currentCost.transfers + (edge.meta.type === 'transfer' ? 1 : 0),
        rideCount: currentCost.rideCount + (edge.meta.type === 'ride' ? 1 : 0),
      }

      if (compareJourneyCost(nextCost, distances.get(edge.to)) < 0) {
        distances.set(edge.to, nextCost)
        previous.set(edge.to, {
          nodeId: current.nodeId,
          edge,
        })
        pending.push({
          nodeId: edge.to,
          minutes: nextCost.minutes,
          transfers: nextCost.transfers,
          rideCount: nextCost.rideCount,
        })
      }
    })
  }

  return null
}

function compareJourneyCost(first, second) {
  if (!second) {
    return -1
  }

  if (first.transfers !== second.transfers) {
    return first.transfers - second.transfers
  }

  return first.minutes - second.minutes
}

function reconstructPath(previous, goal, cost) {
  const edges = []
  let current = goal

  while (previous.has(current)) {
    const entry = previous.get(current)
    edges.unshift(entry.edge)
    current = entry.nodeId
  }

  return {
    cost,
    edges,
  }
}

function parseTimeToMinutes(value) {
  if (!value) {
    return null
  }

  const [hours, minutes] = value.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null
  }

  return hours * 60 + minutes
}

function getCurrentMinutes() {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}

function toDateKey(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
    date.getDate(),
  ).padStart(2, '0')}`
}

function toNodeId(tripId, stopIndex) {
  return `${tripId}::${stopIndex}`
}

function fromNodeId(nodeId) {
  const [tripId, stopIndex] = nodeId.split('::')
  return {
    tripId,
    stopIndex: Number(stopIndex),
  }
}
