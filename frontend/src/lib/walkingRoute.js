const routeCache = new Map()
const DEFAULT_OSRM_BASE_URL = 'https://router.project-osrm.org'
const DEFAULT_PROFILE = 'foot'
const REQUEST_TIMEOUT_MS = 4500

export async function getWalkingRoute(from, to) {
  const cacheKey = buildCacheKey(from, to)
  if (routeCache.has(cacheKey)) {
    return routeCache.get(cacheKey)
  }

  const routePromise = fetchWalkingRoute(from, to).catch(() => buildFallbackRoute(from, to))
  routeCache.set(cacheKey, routePromise)
  return routePromise
}

async function fetchWalkingRoute(from, to) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const baseUrl = getEnvValue('VITE_OSRM_BASE_URL') || DEFAULT_OSRM_BASE_URL
    const profile = getEnvValue('VITE_OSRM_WALKING_PROFILE') || DEFAULT_PROFILE
    const coordinates = `${from.lng},${from.lat};${to.lng},${to.lat}`
    const url = `${baseUrl.replace(/\/$/, '')}/route/v1/${profile}/${coordinates}?overview=full&geometries=geojson&steps=false`
    const response = await fetch(url, { signal: controller.signal })

    if (!response.ok) {
      throw new Error(`Walking route request failed: ${response.status}`)
    }

    const payload = await response.json()
    const route = payload.routes?.[0]
    const geometry = route?.geometry?.coordinates

    if (!geometry?.length) {
      throw new Error('Walking route response did not include geometry')
    }

    return {
      source: 'osrm',
      coordinates: geometry.map(([lng, lat]) => ({ lat, lng })),
      distanceKm: (route.distance ?? 0) / 1000,
      durationMinutes: Math.round((route.duration ?? 0) / 60),
    }
  } finally {
    window.clearTimeout(timeout)
  }
}

function buildFallbackRoute(from, to) {
  return {
    source: 'fallback',
    coordinates: [from, to],
    distanceKm: 0,
    durationMinutes: 0,
  }
}

function buildCacheKey(from, to) {
  return [from, to]
    .map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`)
    .join('>')
}

function getEnvValue(key) {
  return import.meta.env?.[key]
}
