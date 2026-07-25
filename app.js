/* ===========================================================
   Medidor de Terrenos GPS - app.js
   Funcionalidad: puntos arrastrables, undo/redo, borrador auto,
   medición de distancia, exportar/importar, capas, fotos/notas,
   geocodificación.
   =========================================================== */

let map, userMarker, accuracyCircle, polygonLayer, polylineLayer;
let currentMode = 'manual';
let isWalking = false;
let currentLatLng = null;
let coordinates = [];
let pathMarkers = [];
let currentEditingId = null;
let areaUnit = 'm2';
let perimeterUnit = 'm';

let undoStack = [];
let redoStack = [];
let measureCoords = [];
let measureLayer = null;
let measureMarkers = [];
let overlayLayers = {};
let overlayOn = {};

const MAX_ACCURACY_THRESHOLD = 15;
const STORAGE_KEY = 'gps_terrain_measurements';
const DRAFT_KEY = 'gps_terrain_draft';

const vertexIcon = L.divIcon({ className: 'vertex-marker', iconSize: [16, 16], iconAnchor: [8, 8] });
const LAYER_COLORS = ['#007aff', '#ff9500', '#34c759', '#ff3b30', '#5856d6', '#ff2d55', '#1a1a1a', '#00c7be'];

/* ---------------- Mapa / GPS ---------------- */

function initMap() {
  map = L.map('map', { zoomControl: false }).setView([4.6097, -74.0817], 16);

  const esriSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri' });
  const esriTopo = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri' });
  const openStreetMap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });

  esriSatellite.addTo(map);

  L.control.layers({
    "Satelital (Relieve Real)": esriSatellite,
    "Topográfico": esriTopo,
    "Callejero": openStreetMap
  }, null, { position: 'topright' }).addTo(map);

  map.on('click', (e) => {
    if (currentMode === 'manual') addPoint([e.latlng.lng, e.latlng.lat]);
    else if (currentMode === 'measure') addMeasurePoint([e.latlng.lng, e.latlng.lat]);
  });

  startGpsMonitor();
}

function startGpsMonitor() {
  if (!navigator.geolocation) return;

  navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      currentLatLng = [latitude, longitude];
      document.getElementById('accuracyValue').textContent = `${Math.round(accuracy)} m`;

      if (!userMarker) {
        userMarker = L.marker(currentLatLng).addTo(map);
        accuracyCircle = L.circle(currentLatLng, { radius: accuracy, color: '#007aff', opacity: 0.3, fillColor: '#007aff', fillOpacity: 0.1 }).addTo(map);
        map.setView(currentLatLng, 18);
      } else {
        userMarker.setLatLng(currentLatLng);
        accuracyCircle.setLatLng(currentLatLng);
        accuracyCircle.setRadius(accuracy);
      }

      if (currentMode === 'walk' && isWalking && accuracy <= MAX_ACCURACY_THRESHOLD) {
        addPoint([longitude, latitude]);
      }
    },
    (err) => console.warn(`Error GPS (${err.code}): ${err.message}`),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

/* ---------------- Modos ---------------- */

function switchMode(mode) {
  if (isWalking) stopWalkTracking();
  currentMode = mode;
  document.getElementById('modeManualBtn').classList.toggle('active', mode === 'manual');
  document.getElementById('modeWalkBtn').classList.toggle('active', mode === 'walk');
  document.getElementById('modeMeasureBtn').classList.toggle('active', mode === 'measure');

  document.getElementById('addPointBtn').style.display = mode === 'manual' ? 'block' : 'none';
  document.getElementById('toggleWalkBtn').style.display = mode === 'walk' ? 'block' : 'none';
  document.getElementById('clearMeasureBtn').style.display = mode === 'measure' ? 'block' : 'none';

  const badge = document.getElementById('statusBadge');
  if (mode === 'manual') {
    badge.textContent = "Modo Puntos";
    badge.className = "badge badge-off";
  } else if (mode === 'walk') {
    badge.textContent = "Listo para caminar";
    badge.className = "badge badge-off";
  } else {
    badge.textContent = "Midiendo distancia";
    badge.className = "badge badge-measure";
  }

  if (mode !== 'measure') clearMeasure();
}

