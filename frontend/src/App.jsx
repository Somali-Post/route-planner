import { useEffect, useMemo, useState } from 'react'
import './App.css'
import {
  Route,
  BusFront,
  Map,
  Milestone,
  MapPin,
  Footprints,
  Activity,
  TriangleAlert,
  Star,
  Ellipsis,
  Languages,
  CircleHelp,
  Moon,
  Settings,
  ArrowUpDown,
  ChevronDown,
} from 'lucide-react'
import { BusMap } from './components/BusMap'
import {
  formatFeedDate,
  formatServiceTime,
  getStopById,
  getStopDisplayName,
  haversineDistanceKm,
  normalizeNetwork,
} from './lib/network'
import { loadNetworkData } from './lib/data'
import { createPointPlace, createStopPlace } from './lib/mobilityOffers'
import { buildDataQualityReport, buildServiceIntelligence } from './lib/serviceIntelligence'
import { planJourney } from './services/journeyPlanner'
import logoUrl from '../Logo.svg'

function App() {
  const [rawNetwork, setRawNetwork] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [plannerSearch, setPlannerSearch] = useState('')
  const [visibleRouteIds, setVisibleRouteIds] = useState(() => new Set())
  const [selectedRouteId, setSelectedRouteId] = useState(null)
  const [originId, setOriginId] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [originPlace, setOriginPlace] = useState(null)
  const [destinationPlace, setDestinationPlace] = useState(null)
  const [activeStopId, setActiveStopId] = useState(null)
  const [plannedOffer, setPlannedOffer] = useState(null)
  const [plannedOffers, setPlannedOffers] = useState([])
  const [planError, setPlanError] = useState('')
  const [isPlanning, setIsPlanning] = useState(false)
  const [isJourneyDrawerOpen, setIsJourneyDrawerOpen] = useState(false)
  const [theme, setTheme] = useState('light')
  const [departureTime, setDepartureTime] = useState(() => getInitialDepartureTime())
  const [isPlannerOpen, setIsPlannerOpen] = useState(true)
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false)
  const [isQualityModalOpen, setIsQualityModalOpen] = useState(false)
  const [isStopsModalOpen, setIsStopsModalOpen] = useState(false)
  const [activeView, setActiveView] = useState('plan')
  const [language, setLanguage] = useState('EN')

  const normalizedNetwork = useMemo(
    () => (rawNetwork ? normalizeNetwork(rawNetwork) : null),
    [rawNetwork],
  )

  useEffect(() => {
    let isMounted = true

    loadNetworkData()
      .then((network) => {
        if (!isMounted) {
          return
        }

        const hydratedNetwork = normalizeNetwork(network)
        setRawNetwork(network)
        setVisibleRouteIds(new Set(hydratedNetwork.routes.map((route) => route.id)))
        setSelectedRouteId(hydratedNetwork.routes[0]?.id ?? null)
      })
      .catch((error) => {
        if (isMounted) {
          setLoadError(error.message)
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  const routeOptions = useMemo(
    () =>
      normalizedNetwork
        ? [...normalizedNetwork.routes].sort((first, second) =>
            first.name.localeCompare(second.name, undefined, { sensitivity: 'base' }),
          )
        : [],
    [normalizedNetwork],
  )
  const stopOptions = useMemo(
    () =>
      normalizedNetwork
        ? [...normalizedNetwork.stops].sort((first, second) =>
            getStopDisplayName(first).localeCompare(getStopDisplayName(second), undefined, {
              sensitivity: 'base',
            }),
          )
        : [],
    [normalizedNetwork],
  )
  const plannedJourneyDetails = useMemo(
    () =>
      plannedOffer && normalizedNetwork
        ? buildItineraryDetails(normalizedNetwork, plannedOffer)
        : null,
    [normalizedNetwork, plannedOffer],
  )
  const selectedRoute =
    routeOptions.find((route) => route.id === selectedRouteId && visibleRouteIds.has(route.id)) ??
    routeOptions.find((route) => visibleRouteIds.has(route.id)) ??
    null
  const activeStop = normalizedNetwork ? getStopById(normalizedNetwork, activeStopId) : null
  const serviceStatus = normalizedNetwork ? buildServiceStatus(normalizedNetwork) : null
  const serviceIntelligence = normalizedNetwork
    ? buildServiceIntelligence(normalizedNetwork, departureTime)
    : null
  const dataQuality = normalizedNetwork ? buildDataQualityReport(normalizedNetwork) : null
  const planningError = planError
  const copy = TEXT[language] ?? TEXT.EN

  function clearPlannedJourney() {
    setPlannedOffer(null)
    setPlannedOffers([])
    setIsPlanning(false)
    setIsJourneyDrawerOpen(false)
  }

  function toggleRoute(routeId) {
    setVisibleRouteIds((current) => {
      const next = new Set(current)
      if (next.has(routeId)) {
        next.delete(routeId)
      } else {
        next.add(routeId)
      }
      return next
    })
    clearPlannedJourney()
  }

  function handleSelectAllRoutes() {
    setVisibleRouteIds(new Set(routeOptions.map((route) => route.id)))
    clearPlannedJourney()
  }

  function handleClearRoutes() {
    setVisibleRouteIds(new Set())
    clearPlannedJourney()
  }

  function handleSwapJourney() {
    setOriginId(destinationId)
    setDestinationId(originId)
    setOriginPlace(destinationPlace)
    setDestinationPlace(originPlace)
    setPlanError('')
    clearPlannedJourney()
  }

  function handleUseStop(stopId, target) {
    if (target === 'origin') {
      setOriginId(stopId)
      setOriginPlace(createStopPlace(getStopById(normalizedNetwork, stopId)))
    } else {
      setDestinationId(stopId)
      setDestinationPlace(createStopPlace(getStopById(normalizedNetwork, stopId)))
    }
    setActiveStopId(stopId)
    setPlanError('')
    clearPlannedJourney()
  }

  function handleMapStopSelect(stopId) {
    setActiveStopId(stopId)
    setPlanError('')
    const stopPlace = createStopPlace(getStopById(normalizedNetwork, stopId))

    if (!originPlace || (originPlace && destinationPlace && plannedOffer)) {
      setOriginId(stopId)
      setOriginPlace(stopPlace)
      setDestinationId('')
      setDestinationPlace(null)
      clearPlannedJourney()
      return
    }

    if (originId === stopId) {
      setDestinationId('')
      setDestinationPlace(null)
      clearPlannedJourney()
      return
    }

    setDestinationId(stopId)
    setDestinationPlace(stopPlace)
    clearPlannedJourney()
  }

  function handleMapPointSelect(point) {
    const pointPlace = createPointPlace(point.lat, point.lng, 'Selected map point')
    setPlanError('')

    if (!originPlace || (originPlace && destinationPlace && plannedOffer)) {
      setOriginId('')
      setOriginPlace(pointPlace)
      setDestinationId('')
      setDestinationPlace(null)
      clearPlannedJourney()
      return
    }

    setDestinationId('')
    setDestinationPlace(pointPlace)
    clearPlannedJourney()
  }

  function handleResetTrip() {
    setOriginId('')
    setDestinationId('')
    setOriginPlace(null)
    setDestinationPlace(null)
    setActiveStopId(null)
    setPlanError('')
    clearPlannedJourney()
  }

  function handlePlanJourney() {
    if (!normalizedNetwork) {
      setPlanError('Network data is still loading. Try again in a moment.')
      return
    }

    if (!originPlace || !destinationPlace) {
      setPlanError('Choose a From point and a To point on the map first.')
      return
    }

    setPlanError('')
    setIsPlanning(true)
    setPlannedOffer(null)
    setPlannedOffers([])
    setIsJourneyDrawerOpen(false)

    window.setTimeout(() => {
      const offers = planJourney({
        network: normalizedNetwork,
        originPlace,
        destinationPlace,
        originStop: originId ? getStopById(normalizedNetwork, originId) : null,
        destinationStop: destinationId ? getStopById(normalizedNetwork, destinationId) : null,
        visibleRouteIds: [...visibleRouteIds],
        departureTime,
      })

      if (!offers.length) {
        setPlanError('No bus journey is available at that departure time with the visible routes.')
        clearPlannedJourney()
        return
      }

      setPlannedOffers(offers)
      setPlannedOffer(offers[0])
      setIsJourneyDrawerOpen(true)
      if (window.innerWidth <= 760) {
        setIsPlannerOpen(false)
      }
      setIsPlanning(false)
    }, 350)
  }

  function handleSelectOffer(offer) {
    setPlannedOffer(offer)
    setIsJourneyDrawerOpen(true)
    if (window.innerWidth <= 760) {
      setIsPlannerOpen(false)
    }
    setPlanError('')
  }

  function handleToggleTheme() {
    setTheme((currentTheme) => (currentTheme === 'light' ? 'dark' : 'light'))
  }

  function handleSwap() {
    handleSwapJourney()
  }

  function handleReset() {
    handleResetTrip()
  }

  function handleViewChange(nextView) {
    setActiveView(nextView)
    if (nextView === 'plan') {
      setIsPlannerOpen(true)
      return
    }

    setIsPlannerOpen(false)
    if (nextView === 'status') {
      setIsStatusModalOpen(true)
    }
    if (nextView === 'qa') {
      setIsQualityModalOpen(true)
    }
    if (nextView === 'stops') {
      setIsStopsModalOpen(true)
    }
  }

  function handleOriginSelect(stopId) {
    if (!stopId) {
      setOriginId('')
      setOriginPlace(null)
      clearPlannedJourney()
      return
    }
    const stop = getStopById(normalizedNetwork, stopId)
    if (!stop) {
      return
    }
    setOriginId(stopId)
    setOriginPlace(createStopPlace(stop))
    setPlanError('')
    clearPlannedJourney()
  }

  function handleDestinationSelect(stopId) {
    if (!stopId) {
      setDestinationId('')
      setDestinationPlace(null)
      clearPlannedJourney()
      return
    }
    const stop = getStopById(normalizedNetwork, stopId)
    if (!stop) {
      return
    }
    setDestinationId(stopId)
    setDestinationPlace(createStopPlace(stop))
    setPlanError('')
    clearPlannedJourney()
  }

  if (loadError) {
    return (
      <div className="app-shell app-shell--message">
        <div className="panel message-panel">
          <p className="eyebrow">Load Error</p>
          <h1>Nova Bus Map could not load the network.</h1>
          <p className="lede">{loadError}</p>
        </div>
      </div>
    )
  }

  if (!normalizedNetwork) {
    return (
      <div className="app-shell app-shell--message">
        <div className="panel message-panel">
          <p className="eyebrow">Loading</p>
          <h1>Nova Bus Map is loading.</h1>
          <p className="lede">The app is reading the latest GTFS network data.</p>
        </div>
      </div>
    )
  }

  const showJourneyPanel = Boolean(plannedJourneyDetails && isJourneyDrawerOpen)

  return (
    <div className={`app-shell ${showJourneyPanel ? 'has-journey-panel' : ''}`} data-theme={theme}>
      <aside className="nav-rail">
        <div className="brand-mark">
          <img src={logoUrl} alt="Nova Bus Map Mogadishu" className="brand-logo" />
          <span>Bus Map</span>
          <em>Mogadishu</em>
        </div>

        <nav className="main-nav" aria-label="Main navigation">
          <button
            className={`rail-nav-item ${activeView === 'plan' ? 'is-active' : ''}`}
            type="button"
            onClick={() => handleViewChange('plan')}
          >
            <Route aria-hidden="true" />
            <span>{copy.planJourney}</span>
          </button>
          <NavItem icon={Map} label={copy.liveMap} active={activeView === 'map'} onClick={() => handleViewChange('map')} />
          <NavItem icon={Milestone} label={copy.routes} active={activeView === 'routes'} onClick={() => handleViewChange('routes')} />
          <NavItem icon={MapPin} label={copy.stops} active={activeView === 'stops'} onClick={() => handleViewChange('stops')} />
          <button className="rail-nav-item" type="button" onClick={() => handleViewChange('status')}>
            <Activity aria-hidden="true" />
            <span>{copy.status}</span>
          </button>
          <button className="rail-nav-item" type="button" onClick={() => handleViewChange('qa')}>
            <TriangleAlert aria-hidden="true" />
            <span>{copy.gtfsQa}</span>
          </button>
          <NavItem icon={Star} label={copy.favourites} active={activeView === 'favourites'} onClick={() => handleViewChange('favourites')} />
          <NavItem icon={Ellipsis} label={copy.more} active={activeView === 'more'} onClick={() => handleViewChange('more')} />
        </nav>

        <div className="rail-footer">
          <button
            className="rail-footer-toggle"
            type="button"
            onClick={() => setLanguage((current) => (current === 'EN' ? 'SO' : 'EN'))}
          >
            <Languages aria-hidden="true" />
            <span>{language}</span>
          </button>

          <button className="rail-footer-action" type="button">
            <Settings aria-hidden="true" />
            <span>{copy.settings}</span>
          </button>

          <button className="rail-footer-action" type="button">
            <CircleHelp aria-hidden="true" />
            <span>{copy.help}</span>
          </button>

          <button className="rail-footer-action" type="button" onClick={handleToggleTheme}>
            <Moon aria-hidden="true" />
            <span>{copy.darkMode}</span>
          </button>
        </div>
      </aside>

      <main className="map-stage">
        <div className="map-topbar">
          <label className="map-search">
            <span>{copy.search}</span>
            <input
              type="text"
              value={plannerSearch}
              onChange={(event) => setPlannerSearch(event.target.value)}
              placeholder="Search stops or places"
            />
          </label>
          <button type="button" className="traffic-button">{copy.traffic}</button>
          {activeStop ? (
            <div className="active-stop-card">
              <span>Selected stop</span>
              <strong>{getStopDisplayName(activeStop)}</strong>
              <div className="map-action-row">
                <button type="button" onClick={() => handleUseStop(activeStop.id, 'origin')}>
                  {copy.from}
                </button>
                <button type="button" onClick={() => handleUseStop(activeStop.id, 'destination')}>
                  {copy.to}
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="mobile-route-legend" aria-label="Visible routes">
          {routeOptions
            .filter((route) => visibleRouteIds.has(route.id))
            .slice(0, 6)
            .map((route) => (
              <span key={route.id} className="mobile-route-chip">
                <i style={{ backgroundColor: route.color }} />
                <b>{route.name}</b>
              </span>
            ))}
          {visibleRouteIds.size > 6 ? <span className="mobile-route-more">+{visibleRouteIds.size - 6}</span> : null}
        </div>

        {isPlannerOpen && (
          <aside className="floating-planner-panel">
            <section className="planner-card compact-planner-card">
              <div className="section-head">
                <div>
                  <h1>{copy.routePlanner}</h1>
                  <p>{copy.routePlannerCopy}</p>
                </div>
                <div className="planner-head-actions">
                  <button className="text-button" type="button" onClick={handleReset}>
                    {copy.reset}
                  </button>
                  <button
                    className="close-panel-button planner-close-button"
                    type="button"
                    onClick={() => setIsPlannerOpen(false)}
                    aria-label="Close route planner">x</button>
                </div>
              </div>

              <div className="journey-picker compact-picker">
                <div className={`journey-point-card ${originPlace ? 'is-set' : ''}`}>
                  <span className="journey-pin" />
                  <div>
                    <small>{copy.from}</small>
                    <strong>{originPlace ? originPlace.name : copy.selectFromPrompt}</strong>
                  </div>
                </div>

                <button className="swap-inline-button" type="button" onClick={handleSwap}>
                  <ArrowUpDown aria-hidden="true" />
                </button>

                <div className={`journey-point-card ${destinationPlace ? 'is-set' : ''}`}>
                  <span className="journey-pin journey-pin--destination" />
                  <div>
                    <small>{copy.to}</small>
                    <strong>{destinationPlace ? destinationPlace.name : copy.selectToPrompt}</strong>
                  </div>
                </div>
              </div>

              <div className="field compact-field">
                <span>{copy.from}</span>
                <select
                  value={originPlace?.type === 'stop' ? originId : ''}
                  onChange={(event) => handleOriginSelect(event.target.value)}
                >
                  <option value="">{copy.selectStopOption}</option>
                  {stopOptions.map((stop) => (
                    <option key={stop.id} value={stop.id}>
                      {getStopDisplayName(stop)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field compact-field">
                <span>{copy.to}</span>
                <select
                  value={destinationPlace?.type === 'stop' ? destinationId : ''}
                  onChange={(event) => handleDestinationSelect(event.target.value)}
                >
                  <option value="">{copy.selectStopOption}</option>
                  {stopOptions.map((stop) => (
                    <option key={stop.id} value={stop.id}>
                      {getStopDisplayName(stop)}
                    </option>
                  ))}
                </select>
              </div>

              <label className="field compact-field">
                <span>{copy.departAt}</span>
                <input
                  type="time"
                  value={departureTime}
                  onChange={(event) => setDepartureTime(event.target.value)}
                />
              </label>

              <button
                className="primary-button full-width"
                type="button"
                onClick={handlePlanJourney}
                disabled={!originPlace || !destinationPlace || isPlanning}
              >
                {isPlanning ? copy.planning : copy.planJourney}
              </button>

              {isPlanning && (
                <div className="planning-status" role="status" aria-live="polite">
                  <span />
                  <div>
                    <strong className="planning-status-title">{copy.planning}</strong>
                    <small>{copy.planningSubtext}</small>
                  </div>
                </div>
              )}

              {plannedOffers.length > 0 && (
                <div className="offer-list">
                  {plannedOffers.map((offer) => (
                    <button
                      key={offer.id}
                      type="button"
                      className={`offer-card ${plannedOffer?.id === offer.id ? 'is-selected' : ''}`}
                      onClick={() => handleSelectOffer(offer)}
                    >
                      <span>{offer.label}</span>
                      <strong>{formatDuration(offer.totalMinutes)}</strong>
                      <small>
                        {offer.routeIds.length ? `Routes ${offer.routeIds.join(', ')}` : 'Walk only'} /{' '}
                        {formatDuration(offer.walkMinutes)} walk / {formatDuration(offer.waitMinutes)} wait
                      </small>
                    </button>
                  ))}
                </div>
              )}

              {planningError && <p className="error-text">{planningError}</p>}
            </section>

          </aside>
        )}

        {(activeView === 'plan' || activeView === 'routes' || activeView === 'map') && (
          <section className="map-route-tray">
          <div className="section-head">
            <div>
              <p className="eyebrow">{copy.allRoutes}</p>
              <h2>{visibleRouteIds.size} {copy.visible}</h2>
            </div>
            <div className="button-row">
              <button type="button" className="ghost-button" onClick={handleSelectAllRoutes}>
                {copy.all}
              </button>
              <button type="button" className="ghost-button" onClick={handleClearRoutes}>
                {copy.none}
              </button>
            </div>
          </div>

          <div className="route-list">
            {routeOptions.map((route) => {
              const isVisible = visibleRouteIds.has(route.id)
              const firstStop = normalizedNetwork ? getStopById(normalizedNetwork, route.stops[0]) : null
              const lastStop = normalizedNetwork
                ? getStopById(normalizedNetwork, route.stops[route.stops.length - 1])
                : null

              return (
                <button
                  key={route.id}
                  type="button"
                  className={`route-card ${isVisible ? 'is-visible' : ''} ${
                    selectedRouteId === route.id ? 'is-selected' : ''
                  }`}
                  onClick={() => {
                    toggleRoute(route.id)
                    setSelectedRouteId(route.id)
                  }}
                >
                  <span className="route-swatch" style={{ backgroundColor: route.color }} />
                  <span className="route-copy">
                    <strong>{route.name}</strong>
                    <b>
                      {firstStop ? getStopDisplayName(firstStop) : 'Nova'} to{' '}
                      {lastStop ? getStopDisplayName(lastStop) : 'Mogadishu'}
                    </b>
                    <small>
                      {copy.headway} {route.headwayMinutes ? formatDuration(route.headwayMinutes) : copy.daily}
                    </small>
                    <em>{copy.onTime}</em>
                  </span>
                </button>
              )
            })}
          </div>
          </section>
        )}

        <BusMap
          network={normalizedNetwork}
          visibleRouteIds={visibleRouteIds}
          selectedRouteId={selectedRoute?.id ?? null}
          activeStopId={activeStopId}
          originId={originId}
          destinationId={destinationId}
          originPlace={originPlace}
          destinationPlace={destinationPlace}
          onSelectRoute={setSelectedRouteId}
          onSelectStop={handleMapStopSelect}
          onSelectPoint={handleMapPointSelect}
          offer={plannedOffer}
          journey={plannedOffer?.journey}
        />
      </main>

      {showJourneyPanel ? (
        <aside className={`journey-drawer ${isJourneyDrawerOpen ? 'is-open' : ''}`}>
          <>
            <div className="drawer-head">
              <div>
                <p className="eyebrow">Your Journey</p>
                <h2>Route details</h2>
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() => setIsJourneyDrawerOpen(false)}
              >
                Close
              </button>
            </div>

            <JourneyTimelineDetails details={plannedJourneyDetails} />
          </>
        </aside>
      ) : null}

      {isStatusModalOpen && serviceStatus ? (
        <div className="status-modal-backdrop" role="dialog" aria-modal="true" aria-label="GTFS service status">
          <div className="status-modal">
            <div className="status-modal-head">
              <div>
                <p className="eyebrow">GTFS Service Status</p>
                <h3>Daily service</h3>
              </div>
              <button type="button" className="close-panel-button" onClick={() => setIsStatusModalOpen(false)}>
                Close
              </button>
            </div>
            <div className="status-modal-grid">
              <div>
                <span>Feed version</span>
                <strong>{serviceStatus.version}</strong>
              </div>
              <div>
                <span>Routes</span>
                <strong>{routeOptions.length}</strong>
              </div>
              <div>
                <span>Operating now</span>
                <strong>
                  {serviceIntelligence.activeRouteCount}/{serviceIntelligence.routeCount}
                </strong>
              </div>
              <div>
                <span>Service type</span>
                <strong>{serviceStatus.days}</strong>
              </div>
              <div>
                <span>Feed</span>
                <strong>{serviceStatus.feedRange}</strong>
              </div>
              <div>
                <span>Feed current</span>
                <strong>{serviceIntelligence.feedIsCurrent ? 'Yes' : 'No'}</strong>
              </div>
            </div>
            <div className="route-status-list">
              {serviceIntelligence.routes.map((route) => (
                <div key={route.routeId} className="route-status-row">
                  <span className="route-swatch" style={{ backgroundColor: route.color }} />
                  <strong>{route.routeName}</strong>
                  <small>{route.isOperating ? `Next ${route.nextDepartureLabel}` : 'Not operating now'}</small>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {isQualityModalOpen && dataQuality ? (
        <div className="status-modal-backdrop" role="dialog" aria-modal="true" aria-label="GTFS data quality">
          <div className="status-modal quality-modal">
            <div className="status-modal-head">
              <div>
                <p className="eyebrow">GTFS Data Quality</p>
                <h3>{dataQuality.score}</h3>
              </div>
              <button type="button" className="close-panel-button" onClick={() => setIsQualityModalOpen(false)}>
                Close
              </button>
            </div>
            <div className="status-modal-grid">
              <Metric label="Routes" value={dataQuality.counts.routes} />
              <Metric label="Stops" value={dataQuality.counts.stops} />
              <Metric label="Trips" value={dataQuality.counts.trips} />
              <Metric label="Transfers" value={dataQuality.counts.transfers} />
              <Metric label="Duplicate names" value={dataQuality.counts.duplicateStopNames} />
              <Metric label="Stops without routes" value={dataQuality.counts.stopsWithoutRoutes} />
            </div>
            <div className="quality-list">
              <strong>Issues</strong>
              {(dataQuality.issues.length ? dataQuality.issues : ['No broken GTFS references found.']).map(
                (issue) => (
                  <span key={issue}>{issue}</span>
                ),
              )}
            </div>
          </div>
        </div>
      ) : null}

      {isStopsModalOpen ? (
        <div className="status-modal-backdrop" role="dialog" aria-modal="true" aria-label="Stops list">
          <div className="status-modal quality-modal">
            <div className="status-modal-head">
              <div>
                <p className="eyebrow">{copy.stops}</p>
                <h3>{stopOptions.length} {copy.stops}</h3>
              </div>
              <button type="button" className="close-panel-button" onClick={() => setIsStopsModalOpen(false)}>
                Close
              </button>
            </div>
            <div className="quality-list">
              {stopOptions.map((stop) => (
                <span key={stop.id}>
                  <strong>{getStopDisplayName(stop)}</strong> ({stop.id})
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function NavItem({ icon: Icon, label, active = false, onClick }) {
  return (
    <button type="button" className={`nav-item ${active ? 'is-active' : ''}`} onClick={onClick}>
      <span className="nav-icon" aria-hidden="true">
        <Icon />
      </span>
      {label}
    </button>
  )
}

function Metric({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function JourneyTimelineDetails({ details }) {
  const routeSummary = details.routesUsed.map((route) => route.code).join(' / ')

  return (
    <div className="journey-route-card journey-timeline-card">
      <div className="journey-timeline-head">
        <div>
          <div className="journey-title-row">
            <BusFront aria-hidden="true" />
            <span>{formatDuration(details.totalMinutes)}</span>
          </div>
          <p>Arrive {details.arrivalTime || 'soon'} · {formatMoney(details.estimatedFare)}</p>
        </div>
        <small>{routeSummary || 'Walk'}</small>
      </div>

      <div className="journey-timeline">
        <TimelinePoint
          kind="origin"
          title={details.originName || 'Selected location'}
          subtitle={details.originSubtitle}
          time={details.departureTime}
        />
        {details.steps.map((step, index) =>
          step.type === 'walk' ? (
            <TimelineWalk key={step.id} step={step} />
          ) :
          step.type === 'transfer' ? (
            <TimelineTransfer key={step.id} step={step} />
          ) : (
            <TimelineRide
              key={step.id}
              step={step}
              suppressBoarding={index === 0 && step.stops?.[0]?.name === details.originName}
            />
          ),
        )}
        <TimelinePoint
          kind="destination"
          title={details.destinationName || 'Selected destination'}
          time={details.arrivalTime}
          isLast
        />
      </div>
    </div>
  )
}

function TimelinePoint({ kind, title, subtitle, time, isLast = false }) {
  return (
    <div className={`timeline-step timeline-point timeline-point--${kind} ${isLast ? 'is-last' : ''}`}>
      <div className="timeline-marker" aria-hidden="true">
        <MapPin />
      </div>
      <div className="timeline-content">
        <div className="timeline-row">
          <div>
            <span className="timeline-title">{title}</span>
            {subtitle ? <small>{subtitle}</small> : null}
          </div>
          {time ? <time>{time}</time> : null}
        </div>
      </div>
    </div>
  )
}

function TimelineWalk({ step }) {
  const label = step.kind === 'access' ? 'Walk to stop' : step.kind === 'egress' ? 'Walk to destination' : 'Walk'

  return (
    <div className="timeline-step timeline-walk">
      <div className="timeline-marker" aria-hidden="true">
        <Footprints />
      </div>
      <div className="timeline-content">
        <div className="timeline-row">
          <span className="timeline-title">{label}</span>
          <time>{formatDuration(step.minutes)}</time>
        </div>
        <p>{step.from.name} to {step.to.name}</p>
      </div>
    </div>
  )
}

function TimelineTransfer({ step }) {
  return (
    <div className="timeline-step timeline-transfer">
      <div className="timeline-marker" aria-hidden="true">
        <ArrowUpDown />
      </div>
      <div className="timeline-content">
        <div className="timeline-row">
          <span className="timeline-title">Change buses</span>
          <time>{formatDuration(step.transferMinutes)}</time>
        </div>
        <p>{step.stopName}</p>
        <small>
          {step.fromRouteName} to {step.toRouteName}
          {step.waitMinutes ? ` · wait ${formatDuration(step.waitMinutes)}` : ''}
        </small>
      </div>
    </div>
  )
}

function TimelineRide({ step, suppressBoarding = false }) {
  const stops = step.stops ?? []
  const boardingStop = stops[0]
  const alightingStop = stops[stops.length - 1]
  const intermediateStops = stops.slice(1, -1)
  const shouldCollapseStops = intermediateStops.length > 3

  return (
    <div className="timeline-step timeline-ride" style={{ '--route-color': step.color }}>
      <div className="timeline-marker" aria-hidden="true">
        <BusFront />
      </div>
      <div className="timeline-content">
        {!suppressBoarding ? (
          <div className="timeline-row timeline-stop-row">
            <span className="timeline-title">{boardingStop?.name ?? step.fromStopName}</span>
            <time>{step.departureTime}</time>
          </div>
        ) : null}
        <div className="timeline-ride-card">
          <div className="timeline-route-line">
            <span className="journey-route-pill">{step.routeCode}</span>
            <span>{step.headsign ? `Toward ${step.headsign}` : step.routeName}</span>
          </div>
          <div className="timeline-ride-meta">
            <span>Scheduled</span>
            <span>Depart {step.departureTime}</span>
            <span>{formatDuration(step.minutes)}</span>
          </div>
          {intermediateStops.length ? (
            shouldCollapseStops ? (
              <details className="journey-stop-collapse">
                <summary>
                  <span>Ride {step.stopCount} stops</span>
                  <small>{intermediateStops.length} hidden</small>
                  <ChevronDown aria-hidden="true" />
                </summary>
                <StopList stops={intermediateStops} />
              </details>
            ) : (
              <StopList stops={intermediateStops} />
            )
          ) : null}
        </div>
        {alightingStop ? (
          <div className="timeline-row timeline-stop-row timeline-alight-row">
            <span className="timeline-title">{alightingStop.name}</span>
            <time>{step.arrivalTime}</time>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function StopList({ stops }) {
  return (
    <ol className="journey-stop-list">
      {stops.map((stop) => (
        <li key={`${stop.id}-${stop.time}`}>
          <span>{stop.time}</span>
          <small>{stop.name}</small>
        </li>
      ))}
    </ol>
  )
}

// Legacy journey markup is kept during the drawer redesign for comparison while the new timeline settles.
// eslint-disable-next-line no-unused-vars
function JourneyDetails({ details }) {
  return (
    <div className="journey-route-card journey-maas-card">
      <div className="journey-maas-head">
        <div>
          <strong>{formatDuration(details.totalMinutes)}</strong>
          <small>
            Arrive {details.arrivalTime} · {formatMoney(details.estimatedFare)}
          </small>
        </div>
        <div className="journey-maas-badges">
          <span>MaaS Offer</span>
          <span>GTFS</span>
        </div>
      </div>

      <div className="journey-maas-route-row">
        {details.routesUsed.map((route) => (
          <span key={route.id} className="journey-maas-route-tag" style={{ '--route-pill': route.color }}>
            {route.code}
          </span>
        ))}
      </div>

      <div className="journey-route-body journey-itinerary-list journey-maas-itinerary">
        {details.steps.map((step) =>
          step.type === 'walk' ? (
            <div key={step.id} className="journey-transfer journey-walk itinerary-step journey-maas-step">
              <div className="journey-maas-step-head">
                <span>{step.kind === 'access' ? 'Walk to route' : step.kind === 'egress' ? 'Walk to destination' : 'Walk'}</span>
                <strong>{formatDuration(step.minutes)}</strong>
              </div>
              <p>{step.from.name} to {step.to.name}</p>
            </div>
          ) :
          step.type === 'transfer' ? (
            <div key={step.id} className="journey-transfer itinerary-step journey-maas-step">
              <div className="journey-maas-step-head">
                <span>Change buses</span>
                <strong>{formatDuration(step.transferMinutes)}</strong>
              </div>
              <p>{step.stopName}</p>
              <small>{step.fromRouteName} to {step.toRouteName}{step.waitMinutes ? ` · wait ${formatDuration(step.waitMinutes)}` : ''}</small>
            </div>
          ) : (
            <div key={step.id} className="journey-leg itinerary-step journey-maas-step">
              <div className="journey-maas-step-head">
                <span>Bus {step.routeCode}</span>
                <strong>{formatDuration(step.minutes)}</strong>
              </div>
              <div className="journey-leg-head">
                <span className="route-swatch" style={{ backgroundColor: step.color }} />
                <div>
                  <strong>{step.routeName}</strong>
                  <small>Toward {step.headsign}</small>
                  <small>Ride {step.stopCount} stops ({formatDuration(step.minutes)})</small>
                  <small>Depart {step.departureTime} / Arrive {step.arrivalTime}</small>
                </div>
              </div>
              <ol className="stop-timeline">
                {step.stops.map((stop) => (
                  <li key={`${step.id}-${stop.id}`}>
                    <span>{stop.time}</span>
                    <strong>{stop.name}</strong>
                  </li>
                ))}
              </ol>
            </div>
          ),
        )}
        <div className="journey-maas-destination">
          <MapPin aria-hidden="true" />
          <div>
            <span>Destination</span>
            <strong>{details.destinationName}</strong>
          </div>
          <small>{details.arrivalTime}</small>
        </div>
      </div>
    </div>
  )
}

function buildItineraryDetails(network, offer) {
  const journey = offer.journey
  if (!journey) {
    return {
      totalMinutes: offer.totalMinutes,
      walkMinutes: offer.walkMinutes,
      transferCount: 0,
      waitMinutes: 0,
      routesUsed: [],
      departureTime: '',
      arrivalTime: '',
      estimatedFare: estimateFare(offer),
      originName: offer.origin?.name ?? 'Selected location',
      originSubtitle: offer.origin?.type === 'stop' ? '' : 'Selected location',
      destinationName: offer.destination?.name ?? '',
      steps: offer.legs.map((leg) => ({
        id: leg.id,
        type: 'walk',
        ...leg,
      })),
    }
  }
  const rideSteps = journey.segments.filter((segment) => segment.type === 'ride')
  const routesUsed = rideSteps.reduce((routes, segment) => {
    if (!routes.some((route) => route.id === segment.routeId)) {
      routes.push({
        id: segment.routeId,
        name: segment.routeName,
        color: segment.color,
        code: toMockBusCode(segment.routeId),
      })
    }

    return routes
  }, [])

  return {
    totalMinutes: offer.totalMinutes,
    walkMinutes: offer.walkMinutes,
    transferCount: journey.transferCount,
    waitMinutes: journey.waitMinutes,
    departureTime: formatServiceTime(journey.departureMinutes),
    arrivalTime: formatServiceTime(journey.departureMinutes + offer.totalMinutes),
    estimatedFare: estimateFare(offer),
    originName: offer.origin?.name ?? journey.originName ?? 'Selected location',
    originSubtitle: offer.origin?.type === 'stop' ? '' : 'Selected location',
    destinationName: offer.destination?.name ?? journey.destinationName,
    routesUsed,
    steps: offer.legs.map((segment, index) => {
      if (segment.mode === 'walk') {
        return {
          id: segment.id,
          type: 'walk',
          ...segment,
        }
      }

      if (segment.type === 'transfer') {
        return {
          id: `transfer-${segment.fromStopId}-${segment.toStopId}-${index}`,
          ...segment,
        }
      }

      const stops = segment.stopIds.map((stopId) => getStopById(network, stopId)).filter(Boolean)
      const distances = stops
        .slice(1)
        .map((stop, stopIndex) => haversineDistanceKm(stops[stopIndex], stop))
      const totalDistance = distances.reduce((sum, distance) => sum + distance, 0)

      return {
        id: `ride-${segment.tripId}-${index}`,
        ...segment,
        routeCode: toMockBusCode(segment.routeId),
        distanceKm: totalDistance.toFixed(1),
        stops: stops.map((stop, stopIndex) => ({
          id: stop.id,
          name: getStopDisplayName(stop),
          time:
            segment.stopTimes[stopIndex]?.arrival ??
            segment.stopTimes[stopIndex]?.departure ??
            `${formatServiceTime(journey.departureMinutes)}+`,
        })),
      }
    }),
  }
}

function buildServiceStatus(network) {
  const feed = network.metadata.feed ?? {}
  const service = network.services?.[0]
  const activeDays = service?.days
    ? Object.entries(service.days)
        .filter(([, isActive]) => isActive)
        .map(([day]) => day.slice(0, 3))
        .join(', ')
    : 'Unknown'

  return {
    agencyName: network.metadata.agency?.name || network.metadata.name,
    version: feed.version || 'GTFS',
    feedRange: `${formatFeedDate(feed.startDate)} to ${formatFeedDate(feed.endDate)}`,
    days: activeDays,
  }
}

function getInitialDepartureTime() {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
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

function toMockBusCode(routeId) {
  const numeric = Number.parseInt(routeId, 10)
  if (Number.isFinite(numeric)) {
    return `${300 + numeric}`
  }
  return `3${String(routeId).padStart(2, '0')}`
}

function estimateFare(offer) {
  return offer.routeIds.length ? 1.00 : 0
}

function formatMoney(amount) {
  return `$${amount.toFixed(2)}`
}

const TEXT = {
  EN: {
    planJourney: 'Plan Journey',
    liveMap: 'Live Map',
    routes: 'Routes',
    stops: 'Stops',
    status: 'Status',
    gtfsQa: 'GTFS QA',
    favourites: 'Favourites',
    more: 'More',
    settings: 'Settings',
    help: 'Help',
    darkMode: 'Dark mode',
    search: 'Search',
    traffic: 'Traffic',
    from: 'From',
    to: 'To',
    routePlanner: 'Route Planner',
    routePlannerCopy: 'Pick two stops and Nova will guide the trip.',
    reset: 'Reset',
    selectFromPrompt: 'Click a stop or map point',
    selectToPrompt: 'Waiting for From',
    selectStopOption: 'Select stop',
    departAt: 'Depart at',
    planning: 'Planning your journey',
    planningSubtext: 'Checking routes, waits, and transfers',
    allRoutes: 'All Routes',
    visible: 'visible',
    all: 'All',
    none: 'None',
    headway: 'Headway',
    daily: 'Daily',
    onTime: 'On time',
  },
  SO: {
    planJourney: 'Qorshee Safar',
    liveMap: 'Khariidad Toos ah',
    routes: 'Khadad',
    stops: 'Joogsiyo',
    status: 'Xaalad',
    gtfsQa: 'GTFS Hubin',
    favourites: 'La Jecel',
    more: 'Dheeraad',
    settings: 'Dejinta',
    help: 'Caawimaad',
    darkMode: 'Muuq Madow',
    search: 'Raadi',
    traffic: 'Gaadiid',
    from: 'Laga bilaabo',
    to: 'Loo socdo',
    routePlanner: 'Qorsheeye Safar',
    routePlannerCopy: 'Dooro laba joogsi, Nova ayaa ku hagi doonta.',
    reset: 'Nadiifi',
    selectFromPrompt: 'Dooro joogsi ama meel khariidad',
    selectToPrompt: 'Sug Laga bilaabo',
    selectStopOption: 'Dooro joogsi',
    departAt: 'Waqtiga bixidda',
    planning: 'Safarka waa la qorshaynayaa',
    planningSubtext: 'Waxaan hubinaynaa khadadka, sugitaanka, iyo beddelka',
    allRoutes: 'Dhammaan Khadadka',
    visible: 'muuqda',
    all: 'Dhammaan',
    none: 'Midna',
    headway: 'Kala-bixid',
    daily: 'Maalinle',
    onTime: 'Waqtigiisa',
  },
}

export default App
