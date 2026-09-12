const state = { rooms: [], room: null, selectedStationId: null, selectedResponderId: null, selectedFloorId: null, activePage: 'production-floor', activeTab: 'stations', zoom: 1, lastRecommendation: null, providerSettings: null, settingsBusy: false, busy: false };
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
function mapPosition(room, point) { const stations = room.stations.filter((station) => station.floorId === state.selectedFloorId); const xs = stations.map((station) => station.x); const ys = stations.map((station) => station.y); const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys); const percent = (value, min, max) => max === min ? 50 : 8 + ((value - min) / (max - min)) * 84; return { left: percent(point.x, minX, maxX), top: percent(point.y, minY, maxY) }; }
async function request(url, options) { const response = await fetch(url, options); const body = await response.json(); if (!response.ok) throw new Error(body.error?.message || 'The action could not be completed.'); return body; }
async function loadRooms() { const body = await request('/api/rooms'); state.rooms = body.rooms.filter((room) => room.health === 'READY'); const picker = $('room-picker'); picker.replaceChildren(); for (const room of state.rooms) { const option = element('option'); option.value = room.roomId; option.textContent = `${room.displayName} (${room.roomId})`; picker.append(option); } const locationState = new URLSearchParams(location.hash.slice(1)); const requested = locationState.get('room'); const requestedPage = locationState.get('view'); if (APP_PAGES.includes(requestedPage)) state.activePage = requestedPage; const remembered = localStorage.getItem('response-compass.room'); const selected = state.rooms.find((room) => room.roomId === requested) || state.rooms.find((room) => room.roomId === remembered) || state.rooms[0]; if (!selected) throw new Error('No ready Control Room is available.'); picker.value = selected.roomId; await loadRoom(selected.roomId, true); }
async function loadRoom(roomId, roomSwitch = false) { setStatus('Loading room…'); const body = await request(`/api/rooms/${encodeURIComponent(roomId)}`); const previousRoomId = state.room?.roomId; state.room = body.room; if (roomSwitch || previousRoomId !== roomId) { state.selectedStationId = null; state.selectedResponderId = null; state.selectedFloorId = null; state.lastRecommendation = null; state.activeTab = 'stations'; state.zoom = 1; } const roomFloors = floors(state.room); const oldest = [...state.room.issues].filter((issue) => ACTIVE_ISSUE_STATUSES.has(issue.status)).sort(compareIssues)[0]; const stationExists = state.room.stations.some((station) => station.id === state.selectedStationId); state.selectedStationId = stationExists ? state.selectedStationId : oldest?.stationId || state.room.stations[0]?.id || null; const selectedStation = state.room.stations.find((station) => station.id === state.selectedStationId); state.selectedFloorId = roomFloors.includes(state.selectedFloorId) ? state.selectedFloorId : selectedStation?.floorId || roomFloors[0] || null; localStorage.setItem('response-compass.room', roomId); render(); updateLocation(); setStatus(`${state.room.displayName} · revision ${state.room.revision}`); }
function render() { const room = state.room; if (!room) return; selectPage(state.activePage); renderSimulation(room); const summary = $('room-summary'); summary.replaceChildren(); for (const [label, value] of [['Room', room.displayName], ['Mode', room.mode], ['Clock', room.clockState], ['Revision', String(room.revision)]]) { const item = element('span'); item.append(text(element('strong'), `${label}: `), document.createTextNode(value)); summary.append(item); } renderFloorControls(room); renderFloor(room); renderTab(room); renderStation(room); renderEvents(room); renderAnalytics(room); $('offer-next').disabled = state.busy || !room.issues.some((issue) => issue.status === 'PENDING' || issue.status === 'REOPENED'); }
function selectedAssignment(room) { const issue = activeIssueForStation(room, state.selectedStationId); return room.assignments.find((assignment) => assignment.issueId === issue?.id && assignment.status === 'ACTIVE') || null; }
function renderSimulation(room) { $('simulation-time').textContent = `${new Date(room.simulatedAt).toLocaleString()} · ${room.clockState}`; $('pause-simulation').disabled = state.busy || room.clockState === 'PAUSED'; $('resume-simulation').disabled = state.busy || room.clockState === 'RUNNING'; $('trigger-event').disabled = state.busy; $('force-resolve').disabled = state.busy || selectedAssignment(room) === null; }
function renderFloorControls(room) { const picker = $('floor-picker'); picker.replaceChildren(); for (const floorId of floors(room)) { const option = element('option'); option.value = floorId; option.textContent = floorId; picker.append(option); } picker.value = state.selectedFloorId || ''; $('zoom-label').textContent = `${Math.round(state.zoom * 100)}%`; $('zoom-in').disabled = state.zoom >= 1.5; $('zoom-out').disabled = state.zoom <= .75; }
function renderFloor(room) { const viewport = $('floor-viewport'); viewport.replaceChildren(); viewport.style.setProperty('--floor-zoom', String(state.zoom)); const map = element('div', 'floor-map'); map.setAttribute('aria-label', `${state.selectedFloorId} floor map`); const floorStations = room.stations.filter((station) => station.floorId === state.selectedFloorId); for (const station of floorStations) { const issue = activeIssueForStation(room, station.id); const position = mapPosition(room, station); const button = element('button', `station-marker${issue ? ' active' : ''}${station.id === state.selectedStationId ? ' selected' : ''}`); button.type = 'button'; button.style.left = `${position.left}%`; button.style.top = `${position.top}%`; button.dataset.stationId = station.id; button.setAttribute('aria-label', `${station.displayName}, ${stationStatus(room, station)}`); button.append(text(element('strong'), station.displayName), text(element('span'), issue ? `${issue.class} · ${issue.status}` : 'Healthy')); button.addEventListener('click', () => selectStation(station)); map.append(button); } for (const responder of room.responders.filter((candidate) => candidate.publicLocation.floorId === state.selectedFloorId && (candidate.dutyStatus !== 'OFF_SHIFT' || candidate.id === state.selectedResponderId))) { const position = mapPosition(room, responder.publicLocation); const marker = element('button', `person-marker${responder.id === state.selectedResponderId ? ' selected' : ''}`); marker.type = 'button'; marker.style.left = `${position.left}%`; marker.style.top = `${position.top}%`; marker.setAttribute('aria-label', `${responder.displayName}, ${responder.dutyStatus}`); marker.textContent = responder.displayName.slice(0, 1); marker.addEventListener('click', () => { state.selectedResponderId = responder.id; state.selectedFloorId = responder.publicLocation.floorId; render(); }); map.append(marker); } if (!floorStations.length) map.append(text(element('p', 'empty'), 'No public stations on this floor.')); viewport.append(map); }
function selectStation(station) { state.selectedStationId = station.id; state.selectedFloorId = station.floorId; state.selectedResponderId = null; state.lastRecommendation = null; render(); }
function renderTab(room) { for (const tab of ['stations', 'personnel']) { const button = $(`tab-${tab}`); const active = state.activeTab === tab; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); } const panel = $('floor-list'); panel.replaceChildren(); if (state.activeTab === 'stations') renderStationList(panel, room); else renderPersonnelList(panel, room); }
function renderStationList(panel, room) { const floorStations = room.stations.filter((station) => station.floorId === state.selectedFloorId); const active = floorStations.filter((station) => activeIssueForStation(room, station.id)); const healthy = floorStations.filter((station) => !activeIssueForStation(room, station.id)); panel.append(listHeading('Active stations', active.length), ...active.map((station) => stationListItem(room, station))); const details = element('details', 'collapsed-list'); details.append(text(element('summary'), `Healthy stations (${healthy.length})`), ...healthy.map((station) => stationListItem(room, station))); panel.append(details); }
function stationListItem(room, station) { const issue = activeIssueForStation(room, station.id); const button = element('button', `list-item${station.id === state.selectedStationId ? ' selected' : ''}`); button.type = 'button'; button.append(text(element('strong'), station.displayName), text(element('span'), issue ? `${issue.class} · ${issue.status}` : 'Healthy')); button.addEventListener('click', () => selectStation(station)); return button; }
function renderPersonnelList(panel, room) { const onDuty = room.responders.filter((person) => person.dutyStatus !== 'OFF_SHIFT'); const offShift = room.responders.filter((person) => person.dutyStatus === 'OFF_SHIFT'); panel.append(listHeading('On-duty personnel', onDuty.length), ...onDuty.map(personListItem)); const details = element('details', 'collapsed-list'); details.append(text(element('summary'), `Off-shift personnel (${offShift.length})`), ...offShift.map(personListItem)); panel.append(details); }
function personListItem(person) { const button = element('button', `list-item person${person.id === state.selectedResponderId ? ' selected' : ''}`); button.type = 'button'; button.append(text(element('strong'), person.displayName), text(element('span'), `${person.role} · ${person.dutyStatus}`)); button.addEventListener('click', () => { state.selectedResponderId = person.id; state.selectedFloorId = person.publicLocation.floorId; render(); }); return button; }
function listHeading(label, count) { return text(element('p', 'list-heading'), `${label} (${count})`); }
function renderStation(room) { const box = $('station-status'); box.replaceChildren(); const station = room.stations.find((candidate) => candidate.id === state.selectedStationId); if (!station) return box.append(text(element('p', 'empty'), 'Select a station.')); box.append(text(element('p', 'meta'), `${station.displayName} · ${station.floorId} · ${stationStatus(room, station)}`)); const issue = activeIssueForStation(room, station.id); if (!issue) return box.append(text(element('p', 'empty'), 'No active work at this station.')); box.append(text(element('p', 'issue-title'), `${issue.id} · ${issue.class}`), text(element('span', `priority ${issue.priority.band}`), `${issue.priority.band} · ${issue.priority.score}`), text(element('p', 'meta'), `Raised ${new Date(issue.raisedAt).toLocaleString()} · ${issue.status}`)); const pending = room.offers.find((offer) => offer.issueId === issue.id && offer.status === 'PENDING'); if (pending) renderOffer(box, room, pending); else if (issue.status === 'PENDING') box.append(text(element('p', 'meta'), 'Pending deterministic dispatch. Use “Offer next issue” to create an offer.')); else if (issue.status === 'ASSIGNED') { const assignment = room.assignments.find((candidate) => candidate.issueId === issue.id && candidate.status === 'ACTIVE'); const responder = room.responders.find((candidate) => candidate.id === assignment?.responderId); box.append(text(element('p', 'recommendation'), `Assigned to ${responder?.displayName || assignment?.responderId || 'unknown responder'}.`)); } if (state.lastRecommendation?.issueId === issue.id) renderRecommendation(box, state.lastRecommendation); }
function renderRecommendation(box, recommendation) { const wrap = element('div', 'recommendation'); wrap.append(text(element('strong'), 'Deterministic recommendation')); if (recommendation.meaningfulAlternativeId) wrap.append(text(element('p', 'meta'), `Alternative: ${recommendation.meaningfulAlternativeId}`)); const list = element('ol', 'candidate-list'); for (const candidate of recommendation.candidates) list.append(text(element('li'), `${candidate.displayName} · ${candidate.travelMinutes} min travel · ${candidate.evidenceStrength} evidence`)); wrap.append(list); box.append(wrap); }
function renderOffer(box, room, offer) { const responder = room.responders.find((candidate) => candidate.id === offer.responderId); const wrap = element('div', 'offer'); wrap.append(text(element('strong'), `Offer pending: ${responder?.displayName || offer.responderId}`), text(element('p', 'meta'), 'Assignment occurs only after acceptance.')); const actions = element('div', 'offer-actions'); actions.append(actionButton('Accept offer', () => mutate(`/offers/${encodeURIComponent(offer.id)}/accept`, {}), 'primary'), actionButton('Reject offer', () => mutate(`/offers/${encodeURIComponent(offer.id)}/reject`, {}), 'danger')); const available = room.responders.filter((candidate) => candidate.dutyStatus === 'AVAILABLE'); if (available.length) { const override = element('div', 'override'); const select = element('select'); for (const candidate of available) { const option = element('option'); option.value = candidate.id; option.textContent = `Override to ${candidate.displayName}`; select.append(option); } override.append(select, actionButton('Override', () => mutate(`/offers/${encodeURIComponent(offer.id)}/override`, { responderId: select.value }))); wrap.append(actions, override); } else wrap.append(actions); box.append(wrap); }
function actionButton(label, onClick, className = '') { const button = text(element('button', className), label); button.type = 'button'; button.disabled = state.busy; button.addEventListener('click', onClick); return button; }
function renderEvents(room) { const list = $('events'); list.replaceChildren(); for (const event of [...room.events].reverse().slice(0, 25)) { const item = element('li'); item.append(text(element('span', 'event-type'), event.type.replaceAll('_', ' ')), text(element('span', 'event-time'), new Date(event.occurredAt).toLocaleString())); list.append(item); } }
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
function statCard(title, primary, details) {
  const card = element('div', 'stat-card');
  card.append(text(element('p', 'eyebrow'), title), text(element('p', 'stat-primary'), primary));
  for (const d of details) card.append(text(element('p', 'stat-detail'), d));
  return card;
}
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
    for (const { station, count } of hotspots) { const tr = element('tr'); tr.append(text(element('td'), station?.displayName || '—'), text(element('td', 'meta'), station?.floorId || '—'), text(element('td', 'count'), String(count))); tbody.append(tr); }
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
      tr.append(text(element('td', 'mono'), issue.id), text(element('td'), issue.class.replace('_', ' ')), priCell, text(element('td', 'meta'), issue.status.replaceAll('_', ' ')), text(element('td', 'meta'), station?.displayName || issue.stationId), text(element('td', 'meta'), new Date(issue.raisedAt).toLocaleString()));
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
$('room-picker').addEventListener('change', (event) => loadRoom(event.target.value, true).catch((error) => setStatus(error.message, true))); $('floor-picker').addEventListener('change', (event) => { state.selectedFloorId = event.target.value; state.selectedResponderId = null; render(); }); $('offer-next').addEventListener('click', () => mutate('/offers', {})); $('tab-stations').addEventListener('click', () => { state.activeTab = 'stations'; render(); }); $('tab-personnel').addEventListener('click', () => { state.activeTab = 'personnel'; render(); }); $('zoom-in').addEventListener('click', () => { state.zoom = Math.min(1.5, Number((state.zoom + .25).toFixed(2))); render(); }); $('zoom-out').addEventListener('click', () => { state.zoom = Math.max(.75, Number((state.zoom - .25).toFixed(2))); render(); }); $('reset-focus').addEventListener('click', () => { const oldest = [...state.room.issues].filter((issue) => ACTIVE_ISSUE_STATUSES.has(issue.status)).sort(compareIssues)[0]; state.zoom = 1; state.selectedResponderId = null; if (oldest) { state.selectedStationId = oldest.stationId; state.selectedFloorId = state.room.stations.find((station) => station.id === oldest.stationId)?.floorId || state.selectedFloorId; } render(); }); loadRooms().catch((error) => setStatus(error instanceof Error ? error.message : 'Unable to load application.', true)); setInterval(() => { if (!state.busy && state.room) loadRoom(state.room.roomId).catch(() => undefined); }, 5000);