function addCurrentGpsPoint() {
  if (!currentLatLng) { alert("Buscando GPS..."); return; }
  addPoint([currentLatLng[1], currentLatLng[0]]);
}

/* ---------------- Puntos / Vértices ---------------- */

function addVertexMarker(latlng) {
  const marker = L.marker(latlng, { draggable: true, icon: vertexIcon });
  marker.addTo(map);
  marker.on('dragend', () => {
    const idx = pathMarkers.indexOf(marker);
    if (idx === -1) return;
    pushUndo();
    const ll = marker.getLatLng();
    coordinates[idx] = [ll.lng, ll.lat];
    updateMetricsAndMap();
    saveDraft();
    refreshButtons();
    vibrate(15);
  });
  pathMarkers.push(marker);
  return marker;
}

function rebuildMarkers() {
  pathMarkers.forEach(m => map.removeLayer(m));
  pathMarkers = [];
  coordinates.forEach(c => addVertexMarker([c[1], c[0]]));
}

function addPoint(pointLngLat) {
  const lastPoint = coordinates[coordinates.length - 1];
  if (lastPoint && lastPoint[0] === pointLngLat[0] && lastPoint[1] === pointLngLat[1]) return;

  pushUndo();
  coordinates.push(pointLngLat);
  addVertexMarker([pointLngLat[1], pointLngLat[0]]);
  updateMetricsAndMap();
  saveDraft();
  refreshButtons();
  vibrate(15);
}

function setCoordinates(coords, fit) {
  pushUndo();
  coordinates = coords.map(c => [...c]);
  rebuildMarkers();
  updateMetricsAndMap();
  if (fit) {
    const lc = coordinates.map(c => [c[1], c[0]]);
    if (lc.length) map.fitBounds(L.latLngBounds(lc), { padding: [50, 50] });
  }
  saveDraft();
  refreshButtons();
}

function clearWorkingState() {
  if (polygonLayer) map.removeLayer(polygonLayer);
  if (polylineLayer) map.removeLayer(polylineLayer);
  if (isWalking) stopWalkTracking();
  pathMarkers.forEach(m => map.removeLayer(m));
  pathMarkers = [];
  coordinates = [];
  currentEditingId = null;
}

/* ---------------- Caminar ---------------- */

function toggleWalkTracking() {
  if (isWalking) {
    stopWalkTracking();
  } else {
    isWalking = true;
    document.getElementById('toggleWalkBtn').textContent = "Pausar Rastreo";
    document.getElementById('toggleWalkBtn').className = "action-btn btn-danger";
    document.getElementById('statusBadge').textContent = "Trazando...";
    document.getElementById('statusBadge').className = "badge badge-on";
  }
}

function stopWalkTracking() {
  isWalking = false;
  document.getElementById('toggleWalkBtn').textContent = "Reanudar Rastreo";
  document.getElementById('toggleWalkBtn').className = "action-btn btn-primary";
  document.getElementById('statusBadge').textContent = "Pausado";
  document.getElementById('statusBadge').className = "badge badge-off";
}

/* ---------------- Undo / Redo ---------------- */

function snapshot() { return coordinates.map(c => [...c]); }

function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > 200) undoStack.shift();
  redoStack = [];
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  coordinates = undoStack.pop();
  rebuildMarkers();
  updateMetricsAndMap();
  saveDraft();
  refreshButtons();
  vibrate(10);
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  coordinates = redoStack.pop();
  rebuildMarkers();
  updateMetricsAndMap();
  saveDraft();
  refreshButtons();
  vibrate(10);
}

function refreshButtons() {
  document.getElementById('undoBtn').disabled = undoStack.length === 0;
  document.getElementById('redoBtn').disabled = redoStack.length === 0;
  document.getElementById('saveBtn').disabled = coordinates.length < 3;
  document.getElementById('shareBtn').disabled = coordinates.length < 3;
  document.getElementById('exportBtn').disabled = coordinates.length < 2;
  document.getElementById('resetBtn').disabled = coordinates.length === 0;
}

/* ---------------- Medir distancia ---------------- */

