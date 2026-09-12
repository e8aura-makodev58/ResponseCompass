const state = { rooms: [], room: null, selectedStationId: null, lastRecommendation: null, busy: false };
const $ = (id) => document.getElementById(id);
const status = $('status');

function setStatus(message, error = false) { status.textContent = message; status.classList.toggle('error', error); }
function text(element, value) { element.textContent = value; return element; }
function element(name, className) { const node = document.createElement(name); if (className) node.className = className; return node; }
function roomUrl(path = '') { return `/api/rooms/${encodeURIComponent(state.room.roomId)}${path}`; }

async function request(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'The action could not be completed.');
  return body;
}

async function loadRooms() {
  const body = await request('/api/rooms');
  state.rooms = body.rooms.filter((room) => room.health === 'READY');
  const picker = $('room-picker'); picker.replaceChildren();
  for (const room of state.rooms) { const option = element('option'); option.value = room.roomId; option.textContent = `${room.displayName} (${room.roomId})`; picker.append(option); }
  const requested = new URLSearchParams(location.hash.slice(1)).get('room');
  const remembered = localStorage.getItem('response-compass.room');
  const selected = state.rooms.find((room) => room.roomId === requested) || state.rooms.find((room) => room.roomId === remembered) || state.rooms[0];
  if (!selected) throw new Error('No ready Control Room is available.');
  picker.value = selected.roomId;
  await loadRoom(selected.roomId);
}

async function loadRoom(roomId) {
  setStatus('Loading room…');
  const body = await request(`/api/rooms/${encodeURIComponent(roomId)}`);
  state.room = body.room;
  const stationExists = state.room.stations.some((station) => station.id === state.selectedStationId);
  state.selectedStationId = stationExists ? state.selectedStationId : state.room.stations.find((station) => station.status === 'ISSUE_ACTIVE')?.id || state.room.stations[0]?.id || null;
  localStorage.setItem('response-compass.room', roomId);
  history.replaceState(null, '', `#room=${encodeURIComponent(roomId)}`);
  render(); setStatus(`${state.room.displayName} · revision ${state.room.revision}`);
}

function render() {
  const room = state.room; if (!room) return;
  const summary = $('room-summary'); summary.replaceChildren();
  for (const [label, value] of [['Room', room.displayName], ['Mode', room.mode], ['Clock', room.clockState], ['Revision', String(room.revision)]]) { const item = element('span'); item.append(text(element('strong'), `${label}: `), document.createTextNode(value)); summary.append(item); }
  renderFloor(room); renderStation(room); renderEvents(room);
  $('offer-next').disabled = state.busy || !room.issues.some((issue) => issue.status === 'PENDING');
}

function renderFloor(room) {
  const floor = $('floor'); floor.replaceChildren();
  for (const station of room.stations) {
    const issue = room.issues.find((candidate) => candidate.stationId === station.id && !['RESOLVED'].includes(candidate.status));
    const button = element('button', `station${issue ? ' active' : ''}${station.id === state.selectedStationId ? ' selected' : ''}`);
    button.type = 'button'; button.dataset.stationId = station.id;
    button.append(text(element('strong'), station.displayName), text(element('span', 'station-state'), issue ? `${issue.class} · ${issue.status}` : 'Normal'));
    button.addEventListener('click', () => { state.selectedStationId = station.id; state.lastRecommendation = null; render(); }); floor.append(button);
  }
}

function renderStation(room) {
  const box = $('station-status'); box.replaceChildren();
  const station = room.stations.find((candidate) => candidate.id === state.selectedStationId);
  if (!station) return box.append(text(element('p', 'empty'), 'Select a station.'));
  box.append(text(element('p', 'meta'), `${station.displayName} · ${station.floorId}`));
  const issue = room.issues.find((candidate) => candidate.stationId === station.id && candidate.status !== 'RESOLVED');
  if (!issue) return box.append(text(element('p', 'empty'), 'No active work at this station.'));
  box.append(text(element('p', 'issue-title'), `${issue.id} · ${issue.class}`));
  const priority = text(element('span', `priority ${issue.priority.band}`), `${issue.priority.band} · ${issue.priority.score}`); box.append(priority);
  box.append(text(element('p', 'meta'), `Raised ${new Date(issue.raisedAt).toLocaleString()} · ${issue.status}`));
  const pending = room.offers.find((offer) => offer.issueId === issue.id && offer.status === 'PENDING');
  if (pending) renderOffer(box, room, pending); else if (issue.status === 'PENDING') box.append(text(element('p', 'meta'), 'Pending deterministic dispatch. Use “Offer next issue” to create an offer.'));
  else if (issue.status === 'ASSIGNED') { const assignment = room.assignments.find((candidate) => candidate.issueId === issue.id && candidate.status === 'ACTIVE'); const responder = room.responders.find((candidate) => candidate.id === assignment?.responderId); box.append(text(element('p', 'recommendation'), `Assigned to ${responder?.displayName || assignment?.responderId || 'unknown responder'}.`)); }
  if (state.lastRecommendation?.issueId === issue.id) renderRecommendation(box, state.lastRecommendation);
}

