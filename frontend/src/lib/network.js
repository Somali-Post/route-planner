export function getStopById(network, stopId) {
  return network.stops.find((stop) => stop.id === stopId) ?? null
}

export function getRouteById(network, routeId) {
  return network.routes.find((route) => route.id === routeId) ?? null
}

export function getTripById(network, tripId) {
  return network.trips?.find((trip) => trip.id === tripId) ?? null
}

export function getStopDisplayName(stop) {
  return stop?.displayName ?? stop?.name ?? ''
}

export function buildRoutesWithGeometry(network) {
  return network.routes.map((route) => ({
    ...route,
    path: route.path?.length
      ? route.path
      : route.stops.map((stopId) => {
          const stop = getStopById(network, stopId)
          return stop ? [stop.lat, stop.lng] : null
        }).filter(Boolean),
  }))
}

export function normalizeNetwork(network) {
  return {
    ...network,
    routes: buildRoutesWithGeometry(network),
  }
}

export function formatServiceTime(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) {
    return ''
  }

  const minutesInDay = 24 * 60
  const normalized = ((Math.round(totalMinutes) % minutesInDay) + minutesInDay) % minutesInDay
  const hours = Math.floor(normalized / 60)
  const minutes = normalized % 60

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function formatFeedDate(value) {
  if (!value || value.length !== 8) {
    return value ?? ''
  }

  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

export function haversineDistanceKm(a, b) {
  const earthRadiusKm = 6371
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)

  const value =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180
}
