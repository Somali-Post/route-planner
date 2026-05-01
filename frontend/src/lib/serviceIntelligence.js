import { formatFeedDate, formatServiceTime } from './network.js'

export function buildServiceIntelligence(network, departureTime, serviceDate = new Date()) {
  const departureMinutes = parseTimeToMinutes(departureTime)
  const feed = network.metadata.feed ?? {}
  const activeServiceIds = new Set(
    (network.services ?? [])
      .filter((service) => isServiceActive(service, serviceDate))
      .map((service) => service.id),
  )
  const activeTrips = (network.trips ?? []).filter((trip) => activeServiceIds.has(trip.serviceId))
  const operatingRoutes = network.routes
    .map((route) => buildRouteServiceState(route, activeTrips, departureMinutes))
    .sort((first, second) => first.routeName.localeCompare(second.routeName))

  return {
    feedVersion: feed.version || 'GTFS',
    feedRange: `${formatFeedDate(feed.startDate)} to ${formatFeedDate(feed.endDate)}`,
    feedIsCurrent: isFeedCurrent(feed, serviceDate),
    activeServiceCount: activeServiceIds.size,
    activeRouteCount: operatingRoutes.filter((route) => route.isOperating).length,
    routeCount: network.routes.length,
    routes: operatingRoutes,
  }
}

export function buildDataQualityReport(network) {
  const routeIds = new Set(network.routes.map((route) => route.id))
  const stopIds = new Set(network.stops.map((stop) => stop.id))
  const tripIds = new Set(network.trips?.map((trip) => trip.id) ?? [])
  const duplicateStopNames = countDuplicates(network.stops.map((stop) => stop.name))

  const missingRouteTrips = (network.trips ?? []).filter((trip) => !routeIds.has(trip.routeId))
  const missingStopTimes = (network.trips ?? []).flatMap((trip) =>
    trip.stopTimes.filter((stopTime) => !stopIds.has(stopTime.stopId)),
  )
  const missingShapeTrips = (network.trips ?? []).filter((trip) => !trip.shapeId)
  const emptyShapeRoutes = network.routes.filter((route) => !route.path?.length)
  const stopsWithoutRoutes = network.stops.filter((stop) => !stop.routeIds?.length)
  const transferIssues = (network.transfers ?? []).filter(
    (transfer) => !stopIds.has(transfer.fromStopId) || !stopIds.has(transfer.toStopId),
  )
  const orphanRouteTrips = network.routes.flatMap((route) =>
    route.trips.filter((tripId) => !tripIds.has(tripId)),
  )

  const issues = [
    ...missingRouteTrips.map((trip) => `Trip ${trip.id} references missing route ${trip.routeId}`),
    ...missingStopTimes.map((stopTime) => `Stop time references missing stop ${stopTime.stopId}`),
    ...missingShapeTrips.map((trip) => `Trip ${trip.id} has no shape_id`),
    ...emptyShapeRoutes.map((route) => `Route ${route.name} has no shape geometry`),
    ...transferIssues.map(
      (transfer) => `Transfer ${transfer.fromStopId} to ${transfer.toStopId} references a missing stop`,
    ),
    ...orphanRouteTrips.map((tripId) => `Route references missing trip ${tripId}`),
  ]

  return {
    score: issues.length === 0 ? 'Ready' : 'Needs review',
    counts: {
      routes: network.routes.length,
      stops: network.stops.length,
      trips: network.trips?.length ?? 0,
      transfers: network.transfers?.length ?? 0,
      services: network.services?.length ?? 0,
      duplicateStopNames: duplicateStopNames.length,
      stopsWithoutRoutes: stopsWithoutRoutes.length,
      issues: issues.length,
    },
    duplicateStopNames,
    stopsWithoutRoutes,
    issues,
  }
}

function buildRouteServiceState(route, activeTrips, departureMinutes) {
  const routeTrips = activeTrips.filter((trip) => trip.routeId === route.id)
  const firstStart = route.serviceWindow?.startMinutes
  const lastEnd = route.serviceWindow?.endMinutes
  const nextDepartures = routeTrips
    .flatMap((trip) => tripDepartures(trip, departureMinutes))
    .sort((first, second) => first - second)
  const nextDeparture = nextDepartures[0] ?? null
  const isOperating =
    nextDeparture !== null ||
    (Number.isFinite(firstStart) &&
      Number.isFinite(lastEnd) &&
      departureMinutes >= firstStart &&
      departureMinutes <= lastEnd)

  return {
    routeId: route.id,
    routeName: route.name,
    color: route.color,
    isOperating,
    nextDeparture,
    nextDepartureLabel: nextDeparture === null ? 'No more departures' : formatServiceTime(nextDeparture),
    firstDepartureLabel: Number.isFinite(firstStart) ? formatServiceTime(firstStart) : 'Unknown',
    lastDepartureLabel: Number.isFinite(lastEnd) ? formatServiceTime(lastEnd) : 'Unknown',
    headwayMinutes: route.headwayMinutes,
  }
}

function tripDepartures(trip, readyMinutes) {
  const firstStop = trip.stopTimes[0]
  if (!firstStop) {
    return []
  }

  if (!trip.frequencies?.length) {
    return firstStop.departureMinutes >= readyMinutes ? [firstStop.departureMinutes] : []
  }

  return trip.frequencies.flatMap((frequency) => {
    const departures = []
    const headway = Math.max(1, frequency.headwayMinutes)
    for (let minute = frequency.startMinutes; minute <= frequency.endMinutes; minute += headway) {
      if (minute >= readyMinutes) {
        departures.push(minute)
      }
      if (departures.length >= 3) {
        break
      }
    }
    return departures
  })
}

function isServiceActive(service, date) {
  const dateKey = toDateKey(date)
  if (dateKey < service.startDate || dateKey > service.endDate) {
    return false
  }

  const dayKey = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
    date.getDay()
  ]

  return service.days?.[dayKey] !== false
}

function isFeedCurrent(feed, date) {
  const dateKey = toDateKey(date)
  return (!feed.startDate || dateKey >= feed.startDate) && (!feed.endDate || dateKey <= feed.endDate)
}

function parseTimeToMinutes(value) {
  if (!value) {
    const now = new Date()
    return now.getHours() * 60 + now.getMinutes()
  }

  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function toDateKey(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
    date.getDate(),
  ).padStart(2, '0')}`
}

function countDuplicates(values) {
  const counts = new Map()
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1))
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name, count]) => ({ name, count }))
    .sort((first, second) => second.count - first.count)
}