function addMeasurePoint(pointLngLat) {
  measureCoords.push(pointLngLat);
  const marker = L.circleMarker([pointLngLat[1], pointLngLat[0]], { radius: 4, color: '#084298', fillColor: '#cfe2ff', fillOpacity: 1 }).addTo(map);
  measureMarkers.push(marker);
  updateMeasureDisplay();
}

function updateMeasureDisplay() {
  if (measureLayer) map.removeLayer(measureLayer);
  if (measureCoords.length < 2) {
    if (measureCoords.length === 1) document.getElementById('statusBadge').textContent = "Midiendo: 1 punto";
    return;
  }
  const lc = measureCoords.map(c => [c[1], c[0]]);
  measureLayer = L.polyline(lc, { color: '#084298', weight: 3 }).addTo(map);
  const dist = turf.length(turf.lineString(measureCoords), { units: 'meters' });
  const txt = dist >= 1000 ? `${(dist / 1000).toFixed(3)} km` : `${dist.toFixed(1)} m`;
  document.getElementById('statusBadge').textContent = `Midiendo: ${txt}`;
}

function clearMeasure() {
  measureCoords = [];
  if (measureLayer) map.removeLayer(measureLayer);
  measureMarkers.forEach(m => map.removeLayer(m));
  measureMarkers = [];
  measureLayer = null;
  if (currentMode === 'measure') {
    document.getElementById('statusBadge').textContent = "Midiendo distancia";
    document.getElementById('statusBadge').className = "badge badge-measure";
  }
}

/* ---------------- Métricas ---------------- */

function formatArea(m2) {
  return areaUnit === 'ha' ? `${(m2 / 10000).toFixed(3)} ha` : `${m2.toFixed(1)} m²`;
}

function formatPerimeter(m) {
  return perimeterUnit === 'km' ? `${(m / 1000).toFixed(3)} km` : `${m.toFixed(1)} m`;
}

function toggleAreaUnit() {
  areaUnit = areaUnit === 'm2' ? 'ha' : 'm2';
  document.getElementById('areaUnitBtn').textContent = areaUnit === 'ha' ? 'ha' : 'm²';
  renderMetrics();
}

function togglePerimeterUnit() {
  perimeterUnit = perimeterUnit === 'm' ? 'km' : 'm';
  document.getElementById('perimeterUnitBtn').textContent = perimeterUnit === 'km' ? 'km' : 'm';
  renderMetrics();
}

function renderMetrics() {
  const len = coordinates.length;
  const areaEl = document.getElementById('areaValue');
  const periEl = document.getElementById('perimeterValue');

  if (len < 2) {
    areaEl.textContent = formatArea(0);
    periEl.textContent = formatPerimeter(0);
    return;
  }
  if (len === 2) {
    const line = turf.lineString(coordinates);
    areaEl.textContent = formatArea(0);
    periEl.textContent = formatPerimeter(turf.length(line, { units: 'meters' }));
    return;
  }
  const closedCoords = [...coordinates, coordinates[0]];
  const turfPoly = turf.polygon([closedCoords]);
  areaEl.textContent = formatArea(turf.area(turfPoly));
  periEl.textContent = formatPerimeter(turf.length(turfPoly, { units: 'meters' }));
}

function updateMetricsAndMap() {
  if (polylineLayer) map.removeLayer(polylineLayer);
  if (polygonLayer) map.removeLayer(polygonLayer);

  if (coordinates.length < 2) {
    renderMetrics();
    return;
  }

  const leafletCoords = coordinates.map(c => [c[1], c[0]]);

  if (coordinates.length === 2) {
    polylineLayer = L.polyline(leafletCoords, { color: '#007aff', weight: 3, dashArray: '5, 5' }).addTo(map);
    renderMetrics();
    return;
  }

  if (coordinates.length >= 3) {
    polygonLayer = L.polygon(leafletCoords, { color: '#28a745', fillColor: '#28a745', fillOpacity: 0.35, weight: 2 }).addTo(map);
    renderMetrics();
  }
}

/* ---------------- Borrador automático ---------------- */

function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(coordinates)); } catch (e) {}
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
}

function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (d && Array.isArray(d) && d.length >= 1 && d.length <= 5000) {
      setCoordinates(d, false);
    }
  } catch (e) {}
}

