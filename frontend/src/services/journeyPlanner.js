import { buildMobilityOffers } from '../lib/mobilityOffers'
import { planWithOtp } from './otpClient'
import { mapOtpItinerariesToJourneyOptions } from './otpMapper'

const USE_OTP_ROUTER = true
const OTP_SEARCH_WINDOW_SECONDS = 7200

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

  const fallbackOffers = () =>
    buildMobilityOffers(
      network,
      originPlace,
      destinationPlace,
      visibleRouteIds,
      { departureTime },
    )

  if (!USE_OTP_ROUTER) {
    return fallbackOffers()
  }

  const now = new Date()
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`
  const time = normalizeTime(departureTime)
  const otpFrom = {
    lat: originPlace?.lat,
    lon: originPlace?.lon ?? originPlace?.lng,
  }
  const otpTo = {
    lat: destinationPlace?.lat,
    lon: destinationPlace?.lon ?? destinationPlace?.lng,
  }

  console.debug('[OTP] originPlace', originPlace)
  console.debug('[OTP] destinationPlace', destinationPlace)
  console.debug('[OTP] request from/to', { from: otpFrom, to: otpTo, date, time })

  return planWithOtp({
    from: otpFrom,
    to: otpTo,
    date,
    time,
    searchWindow: OTP_SEARCH_WINDOW_SECONDS,
    numItineraries: 5,
  })
    .then((itineraries) => {
      const rawCount = Array.isArray(itineraries) ? itineraries.length : 0
      const busItineraryCount = Array.isArray(itineraries)
        ? itineraries.filter(
            (itinerary) =>
              Array.isArray(itinerary?.legs) &&
              itinerary.legs.some((leg) => String(leg?.mode || '').toUpperCase() === 'BUS'),
          ).length
        : 0

      const mappedOffers = mapOtpItinerariesToJourneyOptions({
        itineraries,
        originPlace,
        destinationPlace,
        routeOptions: network?.routes ?? [],
      })

      console.debug('[OTP] response summary', {
        rawItineraryCount: rawCount,
        busItineraryCount,
        mappedOfferCount: mappedOffers.length,
      })
      if (mappedOffers.length > 0) {
        const firstOffer = mappedOffers[0]
        console.debug('[OTP] first mapped offer', {
          id: firstOffer.id,
          label: firstOffer.label,
          totalMinutes: firstOffer.totalMinutes,
          routeIds: firstOffer.routeIds,
          transferCount: firstOffer.transferCount,
        })
      }

      if (mappedOffers.length > 0) {
        return mappedOffers
      }

      console.warn('OTP mapping returned no offers. Falling back to custom journey planner.')
      return fallbackOffers()
    })
    .catch((error) => {
      console.warn('OTP journey planning failed. Falling back to custom journey planner.', error)
      return fallbackOffers()
    })
}

function normalizeTime(value) {
  if (!value) {
    return '00:00:00'
  }

  const parts = String(value).split(':')
  const hours = String(parts[0] ?? '00').padStart(2, '0')
  const minutes = String(parts[1] ?? '00').padStart(2, '0')
  const seconds = String(parts[2] ?? '00').padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

export { USE_OTP_ROUTER }
