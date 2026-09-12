import { coordinateBounds, layoutResponders, normalizePoint, placeLabels, projectPoint, stationFocus } from './projection.js';
import { canStartViewportPan, viewportFit, viewportShortcut } from './viewport-controls.js';

const state = { rooms: [], room: null, selectedStationId: null, selectedResponderId: null, selectedFloorId: null, activePage: 'production-floor', activeTab: 'stations', zoom: 1, panX: 0, panY: 0, lastRecommendation: null, providerSettings: null, settingsBusy: false, busy: false };
const $ = (id) => document.getElementById(id);
const status = $('status');
const ACTIVE_ISSUE_STATUSES = new Set(['PENDING', 'OFFER_PENDING', 'ASSIGNED', 'REOPENED']);
const APP_PAGES = ['production-floor', 'analytics', 'settings'];
function setStatus(message, error = false) { status.textContent = message; status.classList.toggle('error', error); }
function text(node, value) { node.textContent = value; return node; }
function element(name, className) { const node = document.createElement(name); if (className) node.className = className; return node; }
function roomUrl(path = '') { return `/api/rooms/${encodeURIComponent(state.room.roomId)}${path}`; }
function updateLocation() { if (!state.room) return; const params = new URLSearchParams({ room: state.room.roomId, view: state.activePage }); history.replaceState(null, '', `#${params}`); }
function selectPage(page, moveFocus = false) { if (!APP_PAGES.includes(page)) return; state.activePage = page; for (const candidate of APP_PAGES) { const active = candidate === page; const tab = $(`nav-${candidate}`); tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; $(`page-${candidate}`).hidden = !active; } updateLocation(); if (page === 'settings' && state.providerSettings === null && !state.settingsBusy) void loadProviderSettings(); if (moveFocus) $(`nav-${page}`).focus(); }
function compareIssues(a, b) { return a.raisedAt.localeCompare(b.raisedAt) || a.id.localeCompare(b.id); }
function activeIssueForStation(room, stationId) { return room.issues.filter((issue) => issue.stationId === stationId && ACTIVE_ISSUE_STATUSES.has(issue.status)).sort(compareIssues)[0] || null; }
function stationStatus(room, station) { return activeIssueForStation(room, station.id) ? 'ISSUE ACTIVE' : 'HEALTHY'; }
function floors(room) { return [...new Set(room.stations.map((station) => station.floorId))].sort(); }
async function request(url, options) { const response = await fetch(url, options); const body = await response.json(); if (!response.ok) throw new Error(body.error?.message || 'The action could not be completed.'); return body; }
async function loadRooms() { const body = await request('/api/rooms'); state.rooms = body.rooms.filter((room) => room.health === 'READY'); const picker = $('room-picker'); picker.replaceChildren(); for (const room of state.rooms) { const option = element('option'); option.value = room.roomId; option.textContent = `${room.displayName} (${room.roomId})`; picker.append(option); } const locationState = new URLSearchParams(location.hash.slice(1)); const requested = locationState.get('room'); const requestedPage = locationState.get('view'); if (APP_PAGES.includes(requestedPage)) state.activePage = requestedPage; const remembered = localStorage.getItem('response-compass.room'); const selected = state.rooms.find((room) => room.roomId === requested) || state.rooms.find((room) => room.roomId === remembered) || state.rooms[0]; if (!selected) throw new Error('No ready Control Room is available.'); picker.value = selected.roomId; await loadRoom(selected.roomId, true); }
async function loadRoom(roomId, roomSwitch = false) { setStatus('Loading room…'); const body = await request(`/api/rooms/${encodeURIComponent(roomId)}`); const previousRoomId = state.room?.roomId; state.room = body.room; if (roomSwitch || previousRoomId !== roomId) { state.selectedStationId = null; state.selectedResponderId = null; state.selectedFloorId = null; state.lastRecommendation = null; state.activeTab = 'stations'; state.zoom = 1; state.panX = 0; state.panY = 0; } const roomFloors = floors(state.room); const oldest = [...state.room.issues].filter((issue) => ACTIVE_ISSUE_STATUSES.has(issue.status)).sort(compareIssues)[0]; const stationExists = state.room.stations.some((station) => station.id === state.selectedStationId); state.selectedStationId = stationExists ? state.selectedStationId : oldest?.stationId || state.room.stations[0]?.id || null; const selectedStation = state.room.stations.find((station) => station.id === state.selectedStationId); state.selectedFloorId = roomFloors.includes(state.selectedFloorId) ? state.selectedFloorId : selectedStation?.floorId || roomFloors[0] || null; localStorage.setItem('response-compass.room', roomId); render(); updateLocation(); setStatus(`${state.room.displayName} · revision ${state.room.revision}`); }
function render() { const room = state.room; if (!room) return; selectPage(state.activePage); renderSimulation(room); const summary = $('room-summary'); summary.replaceChildren(); for (const [label, value] of [['Room', room.displayName], ['Mode', room.mode], ['Clock', room.clockState], ['Revision', String(room.revision)]]) { const item = element('span'); item.append(text(element('strong'), `${label}: `), document.createTextNode(value)); summary.append(item); } renderFloorControls(room); renderFloor(room); renderTab(room); renderStation(room); renderEvents(room); renderAnalytics(room); $('offer-next').disabled = state.busy || !room.issues.some((issue) => issue.status === 'PENDING' || issue.status === 'REOPENED'); }
function selectedAssignment(room) { const issue = activeIssueForStation(room, state.selectedStationId); return room.assignments.find((assignment) => assignment.issueId === issue?.id && assignment.status === 'ACTIVE') || null; }
function renderSimulation(room) { $('simulation-speed').value = String(room.speedMultiplier ?? 60); $('simulation-speed').disabled = state.busy; $('simulation-time').textContent = `${new Date(room.simulatedAt).toLocaleString()} · ${room.clockState}`; $('pause-simulation').disabled = state.busy || room.clockState === 'PAUSED'; $('resume-simulation').disabled = state.busy || room.clockState === 'RUNNING'; $('trigger-event').disabled = state.busy; $('force-resolve').disabled = state.busy || selectedAssignment(room) === null; }
function renderFloorControls(room) {
  const picker = $('floor-picker');
  picker.replaceChildren();
  for (const floorId of floors(room)) { const option = element('option'); option.value = floorId; option.textContent = floorId; picker.append(option); }
  picker.value = state.selectedFloorId || '';
  const searchOptions = $('floor-search-options');
  searchOptions.replaceChildren();
  const targets = [
    ...room.stations.map((station) => ({ value: station.id, label: `${station.displayName} · ${station.floorId}` })),
    ...room.issues.map((issue) => ({ value: issue.id, label: `${issue.class} · ${issue.status}` })),
    ...room.responders.filter((person) => person.dutyStatus !== 'OFF_SHIFT').map((person) => ({ value: person.id, label: `${person.displayName} · ${person.role}` })),
  ];
  for (const target of targets) { const option = element('option'); option.value = target.value; option.label = target.label; searchOptions.append(option); }
  $('zoom-label').textContent = `${Math.round(state.zoom * 100)}%`;
  $('zoom-in').disabled = state.zoom >= 1.5;
  $('zoom-out').disabled = state.zoom <= .75;
}
function ensureFloorLayers(viewport) {
  let world = viewport.querySelector('.floor-world');
  if (world) return world;
  world = element('div', 'floor-world');
  const scene = element('div', 'floor-scene');
  scene.setAttribute('aria-hidden', 'true');
  scene.append(element('div', 'floor-plane'));
  const overlay = element('div', 'floor-overlay');
  const leaders = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  leaders.setAttribute('class', 'floor-leaders');
  leaders.setAttribute('viewBox', '0 0 1000 520');
  leaders.setAttribute('aria-hidden', 'true');
  overlay.append(leaders);
  world.append(scene, overlay);
  viewport.append(world);
  return world;
}
function keyedNodes(parent, selector, key) { return new Map([...parent.querySelectorAll(selector)].map((node) => [node.dataset[key], node])); }
function removeUnused(nodes, used) { for (const [id, node] of nodes) if (!used.has(id)) node.remove(); }
function setWorldPosition(node, point) { node.style.left = `${point.sx}px`; node.style.top = `${point.sy}px`; }
function viewportScale() { const viewport = $('floor-viewport'); return viewportFit(viewport.clientWidth, viewport.clientHeight) * state.zoom; }
function panLimits() { const viewport = $('floor-viewport'); return { x: Math.max(48, viewport.clientWidth * .38), y: Math.max(40, viewport.clientHeight * .34) }; }
function clampPan(x, y) { const limits = panLimits(); return { x: Math.max(-limits.x, Math.min(limits.x, x)), y: Math.max(-limits.y, Math.min(limits.y, y)) }; }
function applyViewportTransform() { const world = $('floor-viewport').querySelector('.floor-world'); if (!world) return; world.style.setProperty('--floor-scale', String(viewportScale())); world.style.setProperty('--floor-pan-x', `${state.panX}px`); world.style.setProperty('--floor-pan-y', `${state.panY}px`); }
function focusProjectedPoint(point) { const scale = viewportScale(); const pan = clampPan((500 - point.sx) * scale, (260 - point.sy) * scale); state.panX = pan.x; state.panY = pan.y; applyViewportTransform(); }
function renderFloor(room) {
  const viewport = $('floor-viewport');
  const focusedKey = document.activeElement?.dataset?.floorKey || null;
  const world = ensureFloorLayers(viewport);
  const scene = world.querySelector('.floor-scene');
  const overlay = world.querySelector('.floor-overlay');
  const leaders = overlay.querySelector('.floor-leaders');
  const floorStations = room.stations.filter((station) => station.floorId === state.selectedFloorId);
  const bounds = coordinateBounds(floorStations);
  const stationLayout = floorStations.map((station) => {
    const base = projectPoint(normalizePoint(station, bounds));
    const top = projectPoint({ ...normalizePoint(station, bounds), z: 26 });
    return { station, base, top, issue: activeIssueForStation(room, station.id) };
  }).sort((a, b) => a.base.depth - b.base.depth || a.station.id.localeCompare(b.station.id));
  const machineNodes = keyedNodes(scene, '.floor-machine', 'stationId');
  const stationHits = keyedNodes(overlay, '.floor-hit.station-hit', 'stationId');
  const stationLabels = keyedNodes(overlay, '.floor-label.station-label', 'stationId');
  const usedStations = new Set();
  const labelInputs = [];
  for (const item of stationLayout) {
    const { station, issue } = item;
    usedStations.add(station.id);
    let machine = machineNodes.get(station.id);
    if (!machine) {
      machine = element('div', 'floor-machine');
      machine.dataset.stationId = station.id;
      for (const face of ['top', 'front', 'side']) machine.append(element('span', `machine-face ${face}`));
      scene.append(machine);
    }
    machine.className = `floor-machine${issue ? ' active' : ''}${station.id === state.selectedStationId ? ' selected' : ''}`;
    setWorldPosition(machine, item.base);
    let hit = stationHits.get(station.id);
    if (!hit) {
      hit = element('button', 'floor-hit station-hit');
      hit.type = 'button';
      hit.dataset.stationId = station.id;
      hit.dataset.floorKey = `station:${station.id}`;
      hit.addEventListener('click', () => focusStationById(station.id));
      overlay.append(hit);
    }
    hit.className = `floor-hit station-hit${station.id === state.selectedStationId ? ' selected' : ''}`;
    hit.setAttribute('aria-label', `${station.displayName}, ${stationStatus(room, station)}`);
    setWorldPosition(hit, item.base);
    let label = stationLabels.get(station.id);
    if (!label) { label = element('div', 'floor-label station-label'); label.dataset.stationId = station.id; overlay.append(label); }
    label.replaceChildren(text(element('strong'), station.displayName), text(element('span'), issue ? `${issue.class} · ${issue.status}` : 'Healthy'));
    label.classList.toggle('active', Boolean(issue));
    labelInputs.push({ id: `station:${station.id}`, anchor: { x: item.top.sx, y: item.top.sy }, width: 112, height: 38, node: label });
  }
  removeUnused(machineNodes, usedStations); removeUnused(stationHits, usedStations); removeUnused(stationLabels, usedStations);

  const responders = layoutResponders(room).filter((person) => person.floorId === state.selectedFloorId);
  const personNodes = keyedNodes(scene, '.floor-person', 'responderId');
  const personHits = keyedNodes(overlay, '.floor-hit.person-hit', 'responderId');
  const personLabels = keyedNodes(overlay, '.floor-label.person-label', 'responderId');
  const usedPeople = new Set();
  for (const person of responders) {
    usedPeople.add(person.id);
    const projected = projectPoint(normalizePoint(person, bounds));
    projected.sx += person.offsetX; projected.sy += person.offsetY;
    let puck = personNodes.get(person.id);
    if (!puck) { puck = element('div', 'floor-person'); puck.dataset.responderId = person.id; scene.append(puck); }
    puck.className = `floor-person${person.id === state.selectedResponderId ? ' selected' : ''}`;
    setWorldPosition(puck, projected);
    let hit = personHits.get(person.id);
    if (!hit) {
      hit = element('button', 'floor-hit person-hit'); hit.type = 'button'; hit.dataset.responderId = person.id; hit.dataset.floorKey = `person:${person.id}`;
      hit.addEventListener('click', () => focusResponderById(person.id));
      overlay.append(hit);
    }
    hit.className = `floor-hit person-hit${person.id === state.selectedResponderId ? ' selected' : ''}`;
    hit.setAttribute('aria-label', `${person.displayName}, ${person.role}, ${person.dutyStatus}${person.assigned ? ', assigned beside equipment' : ', at duty station'}`);
    setWorldPosition(hit, projected);
    let label = personLabels.get(person.id);
    if (!label) { label = element('div', 'floor-label person-label'); label.dataset.responderId = person.id; overlay.append(label); }
    label.replaceChildren(text(element('strong'), person.displayName), text(element('span'), `${person.role} · ${person.dutyStatus}`));
    labelInputs.push({ id: `person:${person.id}`, anchor: { x: projected.sx, y: projected.sy }, width: 118, height: 38, node: label });
  }
  removeUnused(personNodes, usedPeople); removeUnused(personHits, usedPeople); removeUnused(personLabels, usedPeople);
  leaders.replaceChildren();
  const placements = placeLabels(labelInputs, { width: 1000, height: 520 });
  for (const placement of placements) {
    const input = labelInputs.find((candidate) => candidate.id === placement.id);
    input.node.hidden = placement.hidden;
    if (placement.hidden) continue;
    input.node.style.left = `${placement.rect.x}px`; input.node.style.top = `${placement.rect.y}px`;
    input.node.dataset.labelSide = placement.side;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', placement.leader.x1); line.setAttribute('y1', placement.leader.y1); line.setAttribute('x2', placement.leader.x2); line.setAttribute('y2', placement.leader.y2);
    leaders.append(line);
  }
  viewport.setAttribute('aria-label', `${state.selectedFloorId} interactive manufacturing floor viewport`);
  applyViewportTransform();
  if (focusedKey) [...overlay.querySelectorAll('[data-floor-key]')].find((node) => node.dataset.floorKey === focusedKey)?.focus({ preventScroll: true });
}
function focusStationById(stationId, moveFocus = true) {
  const target = stationFocus(state.room?.stations || [], stationId);
  if (!target) return false;
  selectPage('production-floor');
  state.selectedStationId = target.stationId; state.selectedFloorId = target.floorId; state.selectedResponderId = null; state.lastRecommendation = null;
  render(); focusProjectedPoint(target);
  if (moveFocus) requestAnimationFrame(() => [...document.querySelectorAll('.station-hit')].find((node) => node.dataset.stationId === target.stationId)?.focus({ preventScroll: true }));
  return true;
}
function focusResponderById(responderId, moveFocus = true) {
  const person = state.room ? layoutResponders(state.room).find((candidate) => candidate.id === responderId) : null;
  if (!person) return false;
  selectPage('production-floor'); state.selectedResponderId = person.id; state.selectedFloorId = person.floorId; render();
  const bounds = coordinateBounds(state.room.stations.filter((station) => station.floorId === person.floorId));
  const point = projectPoint(normalizePoint(person, bounds)); point.sx += person.offsetX; point.sy += person.offsetY; focusProjectedPoint(point);
  if (moveFocus) requestAnimationFrame(() => [...document.querySelectorAll('.person-hit')].find((node) => node.dataset.responderId === person.id)?.focus({ preventScroll: true }));
  return true;
}
function selectStation(station) { focusStationById(station.id, false); }
function renderTab(room) { for (const tab of ['stations', 'personnel']) { const button = $(`tab-${tab}`); const active = state.activeTab === tab; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); } const panel = $('floor-list'); panel.replaceChildren(); if (state.activeTab === 'stations') renderStationList(panel, room); else renderPersonnelList(panel, room); }
function renderStationList(panel, room) { const floorStations = room.stations.filter((station) => station.floorId === state.selectedFloorId); const active = floorStations.filter((station) => activeIssueForStation(room, station.id)); const healthy = floorStations.filter((station) => !activeIssueForStation(room, station.id)); panel.append(listHeading('Active stations', active.length), ...active.map((station) => stationListItem(room, station))); const details = element('details', 'collapsed-list'); details.append(text(element('summary'), `Healthy stations (${healthy.length})`), ...healthy.map((station) => stationListItem(room, station))); panel.append(details); }
function stationListItem(room, station) { const issue = activeIssueForStation(room, station.id); const button = element('button', `list-item${station.id === state.selectedStationId ? ' selected' : ''}`); button.type = 'button'; button.append(text(element('strong'), station.displayName), text(element('span'), issue ? `${issue.class} · ${issue.status}` : 'Healthy')); button.addEventListener('click', () => selectStation(station)); return button; }
function renderPersonnelList(panel, room) { const onDuty = room.responders.filter((person) => person.dutyStatus !== 'OFF_SHIFT'); const offShift = room.responders.filter((person) => person.dutyStatus === 'OFF_SHIFT'); panel.append(listHeading('On-duty personnel', onDuty.length), ...onDuty.map(personListItem)); const details = element('details', 'collapsed-list'); details.append(text(element('summary'), `Off-shift personnel (${offShift.length})`), ...offShift.map(personListItem)); panel.append(details); }
function personListItem(person) { const button = element('button', `list-item person${person.id === state.selectedResponderId ? ' selected' : ''}`); button.type = 'button'; button.append(text(element('strong'), person.displayName), text(element('span'), `${person.role} · ${person.dutyStatus}`)); button.addEventListener('click', () => { if (!focusResponderById(person.id) && person.dutyStatus === 'OFF_SHIFT') setStatus(`${person.displayName} is off shift and is not shown on the floor.`); }); return button; }
function listHeading(label, count) { return text(element('p', 'list-heading'), `${label} (${count})`); }
function renderStation(room) { const box = $('station-status'); box.replaceChildren(); const station = room.stations.find((candidate) => candidate.id === state.selectedStationId); if (!station) return box.append(text(element('p', 'empty'), 'Select a station.')); box.append(text(element('p', 'meta'), `${station.displayName} · ${station.floorId} · ${stationStatus(room, station)}`)); const issue = activeIssueForStation(room, station.id); if (!issue) return box.append(text(element('p', 'empty'), 'No active work at this station.')); box.append(text(element('p', 'issue-title'), `${issue.id} · ${issue.class}`), text(element('span', `priority ${issue.priority.band}`), `${issue.priority.band} · ${issue.priority.score}`), text(element('p', 'meta'), `Raised ${new Date(issue.raisedAt).toLocaleString()} · ${issue.status}`)); const pending = room.offers.find((offer) => offer.issueId === issue.id && offer.status === 'PENDING'); if (pending) renderOffer(box, room, pending); else if (issue.status === 'PENDING') box.append(text(element('p', 'meta'), 'Pending dispatch. Use “Offer next issue” to create an offer.')); else if (issue.status === 'ASSIGNED') { const assignment = room.assignments.find((candidate) => candidate.issueId === issue.id && candidate.status === 'ACTIVE'); const responder = room.responders.find((candidate) => candidate.id === assignment?.responderId); box.append(text(element('p', 'recommendation'), `Assigned to ${responder?.displayName || assignment?.responderId || 'unknown responder'}.`)); } if (state.lastRecommendation?.issueId === issue.id) renderRecommendation(box, state.lastRecommendation); }
function renderRecommendation(box, recommendation) { const wrap = element('div', 'recommendation'); const source = recommendation.source === 'PROVIDER' ? `${recommendation.provider || 'Provider'} recommendation` : 'Deterministic fallback'; wrap.append(text(element('strong'), source)); if (recommendation.explanation) wrap.append(text(element('p', 'meta'), recommendation.explanation)); if (recommendation.uncertainty) wrap.append(text(element('p', 'meta'), `Uncertainty: ${recommendation.uncertainty}`)); if (recommendation.meaningfulAlternativeId) wrap.append(text(element('p', 'meta'), `Alternative: ${recommendation.meaningfulAlternativeId}`)); const list = element('ol', 'candidate-list'); for (const candidate of recommendation.candidates) list.append(text(element('li'), `${candidate.displayName} · ${candidate.travelMinutes} min travel · ${candidate.evidenceStrength} evidence`)); wrap.append(list); box.append(wrap); }
function renderOffer(box, room, offer) { const responder = room.responders.find((candidate) => candidate.id === offer.responderId); const wrap = element('div', 'offer'); wrap.append(text(element('strong'), `Offer pending: ${responder?.displayName || offer.responderId}`), text(element('p', 'meta'), 'Assignment occurs only after acceptance.')); const actions = element('div', 'offer-actions'); actions.append(actionButton('Accept offer', () => mutate(`/offers/${encodeURIComponent(offer.id)}/accept`, {}), 'primary'), actionButton('Reject offer', () => mutate(`/offers/${encodeURIComponent(offer.id)}/reject`, {}), 'danger')); const available = room.responders.filter((candidate) => candidate.dutyStatus === 'AVAILABLE'); if (available.length) { const override = element('div', 'override'); const select = element('select'); for (const candidate of available) { const option = element('option'); option.value = candidate.id; option.textContent = `Override to ${candidate.displayName}`; select.append(option); } override.append(select, actionButton('Override', () => mutate(`/offers/${encodeURIComponent(offer.id)}/override`, { responderId: select.value }))); wrap.append(actions, override); } else wrap.append(actions); box.append(wrap); }
function actionButton(label, onClick, className = '') { const button = text(element('button', className), label); button.type = 'button'; button.disabled = state.busy; button.addEventListener('click', onClick); return button; }
function eventTarget(room, event) {
  const payload = event.publicPayload || {};
  const directStationId = typeof payload.stationId === 'string' ? payload.stationId : typeof payload.equipmentId === 'string' ? payload.equipmentId : null;
  if (directStationId && room.stations.some((station) => station.id === directStationId)) return { type: 'station', id: directStationId };
  const issue = typeof payload.issueId === 'string' ? room.issues.find((candidate) => candidate.id === payload.issueId) : null;
  if (issue) return { type: 'station', id: issue.stationId };
  if (typeof payload.responderId === 'string') return { type: 'person', id: payload.responderId };
  return null;
}
function activateFloorTarget(target) { if (!target) return false; return target.type === 'person' ? focusResponderById(target.id) : focusStationById(target.id); }
function renderEvents(room) {
  const list = $('events'); list.replaceChildren();
  for (const event of [...room.events].reverse().slice(0, 25)) {
    const item = element('li'); const target = eventTarget(room, event);
    const content = target ? element('button', 'event-focus') : element('div', 'event-static');
    content.append(text(element('span', 'event-type'), event.type.replaceAll('_', ' ')), text(element('span', 'event-time'), new Date(event.occurredAt).toLocaleString()));
    if (target) { content.type = 'button'; content.setAttribute('aria-label', `${event.type.replaceAll('_', ' ')} at ${new Date(event.occurredAt).toLocaleString()}; focus related floor location`); content.addEventListener('click', () => activateFloorTarget(target)); }
    item.append(content); list.append(item);
  }
}
function focusSearchResult(query) {
  const normalized = query.trim().toLocaleLowerCase(); if (!normalized || !state.room) return false;
  const issue = state.room.issues.find((candidate) => candidate.id.toLocaleLowerCase() === normalized);
  if (issue) return focusStationById(issue.stationId);
  const station = state.room.stations.find((candidate) => candidate.id.toLocaleLowerCase() === normalized || candidate.displayName.toLocaleLowerCase() === normalized) || state.room.stations.find((candidate) => `${candidate.id} ${candidate.displayName}`.toLocaleLowerCase().includes(normalized));
  if (station) return focusStationById(station.id);
  const person = state.room.responders.filter((candidate) => candidate.dutyStatus !== 'OFF_SHIFT').find((candidate) => candidate.id.toLocaleLowerCase() === normalized || candidate.displayName.toLocaleLowerCase() === normalized) || state.room.responders.filter((candidate) => candidate.dutyStatus !== 'OFF_SHIFT').find((candidate) => `${candidate.id} ${candidate.displayName}`.toLocaleLowerCase().includes(normalized));
  return person ? focusResponderById(person.id) : false;
}
function setSettingsStatus(message, error = false) { const node = $('settings-status'); node.textContent = message; node.classList.toggle('error', error); }
async function loadProviderSettings() { state.settingsBusy = true; setSettingsStatus('Loading provider settings…'); try { state.providerSettings = await request('/api/settings/providers'); renderProviderSettings(); setSettingsStatus('Provider settings loaded.'); } catch (error) { setSettingsStatus(error instanceof Error ? error.message : 'Provider settings could not be loaded.', true); } finally { state.settingsBusy = false; if (state.providerSettings) renderProviderSettings(); } }
function renderProviderSettings() {
  const settings = state.providerSettings;
  if (!settings) return;
  $('compass-provider-summary').textContent = settings.compass
    ? `Compass provider: ${settings.compass.provider === 'openai' ? 'OpenAI' : 'OpenRouter'} · ${settings.compass.model}`
    : 'Compass uses deterministic fallback.';
  for (const provider of settings.providers) {
    const badge = $(`${provider.id}-configured`);
    badge.textContent = provider.configured ? 'Configured' : 'Not configured';
    badge.classList.toggle('configured', provider.configured);
    $(`${provider.id}-credential-meta`).textContent = provider.configured
      ? `${provider.credentialSource === 'SETTINGS' ? 'Saved key' : 'Environment key'} · ${provider.maskedEnding}${provider.refreshedAt ? ` · models refreshed ${new Date(provider.refreshedAt).toLocaleString()}` : ''}`
      : 'No API key configured.';
    const picker = $(`${provider.id}-model`);
    const previous = settings.compass?.provider === provider.id ? settings.compass.model : picker.value;
    picker.replaceChildren();
    if (provider.models.length === 0) {
      const option = element('option');
      option.value = '';
      option.textContent = provider.configured ? 'Refresh to load models' : 'Save a valid key first';
      picker.append(option);
    } else {
      for (const model of provider.models) {
        const option = element('option');
        option.value = model.id;
        option.textContent = model.name === model.id ? model.id : `${model.name} · ${model.id}`;
        picker.append(option);
      }
      if (provider.models.some((model) => model.id === previous)) picker.value = previous;
    }
    picker.disabled = state.settingsBusy || provider.models.length === 0;
    const card = document.querySelector(`.provider-card[data-provider="${provider.id}"]`);
    card.querySelector('[data-provider-action="save"]').disabled = state.settingsBusy;
    card.querySelector('[data-provider-action="select"]').disabled = state.settingsBusy || provider.models.length === 0;
    card.querySelector('[data-provider-action="refresh"]').disabled = state.settingsBusy || !provider.configured;
    card.querySelector('[data-provider-action="remove"]').disabled = state.settingsBusy || provider.credentialSource !== 'SETTINGS';
  }
}
async function providerAction(providerId, action) {
  if (state.settingsBusy) return;
  state.settingsBusy = true;
  renderProviderSettings();
  setSettingsStatus(action === 'save' ? 'Validating key and loading models…' : 'Updating provider settings…');
  const input = $(`${providerId}-api-key`);
  try {
    if (action === 'save') {
      const apiKey = input.value;
      if (!apiKey.trim()) throw new Error('Enter an API key.');
      state.providerSettings = await request(`/api/settings/providers/${providerId}/credential`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });
      setSettingsStatus('API key validated and model catalog loaded.');
    } else if (action === 'refresh') {
      state.providerSettings = await request(`/api/settings/providers/${providerId}/models/refresh`, { method: 'POST' });
      setSettingsStatus('Model catalog refreshed.');
    } else if (action === 'remove') {
      if (!confirm('Remove the settings-managed API key?')) {
        setSettingsStatus('Removal cancelled.');
        return;
      }
      state.providerSettings = await request(`/api/settings/providers/${providerId}/credential`, { method: 'DELETE' });
      setSettingsStatus('Settings-managed API key removed.');
    } else if (action === 'select') {
      const model = $(`${providerId}-model`).value;
      state.providerSettings = await request('/api/settings/compass', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: providerId, model }),
      });
      setSettingsStatus('Compass provider and model saved.');
    }
  } catch (error) {
    setSettingsStatus(error instanceof Error ? error.message : 'Provider settings could not be updated.', true);
  } finally {
    input.value = '';
    state.settingsBusy = false;
    renderProviderSettings();
  }
}
function statCard(title, primary, details) {
  const card = element('div', 'stat-card');
  card.append(text(element('p', 'eyebrow'), title), text(element('p', 'stat-primary'), primary));
  for (const d of details) card.append(text(element('p', 'stat-detail'), d));
  return card;
}
function floorFocusButton(label, stationId) { const button = text(element('button', 'table-focus'), label); button.type = 'button'; button.addEventListener('click', () => focusStationById(stationId)); return button; }
function renderAnalytics(room) {
  const container = $('analytics-content');
  if (!container || state.activePage !== 'analytics') return;
  container.replaceChildren();
  const active = room.issues.filter((i) => ACTIVE_ISSUE_STATUSES.has(i.status));
  const resolved = room.issues.filter((i) => i.status === 'RESOLVED');
  const byStatus = {};
  for (const i of room.issues) byStatus[i.status] = (byStatus[i.status] || 0) + 1;
  const byBand = { CRITICAL: 0, HIGH: 0, STANDARD: 0 };
  for (const i of active) byBand[i.priority.band] = (byBand[i.priority.band] || 0) + 1;
  const byDuty = {};
  for (const r of room.responders) byDuty[r.dutyStatus] = (byDuty[r.dutyStatus] || 0) + 1;
  const byClass = {};
  for (const i of room.issues) byClass[i.class] = (byClass[i.class] || 0) + 1;
  let mttr = null;
  if (resolved.length > 0) { const total = resolved.reduce((s, i) => s + (Date.parse(i.resolvedAt) - Date.parse(i.raisedAt)), 0); mttr = Math.round(total / resolved.length / 60_000); }
  const stationCounts = {};
  for (const i of room.issues) stationCounts[i.stationId] = (stationCounts[i.stationId] || 0) + 1;
  const hotspots = Object.entries(stationCounts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, count]) => ({ station: room.stations.find((s) => s.id === id), count }));
  const openByAge = [...active].sort((a, b) => a.raisedAt.localeCompare(b.raisedAt));
  // Header
  const hdr = element('div', 'analytics-header');
  hdr.append(text(element('h2'), `${room.displayName} — Analytics`), text(element('p', 'meta'), `Simulated ${new Date(room.simulatedAt).toLocaleString()} · ${room.issues.length} total issues · revision ${room.revision}`));
  container.append(hdr);
  // Stat cards
  const cards = element('div', 'stat-cards');
  const statusOrder = ['PENDING', 'OFFER_PENDING', 'ASSIGNED', 'REOPENED', 'RESOLVED'];
  cards.append(
    statCard('Issue Queue', String(room.issues.length), statusOrder.filter((s) => byStatus[s]).map((s) => `${byStatus[s]} ${s.replaceAll('_', ' ')}`)),
    statCard('Active Priority', String(active.length), ['CRITICAL', 'HIGH', 'STANDARD'].map((b) => `${byBand[b]} ${b}`)),
    statCard('Team Status', `${room.responders.filter((r) => r.dutyStatus !== 'OFF_SHIFT').length} on duty`, ['AVAILABLE', 'OFFERED', 'ASSIGNED', 'OFF_SHIFT'].map((d) => `${byDuty[d] || 0} ${d.replaceAll('_', ' ')}`)),
    statCard('Resolution Time', mttr !== null ? `${mttr} min avg` : '—', mttr !== null ? [`${resolved.length} resolved`, 'Simulated minutes'] : ['No resolved issues yet']),
  );
  container.append(cards);
  // Two-column: class distribution + hotspots
  const twoCol = element('div', 'analytics-two-col');
  const classSection = element('div', 'analytics-panel');
  classSection.append(text(element('p', 'eyebrow'), 'Issue class distribution'));
  const classMax = Math.max(1, ...Object.values(byClass));
  const classChart = element('div', 'class-chart');
  for (const cls of ['MECHANICAL', 'ELECTRICAL', 'CALIBRATION', 'MATERIAL_FEED', 'SOFTWARE']) {
    const count = byClass[cls] || 0;
    const row = element('div', 'bar-row');
    const bar = element('div', 'bar');
    bar.style.setProperty('--bar-pct', `${Math.round((count / classMax) * 100)}%`);
    row.append(text(element('span', 'bar-label'), cls.replace('_', ' ')), bar, text(element('span', 'bar-count'), String(count)));
    classChart.append(row);
  }
  classSection.append(classChart);
  twoCol.append(classSection);
  const hotSection = element('div', 'analytics-panel');
  hotSection.append(text(element('p', 'eyebrow'), 'Station hotspots'));
  if (!hotspots.length) { hotSection.append(text(element('p', 'empty'), 'No issue data yet.')); }
  else {
    const table = element('table', 'hotspot-table');
    const thead = element('thead'); thead.innerHTML = '<tr><th>Station</th><th>Floor</th><th>Issues</th></tr>';
    const tbody = element('tbody');
    for (const { station, count } of hotspots) { const tr = element('tr'); const stationCell = element('td'); if (station) stationCell.append(floorFocusButton(station.displayName, station.id)); else stationCell.textContent = '—'; tr.append(stationCell, text(element('td', 'meta'), station?.floorId || '—'), text(element('td', 'count'), String(count))); tbody.append(tr); }
    table.append(thead, tbody); hotSection.append(table);
  }
  twoCol.append(hotSection);
  container.append(twoCol);
  // Open issue age table
  const ageSection = element('div', 'analytics-panel analytics-full');
  ageSection.append(text(element('p', 'eyebrow'), `Open issues by age (${openByAge.length})`));
  if (!openByAge.length) { ageSection.append(text(element('p', 'empty'), 'No open issues.')); }
  else {
    const table = element('table', 'age-table');
    const thead = element('thead'); thead.innerHTML = '<tr><th>Issue</th><th>Class</th><th>Priority</th><th>Status</th><th>Station</th><th>Raised (simulated)</th></tr>';
    const tbody = element('tbody');
    for (const issue of openByAge) {
      const station = room.stations.find((s) => s.id === issue.stationId);
      const tr = element('tr');
      const priCell = element('td'); priCell.innerHTML = `<span class="priority ${issue.priority.band}">${issue.priority.band}</span>`;
      const issueCell = element('td', 'mono'); issueCell.append(floorFocusButton(issue.id, issue.stationId));
      const stationCell = element('td', 'meta'); stationCell.append(floorFocusButton(station?.displayName || issue.stationId, issue.stationId));
      tr.append(issueCell, text(element('td'), issue.class.replace('_', ' ')), priCell, text(element('td', 'meta'), issue.status.replaceAll('_', ' ')), stationCell, text(element('td', 'meta'), new Date(issue.raisedAt).toLocaleString()));
      tbody.append(tr);
    }
    table.append(thead, tbody); ageSection.append(table);
  }
  container.append(ageSection);
}
async function mutate(path, extra) {
  if (state.busy || !state.room) return;
  state.busy = true;
  render();
  try {
    const body = await request(roomUrl(path), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: state.room.revision, ...extra }),
    });
    state.room = body.room;
    state.lastRecommendation = body.recommendation || null;
    const focusIssueId = body.outcome?.issueId || body.nextOffer?.issueId || body.offer?.issueId;
    const focusIssue = state.room.issues.find((issue) => issue.id === focusIssueId);
    if (focusIssue) {
      state.selectedStationId = focusIssue.stationId;
      state.selectedFloorId = state.room.stations.find((station) => station.id === focusIssue.stationId)?.floorId || state.selectedFloorId;
    }
    render();
    if (focusIssue) { const target = stationFocus(state.room.stations, focusIssue.stationId); if (target) focusProjectedPoint(target); }
    const outcome = body.outcome
      ? ` · ${body.outcome.status.toLowerCase()} after ${body.outcome.durationMinutes} simulated minutes`
      : '';
    setStatus(`Action applied${outcome} · revision ${state.room.revision}`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Action failed.', true);
    await loadRoom(state.room.roomId);
  } finally {
    state.busy = false;
    render();
  }
}
$('pause-simulation').addEventListener('click', () => mutate('/pause', {}));
$('simulation-speed').addEventListener('change', () => mutate('/speed', { speedMultiplier: Number($('simulation-speed').value) }));
$('resume-simulation').addEventListener('click', () => mutate('/resume', {}));
$('trigger-event').addEventListener('click', () => mutate('/trigger', {}));
$('force-resolve').addEventListener('click', () => {
  const assignment = selectedAssignment(state.room);
  if (assignment) mutate(`/assignments/${encodeURIComponent(assignment.id)}/resolve`, {});
});
for (const button of document.querySelectorAll('[data-provider-action]')) {
  button.addEventListener('click', () => providerAction(button.dataset.provider, button.dataset.providerAction));
}
for (const tab of document.querySelectorAll('.primary-tab')) {
  tab.addEventListener('click', () => { selectPage(tab.dataset.page, true); if (state.room) renderAnalytics(state.room); });
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const current = APP_PAGES.indexOf(state.activePage);
    selectPage(APP_PAGES[(current + direction + APP_PAGES.length) % APP_PAGES.length], true);
  });
}
selectPage(state.activePage);
function changeZoom(delta) { state.zoom = Math.max(.75, Math.min(1.5, Number((state.zoom + delta).toFixed(2)))); renderFloorControls(state.room); applyViewportTransform(); }
const floorViewport = $('floor-viewport');
let pointerInsideViewport = false;
let spacePressed = false;
let drag = null;
floorViewport.addEventListener('pointerenter', () => { pointerInsideViewport = true; floorViewport.classList.toggle('pan-ready', spacePressed); });
floorViewport.addEventListener('pointerleave', () => { pointerInsideViewport = false; floorViewport.classList.remove('pan-ready'); });
document.addEventListener('keydown', (event) => { const editable = event.target.closest?.('input, select, textarea, button, [contenteditable]'); if (event.code !== 'Space' || editable) return; spacePressed = true; if (pointerInsideViewport) { event.preventDefault(); floorViewport.classList.add('pan-ready'); } });
document.addEventListener('keyup', (event) => { if (event.code !== 'Space') return; spacePressed = false; floorViewport.classList.remove('pan-ready'); });
window.addEventListener('blur', () => { spacePressed = false; drag = null; floorViewport.classList.remove('pan-ready', 'dragging'); });
floorViewport.addEventListener('pointerdown', (event) => { const overControl = Boolean(event.target.closest?.('button')); if (!canStartViewportPan({ button: event.button, pointerType: event.pointerType, spacePressed, overControl })) return; event.preventDefault(); drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY }; floorViewport.focus({ preventScroll: true }); floorViewport.setPointerCapture(event.pointerId); floorViewport.classList.add('dragging'); });
floorViewport.addEventListener('pointermove', (event) => { if (!drag || event.pointerId !== drag.pointerId) return; const pan = clampPan(drag.panX + event.clientX - drag.x, drag.panY + event.clientY - drag.y); state.panX = pan.x; state.panY = pan.y; applyViewportTransform(); });
function endFloorDrag(event) { if (!drag || event.pointerId !== drag.pointerId) return; drag = null; floorViewport.classList.remove('dragging'); }
floorViewport.addEventListener('pointerup', endFloorDrag); floorViewport.addEventListener('pointercancel', endFloorDrag);
floorViewport.addEventListener('keydown', (event) => { if (event.target !== floorViewport) return; const action = viewportShortcut(event.key); if (!action) return; event.preventDefault(); changeZoom(action.delta); });
const refitViewport = () => { const pan = clampPan(state.panX, state.panY); state.panX = pan.x; state.panY = pan.y; applyViewportTransform(); };
if ('ResizeObserver' in window) new ResizeObserver(refitViewport).observe(floorViewport); else window.addEventListener('resize', refitViewport);
$('room-picker').addEventListener('change', (event) => loadRoom(event.target.value, true).catch((error) => setStatus(error.message, true)));
$('floor-picker').addEventListener('change', (event) => { state.selectedFloorId = event.target.value; state.selectedResponderId = null; state.panX = 0; state.panY = 0; render(); });
$('floor-search').addEventListener('submit', (event) => { event.preventDefault(); const input = $('floor-search-input'); if (!focusSearchResult(input.value)) setStatus(`No on-floor station, issue, or person matched “${input.value.trim()}”.`, true); else input.select(); });
$('offer-next').addEventListener('click', () => mutate('/offers', {}));
$('tab-stations').addEventListener('click', () => { state.activeTab = 'stations'; render(); });
$('tab-personnel').addEventListener('click', () => { state.activeTab = 'personnel'; render(); });
$('zoom-in').addEventListener('click', () => changeZoom(.25));
$('zoom-out').addEventListener('click', () => changeZoom(-.25));
$('reset-focus').addEventListener('click', () => { const oldest = [...state.room.issues].filter((issue) => ACTIVE_ISSUE_STATUSES.has(issue.status)).sort(compareIssues)[0]; state.zoom = 1; state.panX = 0; state.panY = 0; state.selectedResponderId = null; if (oldest) focusStationById(oldest.stationId, false); else render(); });
loadRooms().catch((error) => setStatus(error instanceof Error ? error.message : 'Unable to load application.', true));
setInterval(() => { if (!state.busy && state.room) loadRoom(state.room.roomId).catch(() => undefined); }, 5000);
