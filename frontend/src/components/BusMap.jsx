import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { getStopById, getStopDisplayName } from '../lib/network'
import { getWalkingRoute } from '../lib/walkingRoute'

export function BusMap({
  network,
  visibleRouteIds,
  selectedRouteId,
  activeStopId,
  originId,
  destinationId,
  originPlace,
  destinationPlace,
  onSelectRoute,
  onSelectStop,
  onSelectPoint,
  offer,
  journey,
}) {
  const mapElementRef = useRef(null)
  const mapRef = useRef(null)
  const routeLayerRef = useRef(null)
  const stopLayerRef = useRef(null)
  const placeLayerRef = useRef(null)
  const journeyLayerRef = useRef(null)
  const hasFitNetworkRef = useRef(false)
  const onSelectPointRef = useRef(onSelectPoint)
  const lastFramedJourneyKeyRef = useRef('')
  const [mapZoom, setMapZoom] = useState(12)

  useEffect(() => {
    onSelectPointRef.current = onSelectPoint
  }, [onSelectPoint])

  useEffect(() => {
    if (mapRef.current || !mapElementRef.current) {
      return
    }

    const map = L.map(mapElementRef.current, {
      center: network.metadata.center,
      zoom: 12,
      zoomControl: false,
    })

    L.control
      .zoom({
        position: 'bottomright',
      })
      .addTo(map)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)

    routeLayerRef.current = L.layerGroup().addTo(map)
    stopLayerRef.current = L.layerGroup().addTo(map)
    placeLayerRef.current = L.layerGroup().addTo(map)
    journeyLayerRef.current = L.layerGroup().addTo(map)
    map.on('click', (event) => {
      onSelectPointRef.current?.({
        lat: event.latlng.lat,
        lng: event.latlng.lng,
      })
    })
    map.on('zoomend', () => {
      setMapZoom(map.getZoom())
    })
    setMapZoom(map.getZoom())
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [network.metadata.center])

  useEffect(() => {
    const map = mapRef.current
    const routeLayer = routeLayerRef.current
    const stopLayer = stopLayerRef.current

    if (!map || !routeLayer || !stopLayer) {
      return
    }

    routeLayer.clearLayers()
    stopLayer.clearLayers()

    const visibleRoutes = network.routes.filter((route) => visibleRouteIds.has(route.id))
    const journeyRouteIds = new Set(
      journey?.segments
        ?.filter((segment) => segment.type === 'ride')
        .map((segment) => segment.routeId) ?? [],
    )

    visibleRoutes.forEach((route) => {
      const latLngs = route.path.map((point) => [point[0], point[1]])
      const isSelected = route.id === selectedRouteId
      const isUsedInJourney = journeyRouteIds.has(route.id)
      const hasJourney = journeyRouteIds.size > 0

      const polyline = L.polyline(latLngs, {
        color: route.color,
        weight: hasJourney && !isUsedInJourney ? 3 : isSelected ? 7 : 5,
        opacity: hasJourney && !isUsedInJourney ? 0.18 : isUsedInJourney ? 0.38 : isSelected ? 0.95 : 0.72,
        lineCap: 'round',
        lineJoin: 'round',
      })

      polyline.on('click', () => onSelectRoute(route.id))
      polyline.bindTooltip(route.name, {
        sticky: true,
      })
      polyline.addTo(routeLayer)
    })

    network.stops
      .filter((stop) => stop.routeIds.some((routeId) => visibleRouteIds.has(routeId)))
      .forEach((stop) => {
        const isActive = stop.id === activeStopId
        const isOrigin = stop.id === originId
        const isDestination = stop.id === destinationId
        const bearing = getStopTravelBearing(network, stop, visibleRouteIds, selectedRouteId)
        const marker = L.circleMarker([stop.lat, stop.lng], {
          radius: isOrigin || isDestination ? 8 : isActive ? 7 : 5,
          color: '#111111',
          weight: isOrigin || isDestination || isActive ? 2.5 : 1.5,
          fillColor: isOrigin ? '#111111' : '#ffffff',
          fillOpacity: isOrigin ? 1 : 0.95,
        })

        marker.on('click', (event) => {
          L.DomEvent.stopPropagation(event)
          onSelectStop(stop.id)
        })
        marker.bindTooltip(buildStopTooltip(stop, bearing, isOrigin, isDestination), {
          direction: 'top',
          sticky: true,
          className: 'stop-hover-tooltip',
          offset: [0, -10],
          opacity: 1,
        })
        marker.bindPopup(
          `
            <div class="map-popup">
              <strong>${getStopDisplayName(stop)}</strong>
              <p>${stop.description || `Routes ${stop.routeIds.join(', ')}`}</p>
            </div>
          `,
        )
        marker.addTo(stopLayer)
      })
    if (visibleRoutes.length > 0 && !hasFitNetworkRef.current) {
      const bounds = L.latLngBounds(
        visibleRoutes.flatMap((route) => route.path.map((point) => [point[0], point[1]])),
      )

      map.fitBounds(bounds, {
          padding: [30, 30],
          maxZoom: 13,
        })
      hasFitNetworkRef.current = true
    }
  }, [
    activeStopId,
    destinationId,
    journey,
    network,
    onSelectRoute,
    onSelectStop,
    originId,
    selectedRouteId,
    visibleRouteIds,
  ])

  useEffect(() => {
    const map = mapRef.current
    const journeyLayer = journeyLayerRef.current

    if (!map || !journeyLayer) {
      return
    }

    journeyLayer.clearLayers()

    if (!journey && !offer) {
      return
    }

    const bounds = []
    let isCancelled = false
    const walkingSegments = getWalkingSegments(network, offer, journey)
    const frameKey = offer?.id ?? (journey ? `${journey.originId}-${journey.destinationId}-${journey.totalMinutes}` : '')
    const shouldFrame = frameKey && lastFramedJourneyKeyRef.current !== frameKey

    if (!journey) {
      drawWalkingSegments(walkingSegments, journeyLayer, mapZoom, () => isCancelled)
      if (shouldFrame && bounds.length > 0) {
        map.fitBounds(bounds, {
          padding: [40, 40],
        })
        lastFramedJourneyKeyRef.current = frameKey
      }
      return () => {
        isCancelled = true
      }
    }

    getJourneyRouteSections(network, journey).forEach((segment) => {
      const latLngs = segment.coordinates.map((point) => [point[0], point[1]])
      latLngs.forEach((point) => bounds.push(point))

      L.polyline(latLngs, {
        color: segment.color,
        weight: 12,
        opacity: 0.92,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(journeyLayer)

      L.polyline(latLngs, {
        color: '#ffffff',
        weight: 4,
        opacity: 0.86,
        dashArray: '12 10',
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(journeyLayer)

      addLegDurationBadge(journeyLayer, segment.coordinates, formatDuration(segment.minutes), 'bus')
    })

    if (shouldFrame && bounds.length > 0) {
      map.fitBounds(bounds, {
        padding: [40, 40],
      })
      lastFramedJourneyKeyRef.current = frameKey
    }

    drawWalkingSegments(walkingSegments, journeyLayer, mapZoom, () => isCancelled)

    return () => {
      isCancelled = true
    }
  }, [journey, mapZoom, network, offer])

  useEffect(() => {
    const placeLayer = placeLayerRef.current

    if (!placeLayer) {
      return
    }

    placeLayer.clearLayers()

    ;[
      [originPlace, 'From', 'from'],
      [destinationPlace, 'To', 'to'],
    ].forEach(([place, label, kind]) => {
      if (!place) {
        return
      }

      const marker = L.marker([place.lat, place.lng], {
        icon: L.divIcon({
          className: `journey-pin-marker journey-pin-marker--${kind}`,
          html: `<span>${label}</span>`,
          iconSize: [78, 38],
          iconAnchor: [39, 36],
        }),
        zIndexOffset: 900,
      })

      marker.bindTooltip(escapeHtml(place.name), {
        direction: 'top',
        offset: [0, -34],
        className: 'stop-hover-tooltip',
      })
      marker.addTo(placeLayer)
    })
  }, [destinationPlace, originPlace])

  return <div ref={mapElementRef} className="map-canvas" />
}

function buildStopTooltip(stop, bearing, isOrigin, isDestination) {
  const label = isOrigin ? 'From' : isDestination ? 'To' : ''
  const badge = label ? `<span class="stop-hover-badge">${label}</span>` : ''
  const rotation = Number.isFinite(bearing) ? bearing - 90 : 0

  return `
    <div class="stop-hover-card">
      <span class="stop-hover-arrow" style="transform: rotate(${rotation}deg)">&#10140;</span>
      <strong>${escapeHtml(getStopDisplayName(stop))}</strong>
      ${badge}
    </div>
  `
}

function getWalkingSegments(network, offer, journey) {
  const offerWalks =
    offer?.legs
      ?.filter((leg) => leg.mode === 'walk' && leg.from && leg.to && leg.minutes > 0)
      .map((leg) => ({
        from: leg.from,
        to: leg.to,
      })) ?? []

  const transferWalks =
    journey?.segments
      ?.filter(
        (segment) =>
          segment.type === 'transfer' &&
          segment.fromStopId !== segment.toStopId,
      )
      .map((segment) => ({
        from: getStopById(network, segment.fromStopId),
        to: getStopById(network, segment.toStopId),
      }))
      .filter((segment) => segment.from && segment.to) ?? []

  return [...offerWalks, ...transferWalks]
}

async function drawWalkingSegments(segments, layer, zoom, isCancelled) {
  const routedSegments = await Promise.all(
    segments.map(async (segment) => ({
      ...segment,
      route: await getWalkingRoute(segment.from, segment.to),
    })),
  )

  if (isCancelled()) {
    return
  }

  routedSegments.forEach((segment) => {
    addWalkingArrows(layer, segment.route.coordinates, zoom)
    addLegDurationBadge(layer, segment.route.coordinates, formatDuration(segment.minutes), 'walk')
  })
}

function addWalkingArrows(layer, coordinates, zoom) {
  if (coordinates.length < 2) {
    return
  }

  const lineLengthKm = lineDistanceKm(coordinates)
  const spacingKm = getArrowSpacingKm(zoom)
  const arrowCount = Math.max(1, Math.min(28, Math.ceil(lineLengthKm / spacingKm)))

  for (let index = 1; index <= arrowCount; index += 1) {
    const point = pointAlongLine(coordinates, index / (arrowCount + 1))
    const bearing = calculateBearing(point.from, point.to) - 90

    L.marker([point.lat, point.lng], {
      icon: L.divIcon({
        className: 'walking-arrow-marker',
        html: `<span style="transform: rotate(${bearing}deg)">&#10140;</span>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
      interactive: false,
      zIndexOffset: 850,
    }).addTo(layer)
  }
}

function getArrowSpacingKm(zoom) {
  if (zoom >= 17) {
    return 0.055
  }
  if (zoom >= 16) {
    return 0.08
  }
  if (zoom >= 15) {
    return 0.12
  }
  if (zoom >= 14) {
    return 0.18
  }
  if (zoom >= 13) {
    return 0.28
  }
  return 0.42
}

function addLegDurationBadge(layer, coordinates, label, type) {
  if (!label || coordinates.length < 2) {
    return
  }

  const point = pointAlongLine(coordinates, 0.5)
  L.marker([point.lat, point.lng], {
    icon: L.divIcon({
      className: `leg-duration-marker leg-duration-marker--${type}`,
      html: `<span>${escapeHtml(label)}</span>`,
      iconSize: [92, 34],
      iconAnchor: [46, 17],
    }),
    interactive: false,
    zIndexOffset: 920,
  }).addTo(layer)
}

function pointAlongLine(coordinates, ratio) {
  const targetDistance = lineDistanceKm(coordinates) * ratio
  let coveredDistance = 0

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const from = toLatLngPoint(coordinates[index])
    const to = toLatLngPoint(coordinates[index + 1])
    const segmentDistance = distanceKm(from, to)

    if (coveredDistance + segmentDistance >= targetDistance) {
      const segmentRatio =
        segmentDistance === 0 ? 0 : (targetDistance - coveredDistance) / segmentDistance
      return {
        lat: from.lat + (to.lat - from.lat) * segmentRatio,
        lng: from.lng + (to.lng - from.lng) * segmentRatio,
        from,
        to,
      }
    }

    coveredDistance += segmentDistance
  }

  const from = coordinates.at(-2)
  const to = coordinates.at(-1)
  const normalizedFrom = toLatLngPoint(from)
  const normalizedTo = toLatLngPoint(to)
  return {
    lat: normalizedTo.lat,
    lng: normalizedTo.lng,
    from: normalizedFrom,
    to: normalizedTo,
  }
}

function lineDistanceKm(coordinates) {
  return coordinates
    .slice(1)
    .reduce(
      (sum, point, index) => sum + distanceKm(toLatLngPoint(coordinates[index]), toLatLngPoint(point)),
      0,
    )
}

function getJourneyRouteSections(network, journey) {
  return journey.segments
    .filter((segment) => segment.type === 'ride')
    .map((segment) => {
      const route = network.routes.find((candidate) => candidate.id === segment.routeId)
      const fromStop = getStopById(network, segment.fromStopId)
      const toStop = getStopById(network, segment.toStopId)
      const coordinates =
        route && fromStop && toStop
          ? sliceRoutePath(route.path, fromStop, toStop)
          : segment.stopIds.map((stopId) => {
              const stop = getStopById(network, stopId)
              return stop ? [stop.lat, stop.lng] : null
            }).filter(Boolean)

      return {
        routeId: segment.routeId,
        color: segment.color,
        coordinates,
        minutes: segment.minutes,
      }
    })
}

function sliceRoutePath(path, fromStop, toStop) {
  if (!path?.length) {
    return [
      [fromStop.lat, fromStop.lng],
      [toStop.lat, toStop.lng],
    ]
  }

  const fromIndex = findNearestPathIndex(path, fromStop)
  const toIndex = findNearestPathIndex(path, toStop)
  const shapeSection =
    fromIndex <= toIndex
      ? path.slice(fromIndex, toIndex + 1)
      : path.slice(toIndex, fromIndex + 1).reverse()

  return [[fromStop.lat, fromStop.lng], ...shapeSection, [toStop.lat, toStop.lng]]
}

function findNearestPathIndex(path, stop) {
  let nearestIndex = 0
  let nearestDistance = Infinity

  path.forEach((point, index) => {
    const candidateDistance = distanceKm({ lat: point[0], lng: point[1] }, stop)
    if (candidateDistance < nearestDistance) {
      nearestDistance = candidateDistance
      nearestIndex = index
    }
  })

  return nearestIndex
}

function getStopTravelBearing(network, stop, visibleRouteIds, selectedRouteId) {
  const visibleRoutes = network.routes.filter((route) => visibleRouteIds.has(route.id))
  const selectedRoute = visibleRoutes.find((route) => route.id === selectedRouteId)
  const routes = selectedRoute ? [selectedRoute, ...visibleRoutes.filter((route) => route.id !== selectedRoute.id)] : visibleRoutes

  for (const route of routes) {
    const trip = network.trips?.find(
      (candidate) =>
        candidate.routeId === route.id &&
        candidate.stopTimes.some((stopTime) => stopTime.stopId === stop.id),
    )
    const bearing = trip ? getBearingFromTrip(network, trip, stop.id) : null

    if (Number.isFinite(bearing)) {
      return bearing
    }
  }

  return null
}

function getBearingFromTrip(network, trip, stopId) {
  const stopIndex = trip.stopTimes.findIndex((stopTime) => stopTime.stopId === stopId)
  if (stopIndex === -1) {
    return null
  }

  const previousStopId = trip.stopTimes[stopIndex - 1]?.stopId ?? null
  const fromStopId = trip.stopTimes[stopIndex + 1] ? trip.stopTimes[stopIndex].stopId : previousStopId
  const toStopId = trip.stopTimes[stopIndex + 1]?.stopId ?? trip.stopTimes[stopIndex].stopId

  if (!toStopId) {
    return null
  }

  const fromStop = getStopById(network, fromStopId)
  const toStop = getStopById(network, toStopId)

  if (!fromStop || !toStop) {
    return null
  }

  return calculateBearing(fromStop, toStop)
}

function calculateBearing(from, to) {
  const fromLat = toRadians(from.lat)
  const toLat = toRadians(to.lat)
  const deltaLng = toRadians(to.lng - from.lng)
  const y = Math.sin(deltaLng) * Math.cos(toLat)
  const x =
    Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLng)

  return (Math.atan2(y, x) * 180) / Math.PI
}

function distanceKm(from, to) {
  const earthRadiusKm = 6371
  const dLat = toRadians(to.lat - from.lat)
  const dLng = toRadians(to.lng - from.lng)
  const lat1 = toRadians(from.lat)
  const lat2 = toRadians(to.lat)
  const value =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

function toLatLngPoint(value) {
  if (Array.isArray(value)) {
    return {
      lat: Number(value[0]),
      lng: Number(value[1]),
    }
  }

  return {
    lat: Number(value.lat),
    lng: Number(value.lng),
  }
}

function formatDuration(totalMinutes) {
  const roundedMinutes = Math.max(0, Math.round(totalMinutes || 0))
  const hours = Math.floor(roundedMinutes / 60)
  const minutes = roundedMinutes % 60

  if (hours === 0) {
    return `${minutes} min`
  }

  if (minutes === 0) {
    return `${hours} hr`
  }

  return `${hours} hr ${minutes} min`
}

function toRadians(value) {
  return (value * Math.PI) / 180
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