/* ---------------- Reset ---------------- */

function resetMeasurement() {
  pushUndo();
  if (isWalking) stopWalkTracking();
  if (polygonLayer) map.removeLayer(polygonLayer);
  if (polylineLayer) map.removeLayer(polylineLayer);
  pathMarkers.forEach(m => map.removeLayer(m));
  pathMarkers = [];
  coordinates = [];
  currentEditingId = null;
  document.getElementById('areaValue').textContent = formatArea(0);
  document.getElementById('perimeterValue').textContent = formatPerimeter(0);
  document.getElementById('toggleWalkBtn').textContent = "Iniciar Rastreo";
  document.getElementById('toggleWalkBtn').className = "action-btn btn-primary";
  clearDraft();
  refreshButtons();
}

/* ---------------- Guardar (con notas y fotos) ---------------- */

function openSaveModal() {
  if (coordinates.length < 3) return;
  const modal = document.getElementById('saveModal');
  const modalTitle = document.getElementById('saveModalTitle');
  const modalDesc = document.getElementById('saveModalDesc');
  const nameInput = document.getElementById('terrainNameInput');
  const notesInput = document.getElementById('terrainNotesInput');
  const photosInput = document.getElementById('terrainPhotosInput');

  photosInput.value = '';
  notesInput.value = '';

  if (currentEditingId !== null) {
    const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const item = savedData.find(d => d.id === currentEditingId);
    modalTitle.textContent = 'Actualizar Terreno';
    modalDesc.textContent = 'Vas a sobrescribir la medición que tienes abierta con los cambios actuales:';
    nameInput.value = item ? item.name : '';
    notesInput.value = item && item.notes ? item.notes : '';
  } else {
    modalTitle.textContent = 'Guardar Terreno';
    modalDesc.textContent = 'Asigna un nombre o código de lote para identificar esta medición:';
    nameInput.value = '';
  }
  modal.style.display = 'flex';
}

function closeModal(modalId) {
  document.getElementById(modalId).style.display = 'none';
}

function toggleControlPanel() {
  const panel = document.getElementById('controlPanel');
  const showBtn = document.getElementById('showPanelBtn');
  const collapsed = panel.classList.toggle('collapsed');
  showBtn.style.display = collapsed ? 'flex' : 'none';
}

async function confirmSaveMeasurement() {
  const nameInput = document.getElementById('terrainNameInput');
  const name = nameInput.value.trim() || `Terreno #${Date.now().toString().slice(-4)}`;
  const notes = document.getElementById('terrainNotesInput').value.trim();
  const photosInput = document.getElementById('terrainPhotosInput');

  const closedCoords = [...coordinates, coordinates[0]];
  const turfPoly = turf.polygon([closedCoords]);

  let savedData = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  const photos = await filesToBase64(photosInput.files);

  if (currentEditingId !== null) {
    const idx = savedData.findIndex(d => d.id === currentEditingId);
    if (idx !== -1) {
      const rec = savedData[idx];
      rec.name = name;
      rec.notes = notes;
      rec.coordinates = coordinates.map(c => [...c]);
      rec.areaM2 = turf.area(turfPoly);
      rec.perimeterMeters = turf.length(turfPoly, { units: 'meters' });
      if (photos.length) {
        rec.photoCount = photos.length;
        try { await dbSet(rec.id, photos); } catch (e) { console.warn('No se pudieron guardar las fotos', e); }
      }
      savedData[idx] = rec;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(savedData));
      closeModal('saveModal');
      alert(`"${name}" actualizado exitosamente.`);
      return;
    }
  }

  const id = Date.now();
  const record = {
    id: id,
    name: name,
    date: new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }),
    coordinates: coordinates.map(c => [...c]),
    areaM2: turf.area(turfPoly),
    perimeterMeters: turf.length(turfPoly, { units: 'meters' }),
    notes: notes,
    photoCount: photos.length
  };

  currentEditingId = id;
  savedData.unshift(record);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(savedData));
  if (photos.length) { try { await dbSet(id, photos); } catch (e) { console.warn('No se pudieron guardar las fotos', e); } }

  closeModal('saveModal');
  alert(`"${name}" guardado exitosamente.`);
}