function renderRecommendation(box, recommendation) {
  const wrap = element('div', 'recommendation'); wrap.append(text(element('strong'), 'Deterministic recommendation'));
  if (recommendation.meaningfulAlternativeId) wrap.append(text(element('p', 'meta'), `Alternative: ${recommendation.meaningfulAlternativeId}`));
  const list = element('ol', 'candidate-list');
  for (const candidate of recommendation.candidates) list.append(text(element('li'), `${candidate.displayName} · ${candidate.travelMinutes} min travel · ${candidate.evidenceStrength} evidence`));
  wrap.append(list); box.append(wrap);
}

function renderOffer(box, room, offer) {
  const responder = room.responders.find((candidate) => candidate.id === offer.responderId);
  const wrap = element('div', 'offer'); wrap.append(text(element('strong'), `Offer pending: ${responder?.displayName || offer.responderId}`));
  wrap.append(text(element('p', 'meta'), 'Assignment occurs only after acceptance.'));
  const actions = element('div', 'offer-actions');
  actions.append(actionButton('Accept offer', () => mutate(`/offers/${encodeURIComponent(offer.id)}/accept`, {}), 'primary'));
  actions.append(actionButton('Reject offer', () => mutate(`/offers/${encodeURIComponent(offer.id)}/reject`, {}), 'danger'));
  const available = room.responders.filter((candidate) => candidate.dutyStatus === 'AVAILABLE');
  if (available.length) { const override = element('div', 'override'); const select = element('select'); for (const candidate of available) { const option = element('option'); option.value = candidate.id; option.textContent = `Override to ${candidate.displayName}`; select.append(option); } override.append(select, actionButton('Override', () => mutate(`/offers/${encodeURIComponent(offer.id)}/override`, { responderId: select.value }))); wrap.append(actions, override); } else wrap.append(actions);
  box.append(wrap);
}

function actionButton(label, onClick, className = '') { const button = text(element('button', className), label); button.type = 'button'; button.disabled = state.busy; button.addEventListener('click', onClick); return button; }
function renderEvents(room) { const list = $('events'); list.replaceChildren(); for (const event of [...room.events].reverse().slice(0, 25)) { const item = element('li'); item.append(text(element('span', 'event-type'), event.type.replaceAll('_', ' ')), text(element('span', 'event-time'), new Date(event.occurredAt).toLocaleString())); list.append(item); } }

async function mutate(path, extra) {
  if (state.busy || !state.room) return; state.busy = true; render();
  try { const body = await request(roomUrl(path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: state.room.revision, ...extra }) }); state.room = body.room; state.lastRecommendation = body.recommendation || null; const focusIssueId = body.nextOffer?.issueId || body.offer?.issueId; const focusIssue = state.room.issues.find((issue) => issue.id === focusIssueId); if (focusIssue) state.selectedStationId = focusIssue.stationId; render(); setStatus(`Action applied · revision ${state.room.revision}`); }
  catch (error) { setStatus(error instanceof Error ? error.message : 'Action failed.', true); await loadRoom(state.room.roomId); }
  finally { state.busy = false; render(); }
}

$('room-picker').addEventListener('change', (event) => { state.selectedStationId = null; state.lastRecommendation = null; loadRoom(event.target.value).catch((error) => setStatus(error.message, true)); });
$('offer-next').addEventListener('click', () => mutate('/offers', {}));
loadRooms().catch((error) => setStatus(error instanceof Error ? error.message : 'Unable to load application.', true));
setInterval(() => { if (!state.busy && state.room) loadRoom(state.room.roomId).catch(() => undefined); }, 5000);
