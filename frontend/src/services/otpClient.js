const OTP_GRAPHQL_ENDPOINT = '/api/otp/graphql'

const PLAN_QUERY = `
query Plan(
  $from: InputCoordinates!
  $to: InputCoordinates!
  $date: String!
  $time: String!
  $searchWindow: Long
  $transportModes: [TransportMode!]
) {
  plan(
    from: $from
    to: $to
    date: $date
    time: $time
    searchWindow: $searchWindow
    transportModes: $transportModes
    numItineraries: 5
  ) {
    itineraries {
      duration
      startTime
      endTime
      walkDistance
      legs {
        mode
        startTime
        endTime
        duration
        distance
        from {
          name
          lat
          lon
          stop {
            gtfsId
            name
          }
        }
        to {
          name
          lat
          lon
          stop {
            gtfsId
            name
          }
        }
        route {
          shortName
          longName
        }
        legGeometry {
          points
          length
        }
      }
    }
  }
}
`

export async function planWithOtp({
  from,
  to,
  date,
  time,
  searchWindow = 120,
  numItineraries = 5,
}) {
  void numItineraries

  const variables = {
    from,
    to,
    date,
    time,
    searchWindow,
    numItineraries,
    transportModes: [
      { mode: 'WALK', qualifier: 'ACCESS' },
      { mode: 'BUS' },
      { mode: 'WALK', qualifier: 'EGRESS' },
    ],
  }

  console.debug('[OTP] GraphQL variables', variables)

  const response = await fetch(OTP_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: PLAN_QUERY,
      variables,
    }),
  })

  if (!response.ok) {
    throw new Error(`OTP request failed: ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()

  if (payload.errors?.length) {
    const message = payload.errors.map((error) => error.message).join('; ')
    throw new Error(`OTP GraphQL error: ${message}`)
  }

  const itineraries = payload.data?.plan?.itineraries ?? []
  if (!itineraries.length) {
    console.debug('[OTP] raw GraphQL response (no itineraries)', {
      errors: payload.errors ?? null,
      plan: payload.data?.plan ?? null,
    })
  }

  return itineraries
}