async function filesToBase64(fileList) {
  const arr = [];
  for (const f of fileList) {
    arr.push(await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(f);
    }));
  }
  return arr;
}

/* ---------------- Historial / Capas / Detalles ---------------- */

function openHistoryModal() {
  const listContainer = document.getElementById('savedList');
  const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');

  if (savedData.length === 0) {
    listContainer.innerHTML = '<p style="text-align:center; color:#8e8e93; font-size:0.9rem; padding: 20px;">No tienes mediciones guardadas aún.</p>';
  } else {
    listContainer.innerHTML = savedData.map((item, i) => {
      const areaDisplay = item.areaM2 >= 10000
        ? `${(item.areaM2 / 10000).toFixed(2)} ha`
        : `${item.areaM2.toFixed(1)} m²`;
      const photoBadge = item.photoCount ? ' 📷' : '';
      const layerOn = !!overlayOn[item.id];
      const color = LAYER_COLORS[i % LAYER_COLORS.length];

      return `
        <div class="saved-item">
          <div class="saved-info">
            <h4>${item.name}${photoBadge}</h4>
            <p>📅 ${item.date} | 📐 <strong>${areaDisplay}</strong> (${item.perimeterMeters.toFixed(1)} m)</p>
          </div>
          <div class="saved-actions">
            <button class="btn-sm btn-primary" onclick="loadSavedMeasurement(${item.id})">Ver</button>
            <button class="btn-sm btn-secondary" onclick="toggleLayer(${item.id}, this, '${color}')">${layerOn ? 'Ocultar' : 'Mapa'}</button>
            <button class="btn-sm btn-purple" onclick="openDetailModal(${item.id})">Detalle</button>
            <button class="btn-sm btn-success" onclick="shareSavedMeasurement(${item.id})">Compartir</button>
            <button class="btn-sm btn-danger" onclick="deleteSavedMeasurement(${item.id})">✕</button>
          </div>
        </div>
      `;
    }).join('');
  }

  document.getElementById('historyModal').style.display = 'flex';
}

function loadSavedMeasurement(id) {
  const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  const item = savedData.find(d => d.id === id);
  if (!item) return;

  clearWorkingState();
  currentEditingId = id;
  setCoordinates(item.coordinates, true);
  closeModal('historyModal');
}

function toggleLayer(id, btn, color) {
  if (overlayOn[id]) {
    map.removeLayer(overlayLayers[id]);
    delete overlayOn[id];
    btn.textContent = 'Mapa';
  } else {
    const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const item = savedData.find(d => d.id === id);
    if (!item) return;
    const lc = item.coordinates.map(c => [c[1], c[0]]);
    overlayLayers[id] = L.polygon(lc, { color: color, weight: 2, fillColor: color, fillOpacity: 0.12 }).addTo(map);
    overlayOn[id] = true;
    btn.textContent = 'Ocultar';
  }
}

async function openDetailModal(id) {
  const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  const item = savedData.find(d => d.id === id);
  if (!item) return;

  document.getElementById('detailTitle').textContent = item.name;
  const areaDisplay = item.areaM2 >= 10000 ? `${(item.areaM2 / 10000).toFixed(2)} ha` : `${item.areaM2.toFixed(1)} m²`;
  document.getElementById('detailMeta').textContent = `📅 ${item.date} | 📐 ${areaDisplay} (${item.perimeterMeters.toFixed(1)} m)`;
  document.getElementById('detailNotes').textContent = item.notes ? `📝 ${item.notes}` : 'Sin notas.';

  const photosEl = document.getElementById('detailPhotos');
  photosEl.innerHTML = 'Cargando fotos...';
  let photos = [];
  try { photos = await dbGet(id); } catch (e) { photos = []; }
  photosEl.innerHTML = photos.length
    ? photos.map(p => `<img src="${p}" alt="foto">`).join('')
    : '<p class="modal-note">Sin fotos.</p>';

  document.getElementById('detailModal').style.display = 'flex';
}

function deleteSavedMeasurement(id) {
  if (!confirm("¿Seguro que deseas eliminar esta medición?")) return;
  let savedData = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  savedData = savedData.filter(d => d.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(savedData));
  if (overlayOn[id]) { map.removeLayer(overlayLayers[id]); delete overlayOn[id]; }
  dbDelete(id);
  openHistoryModal();
}

/* ---------------- Compartir por URL ---------------- */

function encodeMeasurement(name, coords) {
  const payload = {
    n: name || '',
    c: coords.map(c => [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6])
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

function decodeMeasurement(str) {
  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(str))));
    if (!data || !Array.isArray(data.c)) return null;
    return data;
  } catch (e) { return null; }
}

function buildShareLink(name, coords) {
  return location.href.split('#')[0] + '#m=' + encodeMeasurement(name, coords);
}

function buildShareMessage(link) {
  return `Te comparto esta medición de terreno hecha con el Medidor GPS: ${link}`;
}

function openShareModal() {
  if (coordinates.length < 3) { alert("Marca al menos 3 puntos para compartir."); return; }
  let name = '';
  if (currentEditingId !== null) {
    const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const item = savedData.find(d => d.id === currentEditingId);
    if (item) name = item.name;
  }
  document.getElementById('shareLinkInput').value = buildShareLink(name, coordinates);
  document.getElementById('shareModal').style.display = 'flex';
}

function copyShareLink() {
  const input = document.getElementById('shareLinkInput');
  input.select();
  const text = input.value;
  const done = () => alert("Enlace copiado al portapapeles.");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => { document.execCommand('copy'); done(); });
  } else { document.execCommand('copy'); done(); }
}

function shareVia(channel) {
  const link = document.getElementById('shareLinkInput').value;
  if (channel === 'whatsapp') {
    window.open('https://wa.me/?text=' + encodeURIComponent(buildShareMessage(link)), '_blank');
  } else {
    if (navigator.share) {
      navigator.share({ title: 'Medición de Terreno GPS', text: 'Te comparto esta medición de terreno', url: link }).catch(() => {});
    } else {
      window.open(link, '_blank');
    }
  }
}

function shareSavedMeasurement(id) {
  const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  const item = savedData.find(d => d.id === id);
  if (!item) return;
  const link = buildShareLink(item.name, item.coordinates);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(() => alert(`Enlace de "${item.name}" copiado.`)).catch(() => fallbackCopy(link, item.name));
  } else { fallbackCopy(link, item.name); }
}

function fallbackCopy(text, name) {
  const input = document.createElement('input');
  input.value = text;
  document.body.appendChild(input);
  input.select();
  document.execCommand('copy');
  document.body.removeChild(input);
  alert(`Enlace de "${name || 'medición'}" copiado.`);
}

/* ---------------- Exportar / Importar ---------------- */

function openExportModal() {
  if (coordinates.length < 2) { alert("Marca al menos 2 puntos para exportar."); return; }
  document.getElementById('exportModal').style.display = 'flex';
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportMeasurement(format) {
  const name = (currentEditingId !== null)
    ? (JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]').find(d => d.id === currentEditingId) || {}).name || 'terreno'
    : 'terreno';
  const safeName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'terreno';
  const coords = [...coordinates, coordinates[0]];

  if (format === 'geojson') {
    const geom = coordinates.length >= 3
      ? { type: 'Polygon', coordinates: [coords] }
      : { type: 'LineString', coordinates: coordinates };
    const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: name }, geometry: geom }] };
    downloadFile(`${safeName}.geojson`, JSON.stringify(fc, null, 2), 'application/json');
  } else if (format === 'kml') {
    const kmlCoords = coords.map(c => `${c[0]},${c[1]},0`).join(' ');
    const body = coordinates.length >= 3
      ? `<Polygon><outerBoundaryIs><LinearRing><coordinates>${kmlCoords}</coordinates></LinearRing></outerBoundaryIs></Polygon>`
      : `<LineString><coordinates>${kmlCoords}</coordinates></LineString>`;
    const kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>${name}</name>${body}</Placemark></Document></kml>`;
    downloadFile(`${safeName}.kml`, kml, 'application/vnd.google-earth.kml+xml');
  } else if (format === 'gpx') {
    const pts = coordinates.map(c => `      <rtept lat="${c[1]}" lon="${c[0]}"></rtept>`).join('\n');
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="MedidorGPS" xmlns="http://www.topografix.com/GPX/1/1"><rte><name>${name}</name>\n${pts}\n  </rte></gpx>`;
    downloadFile(`${safeName}.gpx`, gpx, 'application/gpx+xml');
  } else if (format === 'csv') {
    const csv = 'lat,lng\n' + coordinates.map(c => `${c[1]},${c[0]}`).join('\n');
    downloadFile(`${safeName}.csv`, csv, 'text/csv');
  }
  closeModal('exportModal');
}

function importMeasurement() {
  const input = document.getElementById('importFileInput');
  const file = input.files[0];
  if (!file) { alert("Selecciona un archivo KML o CSV."); return; }

  const reader = new FileReader();
  reader.onload = () => {
    let parsed = null;
    try {
      if (file.name.toLowerCase().endsWith('.kml')) {
        parsed = parseKML(reader.result);
      } else if (file.name.toLowerCase().endsWith('.csv')) {
        parsed = parseCSV(reader.result);
      } else {
        const txt = reader.result;
        if (txt.trim().startsWith('<')) parsed = parseKML(txt); else parsed = parseCSV(txt);
      }
    } catch (e) { alert("No se pudo leer el archivo."); return; }

    if (!parsed || parsed.length < 2) { alert("El archivo no contiene puntos válidos."); return; }
    clearWorkingState();
    currentEditingId = null;
    setCoordinates(parsed, true);
    input.value = '';
    closeModal('exportModal');
    alert("Archivo importado al mapa.");
  };
  reader.readAsText(file);
}

function parseKML(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const coordEls = doc.getElementsByTagName('coordinates');
  if (!coordEls.length) throw new Error('no coords');
  const raw = coordEls[0].textContent.trim().replace(/\s+/g, ' ').split(' ');
  return raw.map(t => {
    const [lng, lat] = t.split(',');
    return [parseFloat(lng), parseFloat(lat)];
  }).filter(c => !isNaN(c[0]) && !isNaN(c[1]));
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  return lines.map(line => {
    const parts = line.split(/[,;\t]/).map(Number);
    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
    return [parts[1], parts[0]]; // asumimos lat,lng
  }).filter(Boolean);
}

/* ---------------- Geocodificación (Nominatim) ---------------- */

function searchAddress() {
  const q = document.getElementById('searchInput').value.trim();
  if (!q) return;
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
  fetch(url, { headers: { 'Accept': 'application/json' } })
    .then(r => r.json())
    .then(data => {
      if (data && data.length) {
        map.setView([parseFloat(data[0].lat), parseFloat(data[0].lon)], 18);
      } else {
        alert("No se encontró la dirección.");
      }
    })
    .catch(() => alert("Error de red al buscar."));
}

/* ---------------- IndexedDB (fotos) ---------------- */

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('terrainPhotosDB', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('photos');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function dbSet(id, photos) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').put(photos, id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

async function dbGet(id) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('photos', 'readonly');
    const rq = tx.objectStore('photos').get(id);
    rq.onsuccess = () => res(rq.result || []);
    rq.onerror = () => rej(rq.error);
  });
}

async function dbDelete(id) {
  const db = await openDB();
  return new Promise((res) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').delete(id);
    tx.oncomplete = () => res();
  });
}

/* ---------------- Utilidades ---------------- */

function vibrate(ms) {
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
}

/* ---------------- Carga desde URL compartida ---------------- */

function loadFromSharedUrl() {
  if (location.hash.indexOf('#m=') !== 0) return false;
  const data = decodeMeasurement(location.hash.substring(3));
  if (!data || data.c.length < 3) return false;

  clearWorkingState();
  currentEditingId = null;
  setCoordinates(data.c, true);

  if (history.replaceState) {
    history.replaceState(null, '', location.pathname + location.search);
  } else {
    location.hash = '';
  }
  return true;
}

/* ---------------- Inicio ---------------- */

function initApp() {
  initMap();
  if (!loadFromSharedUrl()) {
    loadDraft();
  }
}

window.onload = initApp;
