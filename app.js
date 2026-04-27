/**
 * ============================================================
 *  PREMIATTA ROUTE MAP — app.js
 *  Sistema de roteirização premium com múltiplas paradas
 * ============================================================
 *
 *  CONFIGURAÇÃO DA API KEY:
 *  ┌──────────────────────────────────────────────────────────┐
 *  │  1. Acesse: https://console.cloud.google.com            │
 *  │  2. Crie/selecione um projeto                           │
 *  │  3. Ative as APIs:                                      │
 *  │     • Maps JavaScript API                               │
 *  │     • Places API                                        │
 *  │     • Directions API                                    │
 *  │  4. Gere uma API Key em "Credenciais"                   │
 *  │  5. Substitua "SUA_CHAVE_AQUI" abaixo                  │
 *  └──────────────────────────────────────────────────────────┘
 */

/* ── ① CHAVE DA API ─────────────────────────────────────────── */
const GOOGLE_MAPS_API_KEY = "AIzaSyCH1C6BQ9nCRN2dAYwAPa7B4NdoA42egEU"; // ← INSIRA SUA CHAVE AQUI

/* ── ② ESTADO GLOBAL ────────────────────────────────────────── */
let map                = null;   // instância do mapa
let directionsService  = null;   // serviço de rotas
let directionsRenderer = null;   // renderizador da rota principal
let altRenderers       = [];     // renderizadores das rotas alternativas
let autocompletes      = {};     // instâncias de autocomplete {id: Autocomplete}
let stopCounter        = 0;      // contador de paradas
let routeResult        = null;   // resultado da última rota calculada
let selectedAltIndex   = 0;      // índice da rota alternativa selecionada
const travelMode       = "DRIVING"; // sempre caminhão (DRIVING)

/* ── ③ CARREGAR API DO GOOGLE MAPS DINAMICAMENTE ────────────── */
(function loadGoogleMapsAPI() {
  if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY === "SUA_CHAVE_AQUI") {
    console.warn("⚠️  API Key não configurada. Defina GOOGLE_MAPS_API_KEY em app.js.");
    return; // sem chave: mantém placeholder visual
  }

  // Remove aviso de API key
  const notice = document.getElementById("apiKeyNotice");
  if (notice) notice.remove();

  const script = document.createElement("script");
  script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places,geometry&callback=initMap&language=pt-BR&region=BR`;
  script.async = true;
  script.defer = true;
  script.onerror = () => showToast("Falha ao carregar Google Maps. Verifique a API Key.", "error");
  document.head.appendChild(script);
})();

/* ── ④ CALLBACK DE INICIALIZAÇÃO DO MAPA ────────────────────── */
window.initMap = function () {
  // Esconde placeholder
  const ph = document.getElementById("mapPlaceholder");
  if (ph) ph.style.display = "none";

  // Cria mapa centralizado no Brasil
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: -15.7801, lng: -47.9292 }, // Brasília como padrão
    zoom: 5,
    mapTypeId: "roadmap",
    styles: darkMapStyles(),   // tema escuro personalizado
    disableDefaultUI: false,
    zoomControl: true,
    streetViewControl: false,
    mapTypeControl: false,
    fullscreenControl: true,
    gestureHandling: "greedy",
  });

  // Serviço e renderizador de rotas
  directionsService  = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    map,
    suppressMarkers: true,          // usaremos marcadores customizados
    polylineOptions: {
      strokeColor: "#F5B400",
      strokeWeight: 5,
      strokeOpacity: 0.9,
    },
  });

  // Inicializa autocompletes dos campos fixos
  initAutocomplete("originInput");
  initAutocomplete("destInput");

  showToast("Mapa carregado com sucesso!", "success");
};

/* ── ⑤ INICIALIZAR AUTOCOMPLETE ─────────────────────────────── */
function initAutocomplete(inputId) {
  if (!google || !google.maps || !google.maps.places) return;
  const input = document.getElementById(inputId);
  if (!input || autocompletes[inputId]) return;

  const ac = new google.maps.places.Autocomplete(input, {
    types: ["geocode", "establishment"],
    fields: ["formatted_address", "geometry", "name"],
  });

  ac.addListener("place_changed", () => {
    const place = ac.getPlace();
    if (!place.geometry) {
      showToast("Endereço não encontrado. Tente novamente.", "error");
      input.classList.add("error");
      return;
    }
    input.classList.remove("error");
    // Mostra botão de limpar
    const clearBtn = input.parentElement.querySelector(".clear-field-btn");
    if (clearBtn) clearBtn.classList.remove("hidden");
  });

  autocompletes[inputId] = ac;
}

/* ── ⑥ CALCULAR ROTA ─────────────────────────────────────────── */
let returnRouteResult = null;

function calculateRoute() {
  if (!map || !directionsService) {
    showToast("O mapa ainda não foi carregado. Configure a API Key.", "error");
    return;
  }

  const origin = document.getElementById("originInput").value.trim();
  const dest   = document.getElementById("destInput").value.trim();

  if (!origin) { highlight("originInput"); showToast("Informe o local de partida.", "error"); return; }
  if (!dest)   { highlight("destInput");   showToast("Informe o local de retorno.", "error"); return; }

  const stopInputs = document.querySelectorAll(".stop-address-input");
  const waypoints  = [];
  let hasEmptyStop = false;
  stopInputs.forEach(inp => {
    const val = inp.value.trim();
    if (!val) { hasEmptyStop = true; return; }
    waypoints.push({ location: val, stopover: true });
  });
  if (hasEmptyStop) { showToast("Existem paradas sem endereço. Preencha ou remova-as.", "error"); return; }

  const optimize = document.getElementById("optimizeToggle").checked;
  showLoading(true);

  // ── Rota 1: Entrega completa (origem → todas as paradas)
  // Destino da entrega = última parada (se existir) ou o próprio destino de retorno
  const deliveryEndpoint = waypoints.length > 0
    ? waypoints[waypoints.length - 1].location
    : dest;

  const deliveryWaypoints = waypoints.length > 1 ? waypoints.slice(0, -1) : [];

  // Opções de caminhão: hora de partida agora para calcular tráfego real
  const truckOptions = {
    travelMode: google.maps.TravelMode.DRIVING,
    drivingOptions: {
      departureTime: new Date(),          // hora atual → tráfego em tempo real
      trafficModel: google.maps.TrafficModel.BEST_GUESS,
    },
    avoidHighways: false,
    avoidTolls:    false,
    avoidFerries:  false,
    unitSystem: google.maps.UnitSystem.METRIC,
    region: "BR",
  };

  const req1 = {
    origin,
    destination: deliveryEndpoint,
    waypoints: deliveryWaypoints,
    optimizeWaypoints: optimize,
    provideRouteAlternatives: true,
    ...truckOptions,
  };

  directionsService.route(req1, (res1, st1) => {
    if (st1 !== "OK") { showLoading(false); handleRouteError(st1); return; }

    routeResult       = res1;
    selectedAltIndex  = 0;

    // ── Rota 2: Retorno (último ponto de entrega → base)
    // Só faz 2ª chamada se o ponto de retorno for diferente do fim da entrega
    const returnOrigin = deliveryEndpoint;
    const samePoint    = returnOrigin.toLowerCase().trim() === dest.toLowerCase().trim();

    if (samePoint) {
      // Sem retorno separado — mesma localização
      showLoading(false);
      returnRouteResult = null;
      _finalize(res1, null);
      return;
    }

    const req2 = {
      origin: returnOrigin,
      destination: dest,
      ...truckOptions,
    };

    directionsService.route(req2, (res2, st2) => {
      showLoading(false);
      returnRouteResult = st2 === "OK" ? res2 : null;
      _finalize(res1, returnRouteResult);
    });
  });
}

function _finalize(deliveryResult, retResult) {
  renderRoute(deliveryResult, 0, retResult);
  renderSummary(deliveryResult, 0, retResult);
  renderAlternatives(deliveryResult);
  renderDirectionSteps(deliveryResult, 0, retResult);
  document.getElementById("routeSummarySection").classList.remove("hidden");
  document.getElementById("legTimesSection").classList.remove("hidden");
  document.getElementById("directionsPanel").classList.remove("hidden");
  showToast("Rota calculada com sucesso!", "success");
}

/* ── ⑦ RENDERIZAR ROTA NO MAPA ──────────────────────────────── */
let returnPolyline      = null;
const deliveryPolylines = [];

function renderRoute(deliveryResult, routeIndex, returnResult) {
  // Limpa tudo anterior
  altRenderers.forEach(r => r.setMap(null));
  altRenderers = [];
  if (returnPolyline) { returnPolyline.setMap(null); returnPolyline = null; }
  deliveryPolylines.forEach(p => p.setMap(null));
  deliveryPolylines.length = 0;
  clearMarkers();

  // Rotas alternativas de entrega em cinza
  deliveryResult.routes.forEach((_, i) => {
    if (i === routeIndex) return;
    altRenderers.push(new google.maps.DirectionsRenderer({
      map,
      directions: deliveryResult,
      routeIndex: i,
      suppressMarkers: true,
      polylineOptions: { strokeColor: "#FFFFFF", strokeWeight: 3, strokeOpacity: 0.15 },
    }));
  });

  const route = deliveryResult.routes[routeIndex];
  const legs  = route.legs;

  // ── Rota de ENTREGA: dourado sólido
  legs.forEach(leg => {
    const path = leg.steps.flatMap(s =>
      (google.maps.geometry && s.polyline && s.polyline.points)
        ? google.maps.geometry.encoding.decodePath(s.polyline.points)
        : [s.start_location, s.end_location]
    );
    const poly = new google.maps.Polyline({
      path: path.length ? path : [leg.start_location, leg.end_location],
      map,
      strokeColor: "#F5B400",
      strokeWeight: 6,
      strokeOpacity: 0.92,
      zIndex: 2,
    });
    deliveryPolylines.push(poly);
  });

  // ── Rota de RETORNO: roxo tracejado
  if (returnResult && returnResult.routes && returnResult.routes[0]) {
    const retLegs = returnResult.routes[0].legs;
    const retPath = retLegs.flatMap(leg =>
      leg.steps.flatMap(s =>
        (google.maps.geometry && s.polyline && s.polyline.points)
          ? google.maps.geometry.encoding.decodePath(s.polyline.points)
          : [s.start_location, s.end_location]
      )
    );
    returnPolyline = new google.maps.Polyline({
      path: retPath.length
        ? retPath
        : [retLegs[0].start_location, retLegs[retLegs.length - 1].end_location],
      map,
      strokeColor: "#8B5CF6",
      strokeWeight: 5,
      strokeOpacity: 0.9,
      icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 }, offset: "0", repeat: "18px" }],
      zIndex: 3,
    });
  }

  // ── Marcadores: origem verde
  addMarker(legs[0].start_location, "origin", "A");

  // Paradas de entrega douradas com número
  legs.forEach((leg, i) => {
    const num = (route.waypoint_order && route.waypoint_order[i] !== undefined)
      ? String(route.waypoint_order[i] + 1)
      : String(i + 1);
    addMarker(leg.end_location, "stop", num);
  });

  // Pin de retorno roxo
  if (returnResult && returnResult.routes && returnResult.routes[0]) {
    const retLegs = returnResult.routes[0].legs;
    addMarker(retLegs[retLegs.length - 1].end_location, "dest", "↩");
  }

  // Zoom para incluir entrega + retorno
  const bounds = new google.maps.LatLngBounds();
  if (route.bounds) bounds.union(route.bounds);
  if (returnResult && returnResult.routes && returnResult.routes[0] && returnResult.routes[0].bounds) {
    bounds.union(returnResult.routes[0].bounds);
  }
  map.fitBounds(bounds);
}

/* ── ⑧ MARCADORES CUSTOMIZADOS ──────────────────────────────── */
const mapMarkers = [];

function addMarker(position, type, label) {
  const colors = {
    origin: { bg: "#00C48C", text: "#000" },
    stop:   { bg: "#F5B400", text: "#000" },
    dest:   { bg: "#8B5CF6", text: "#FFF" },   // roxo — Local de Retorno
  };
  const c = colors[type] || colors.stop;

  const marker = new google.maps.Marker({
    position,
    map,
    label: {
      text: label,
      color: c.text,
      fontWeight: "700",
      fontSize: "11px",
      fontFamily: "'DM Sans', sans-serif",
    },
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 14,
      fillColor: c.bg,
      fillOpacity: 1,
      strokeColor: "#000",
      strokeWeight: 2,
    },
    zIndex: type === "origin" ? 3 : type === "dest" ? 3 : 2,
  });

  mapMarkers.push(marker);
  return marker;
}

function clearMarkers() {
  mapMarkers.forEach(m => m.setMap(null));
  mapMarkers.length = 0;
}

/* ── ⑨ RENDERIZAR RESUMO ─────────────────────────────────────── */
function renderSummary(deliveryResult, routeIndex, returnResult) {
  const route = deliveryResult.routes[routeIndex];
  const legs  = route.legs;

  const delivDist = legs.reduce((s, l) => s + (l.distance ? l.distance.value : 0), 0);
  const delivTime = legs.reduce((s, l) => s + (l.duration ? l.duration.value : 0), 0);

  let retDist = 0, retTime = 0;
  if (returnResult && returnResult.routes && returnResult.routes[0]) {
    returnResult.routes[0].legs.forEach(l => {
      retDist += l.distance ? l.distance.value : 0;
      retTime += l.duration ? l.duration.value : 0;
    });
  }

  document.getElementById("totalDistance").textContent = formatDistance(delivDist + retDist);
  document.getElementById("totalDuration").textContent = formatDuration(delivTime + retTime);
  document.getElementById("totalStops").textContent    = `${legs.length} parada${legs.length !== 1 ? "s" : ""}`;

  renderLegTimes(route, legs, returnResult);
  renderOptimizedOrder(route);
}

/* ── RENDERIZAR TEMPO POR TRECHO ─────────────────────────────── */
function renderLegTimes(route, delivLegs, returnResult) {
  const section = document.getElementById("legTimesSection");
  const list    = document.getElementById("legTimesList");
  if (!section || !list) return;
  list.innerHTML = "";

  // ── ROTA DE ENTREGA ──────────────────────────────────────────
  const idaHeader = document.createElement("div");
  idaHeader.className = "leg-section-header leg-section-header--ida";
  idaHeader.innerHTML = `<span class="leg-section-dot leg-section-dot--ida"></span> ROTA DE ENTREGA`;
  list.appendChild(idaHeader);

  let idaDist = 0, idaTime = 0;

  delivLegs.forEach((leg, i) => {
    idaDist += leg.distance ? leg.distance.value : 0;
    idaTime += leg.duration ? leg.duration.value : 0;

    const from = (leg.start_address || "").split(",")[0];
    const to   = (leg.end_address   || "").split(",")[0];
    const dur  = leg.duration ? leg.duration.text : "—";
    const dist = leg.distance ? leg.distance.text : "—";
    const num  = (route.waypoint_order && route.waypoint_order[i] !== undefined)
      ? route.waypoint_order[i] + 1 : i + 1;
    const label = i === 0 ? "Saída" : `Entrega ${num}`;

    const item = document.createElement("div");
    item.className = "leg-time-item leg-time-item--entrega";
    item.innerHTML = `
      <div class="leg-time-header">
        <span class="leg-type-badge leg-type-badge--${i === 0 ? "origem" : "parada"}">${label}</span>
        <span class="leg-time-dur">⏱ ${dur}</span>
        <span class="leg-time-dist">${dist}</span>
      </div>
      <div class="leg-time-route">
        <span class="leg-time-from" title="${leg.start_address || ""}">${from}</span>
        <span class="leg-arrow">→</span>
        <span class="leg-time-to" title="${leg.end_address || ""}">${to}</span>
      </div>`;
    list.appendChild(item);
  });

  // Subtotal entrega
  const idaTotal = document.createElement("div");
  idaTotal.className = "leg-subtotal leg-subtotal--ida";
  idaTotal.innerHTML = `<span>Total da entrega</span><span class="leg-subtotal-dur">⏱ ${formatDuration(idaTime)}</span><span class="leg-subtotal-dist">${formatDistance(idaDist)}</span>`;
  list.appendChild(idaTotal);

  // ── ROTA DE RETORNO ──────────────────────────────────────────
  const voltaHeader = document.createElement("div");
  voltaHeader.className = "leg-section-header leg-section-header--volta";
  voltaHeader.innerHTML = `<span class="leg-section-dot leg-section-dot--volta"></span> ROTA DE RETORNO`;
  list.appendChild(voltaHeader);

  let retDist = 0, retTime = 0;

  if (returnResult && returnResult.routes && returnResult.routes[0]) {
    returnResult.routes[0].legs.forEach(leg => {
      retDist += leg.distance ? leg.distance.value : 0;
      retTime += leg.duration ? leg.duration.value : 0;

      const from = (leg.start_address || "").split(",")[0];
      const to   = (leg.end_address   || "").split(",")[0];
      const dur  = leg.duration ? leg.duration.text : "—";
      const dist = leg.distance ? leg.distance.text : "—";

      const item = document.createElement("div");
      item.className = "leg-time-item leg-time-item--retorno";
      item.innerHTML = `
        <div class="leg-time-header">
          <span class="leg-type-badge leg-type-badge--retorno">↩ Retorno</span>
          <span class="leg-time-dur" style="color:#a78bfa">⏱ ${dur}</span>
          <span class="leg-time-dist">${dist}</span>
        </div>
        <div class="leg-time-route">
          <span class="leg-time-from" title="${leg.start_address || ""}">${from}</span>
          <span class="leg-arrow">→</span>
          <span class="leg-time-to" title="${leg.end_address || ""}" style="color:#c4b5fd">${to}</span>
        </div>`;
      list.appendChild(item);
    });

    // Subtotal retorno
    const voltaTotal = document.createElement("div");
    voltaTotal.className = "leg-subtotal leg-subtotal--volta";
    voltaTotal.innerHTML = `<span>Total do retorno</span><span class="leg-subtotal-dur" style="color:#a78bfa">⏱ ${formatDuration(retTime)}</span><span class="leg-subtotal-dist">${formatDistance(retDist)}</span>`;
    list.appendChild(voltaTotal);
  } else {
    const noRet = document.createElement("div");
    noRet.className = "leg-no-return";
    noRet.textContent = "Retorno não calculado.";
    list.appendChild(noRet);
  }

  // ── TOTAL GERAL ──────────────────────────────────────────────
  const totalRow = document.createElement("div");
  totalRow.className = "leg-time-total";
  totalRow.innerHTML = `
    <span class="leg-total-label">TOTAL GERAL</span>
    <span class="leg-total-dur">⏱ ${formatDuration(idaTime + retTime)}</span>
    <span class="leg-total-dist">${formatDistance(idaDist + retDist)}</span>`;
  list.appendChild(totalRow);

  section.classList.remove("hidden");
}

/* ── RENDERIZAR ORDEM OTIMIZADA ──────────────────────────────── */
function renderOptimizedOrder(route) {
  const panel = document.getElementById("optimizedOrderPanel");
  const list  = document.getElementById("optimizedOrderList");
  list.innerHTML = "";

  const waypointOrder = route.waypoint_order;
  if (!waypointOrder || waypointOrder.length === 0) {
    panel.classList.add("hidden");
    return;
  }

  // Coleta os endereços das paradas originais
  const stopInputs = [...document.querySelectorAll(".stop-address-input")];
  if (stopInputs.length === 0) {
    panel.classList.add("hidden");
    return;
  }

  // Cria lista reordenada
  waypointOrder.forEach((originalIdx, newPos) => {
    const addr = stopInputs[originalIdx]?.value?.trim() || `Parada ${originalIdx + 1}`;
    const item = document.createElement("div");
    item.className = "optimized-stop-item";
    item.innerHTML = `
      <div class="optimized-stop-num">${newPos + 1}</div>
      <div class="optimized-stop-addr">${addr}</div>
    `;
    list.appendChild(item);
  });

  // Atualiza os labels das paradas na sidebar com a nova numeração
  updateStopLabels(waypointOrder, stopInputs);

  panel.classList.remove("hidden");
}

/* ── ATUALIZAR LABELS DE PARADAS NA SIDEBAR ─────────────────── */
function updateStopLabels(waypointOrder, stopInputs) {
  // Cria mapa: originalIdx → novaOrdem
  const orderMap = {};
  waypointOrder.forEach((originalIdx, newPos) => {
    orderMap[originalIdx] = newPos + 1;
  });

  stopInputs.forEach((input, idx) => {
    const stopItem = input.closest(".stop-item");
    if (!stopItem) return;
    const label = stopItem.querySelector(".field-label");
    if (!label) return;
    const newNum = orderMap[idx];
    if (newNum !== undefined) {
      label.innerHTML = `Parada <span class="stop-order-badge">${newNum}ª entrega</span>`;
    }
  });
}

/* ── ⑩ RENDERIZAR ROTAS ALTERNATIVAS ────────────────────────── */
function renderAlternatives(result) {
  const panel = document.getElementById("altRoutesPanel");
  const list  = document.getElementById("altRoutesList");

  list.innerHTML = "";

  if (result.routes.length <= 1) {
    panel.classList.add("hidden");
    return;
  }

  panel.classList.remove("hidden");

  result.routes.forEach((route, i) => {
    const leg    = route.legs[0];
    const dist   = route.legs.reduce((s, l) => s + l.distance.value, 0);
    const time   = route.legs.reduce((s, l) => s + l.duration.value, 0);
    const isMain = i === 0;

    const btn = document.createElement("button");
    btn.className = `alt-route-btn${i === selectedAltIndex ? " active" : ""}`;
    btn.innerHTML = `
      <span>Rota ${i + 1} — ${formatDistance(dist)}</span>
      <span class="alt-badge">${formatDuration(time)}${isMain ? " · Recomendada" : ""}</span>
    `;
    btn.addEventListener("click", () => {
      selectedAltIndex = i;
      renderRoute(result, i);
      renderSummary(result, i);
      renderDirectionSteps(result, i);
      // Atualiza botões
      document.querySelectorAll(".alt-route-btn").forEach((b, j) => {
        b.classList.toggle("active", j === i);
      });
    });

    list.appendChild(btn);
  });
}

/* ── ⑪ DIREÇÕES PASSO A PASSO ───────────────────────────────── */
function renderDirectionSteps(result, routeIndex, retResult) {
  const container = document.getElementById("directionsSteps");
  container.innerHTML = "";

  const legs = result.routes[routeIndex].legs;
  let stepNum = 1;

  // Seção: ENTREGA
  const idaTitle = document.createElement("div");
  idaTitle.className = "steps-section-title steps-section-title--ida";
  idaTitle.innerHTML = `<span class="steps-dot steps-dot--ida"></span> ROTA DE ENTREGA`;
  container.appendChild(idaTitle);

  legs.forEach((leg, legIdx) => {
    const legHeader = document.createElement("div");
    legHeader.className = "step-leg-header";
    legHeader.textContent = `${leg.start_address.split(",")[0]} → ${leg.end_address.split(",")[0]}`;
    container.appendChild(legHeader);

    leg.steps.forEach(step => {
      const div = document.createElement("div");
      div.className = "step-item";
      const instruction = step.html_instructions
        .replace(/<b>/g,"").replace(/<\/b>/g,"")
        .replace(/<div[^>]*>/g," — ").replace(/<\/div>/g,"")
        .replace(/<[^>]+>/g,"");
      div.innerHTML = `
        <div class="step-num">${stepNum}</div>
        <div class="step-text">${instruction}</div>
        <div class="step-dist">${step.distance.text}</div>`;
      container.appendChild(div);
      stepNum++;
    });
  });

  // Seção: RETORNO
  if (retResult && retResult.routes && retResult.routes[0]) {
    const voltaTitle = document.createElement("div");
    voltaTitle.className = "steps-section-title steps-section-title--volta";
    voltaTitle.innerHTML = `<span class="steps-dot steps-dot--volta"></span> ROTA DE RETORNO`;
    container.appendChild(voltaTitle);

    retResult.routes[0].legs.forEach(leg => {
      const legHeader = document.createElement("div");
      legHeader.className = "step-leg-header step-leg-header--volta";
      legHeader.textContent = `${leg.start_address.split(",")[0]} → ${leg.end_address.split(",")[0]}`;
      container.appendChild(legHeader);

      leg.steps.forEach(step => {
        const div = document.createElement("div");
        div.className = "step-item step-item--volta";
        const instruction = step.html_instructions
          .replace(/<b>/g,"").replace(/<\/b>/g,"")
          .replace(/<div[^>]*>/g," — ").replace(/<\/div>/g,"")
          .replace(/<[^>]+>/g,"");
        div.innerHTML = `
          <div class="step-num step-num--volta">${stepNum}</div>
          <div class="step-text">${instruction}</div>
          <div class="step-dist">${step.distance.text}</div>`;
        container.appendChild(div);
        stepNum++;
      });
    });
  }
}

/* ── ⑫ ADICIONAR PARADA ─────────────────────────────────────── */
function addStop(initialValue = "") {
  stopCounter++;
  const id        = `stop_${stopCounter}`;
  const inputId   = `stop_input_${stopCounter}`;
  const container = document.getElementById("stopsContainer");

  const item = document.createElement("div");
  item.className = "stop-item";
  item.dataset.id = id;

  item.innerHTML = `
    <div class="stop-drag-handle" title="Arrastar para reordenar">
      <i data-lucide="grip-vertical"></i>
    </div>
    <div class="field-marker stop-marker">
      <i data-lucide="map-pin"></i>
    </div>
    <div class="field-body">
      <label class="field-label">Parada ${stopCounter}</label>
      <div class="autocomplete-wrapper">
        <input
          type="text"
          id="${inputId}"
          class="address-input stop-address-input"
          placeholder="Endereço da parada…"
          autocomplete="off"
          value="${initialValue}"
        />
        <button class="clear-field-btn hidden" data-target="${inputId}" title="Limpar">
          <i data-lucide="x"></i>
        </button>
      </div>
    </div>
    <button class="stop-remove-btn" data-id="${id}" title="Remover parada">
      <i data-lucide="x"></i>
    </button>
  `;

  container.appendChild(item);

  // Re-renderiza ícones Lucide no novo elemento
  lucide.createIcons({ nodes: [item] });

  // Autocomplete para o novo campo
  if (google && google.maps) initAutocomplete(inputId);

  // Botão remover
  item.querySelector(".stop-remove-btn").addEventListener("click", () => {
    item.style.animation = "none";
    item.style.opacity = "0";
    item.style.transform = "translateY(-8px)";
    item.style.transition = "all 0.2s ease";
    setTimeout(() => item.remove(), 200);
  });

  // Botão limpar campo
  const input = item.querySelector(`#${inputId}`);
  const clearBtn = item.querySelector(".clear-field-btn");
  input.addEventListener("input", () => {
    clearBtn.classList.toggle("hidden", !input.value);
  });
  clearBtn.addEventListener("click", () => {
    input.value = "";
    clearBtn.classList.add("hidden");
    input.focus();
  });

  // Foco automático
  setTimeout(() => input.focus(), 50);
}

/* ── ⑬ LIMPAR ROTA ───────────────────────────────────────────── */
function clearRoute() {
  // Campos de texto
  document.getElementById("originInput").value = "";
  document.getElementById("destInput").value   = "";

  // Remove paradas
  document.getElementById("stopsContainer").innerHTML = "";
  stopCounter = 0;

  // Limpa mapa
  if (directionsRenderer) directionsRenderer.setDirections({ routes: [] });
  altRenderers.forEach(r => r.setMap(null));
  altRenderers = [];
  if (returnPolyline) { returnPolyline.setMap(null); returnPolyline = null; }
  deliveryPolylines.forEach(p => p.setMap(null));
  deliveryPolylines.length = 0;
  clearMarkers();
  returnRouteResult = null;

  // Esconde painéis
  document.getElementById("routeSummarySection").classList.add("hidden");
  document.getElementById("directionsPanel").classList.add("hidden");
  document.getElementById("legTimesSection")?.classList.add("hidden");
  document.getElementById("optimizedOrderPanel")?.classList.add("hidden");

  // Limpa classes de erro
  document.querySelectorAll(".address-input").forEach(i => i.classList.remove("error"));

  // Botões limpar
  document.querySelectorAll(".clear-field-btn").forEach(b => b.classList.add("hidden"));

  routeResult = null;
  showToast("Rota limpa.", "info");
}

/* ── ⑭ EXPORTAÇÕES ────────────────────────────────────────────── */

/** Abre o modal de escolha de app de navegação */
function openNavModal() {
  const origin = document.getElementById("originInput").value.trim();
  const dest   = document.getElementById("destInput").value.trim();
  if (!origin || !dest) {
    showToast("Preencha origem e destino antes de navegar.", "error");
    return;
  }
  const modal = document.getElementById("navModal");
  modal.classList.remove("hidden");
  lucide.createIcons({ nodes: [modal] });
}

function closeNavModal() {
  document.getElementById("navModal").classList.add("hidden");
}

/** Monta URL do Google Maps com todas as paradas */
function buildGoogleMapsURL() {
  const origin = document.getElementById("originInput").value.trim();
  const dest   = document.getElementById("destInput").value.trim();
  const stops  = [...document.querySelectorAll(".stop-address-input")]
    .map(i => i.value.trim()).filter(Boolean);

  const base = "https://www.google.com/maps/dir/";
  const parts = [
    encodeURIComponent(origin),
    ...stops.map(s => encodeURIComponent(s)),
    encodeURIComponent(dest),
  ];

  const mode = travelMode === "DRIVING"   ? "driving"
             : travelMode === "BICYCLING" ? "bicycling"
             : travelMode === "WALKING"   ? "walking"
             : "driving";

  return `${base}${parts.join("/")}/?travelmode=${mode}`;
}

/** Google Maps com rota completa (todas as paradas) */
function exportGoogleMaps() {
  const origin = document.getElementById("originInput").value.trim();
  const dest   = document.getElementById("destInput").value.trim();
  if (!origin || !dest) { showToast("Preencha origem e destino.", "error"); return; }
  const url = buildGoogleMapsURL();
  window.open(url, "_blank");
  showToast("Abrindo Google Maps com a rota completa!", "success");
}

/** Google Maps — apenas origem → destino (sem paradas) */
function exportGoogleMapsSimple() {
  const origin = document.getElementById("originInput").value.trim();
  const dest   = document.getElementById("destInput").value.trim();
  if (!origin || !dest) { showToast("Preencha origem e destino.", "error"); return; }
  const url = `https://www.google.com/maps/dir/${encodeURIComponent(origin)}/${encodeURIComponent(dest)}`;
  window.open(url, "_blank");
  showToast("Abrindo Google Maps (origem → destino)!", "success");
}

/** Waze — abre o destino final via deep link */
function exportWaze() {
  const dest = document.getElementById("destInput").value.trim();
  if (!dest) { showToast("Informe o local de retorno antes de abrir o Waze.", "error"); return; }

  let url;
  // Usa coordenadas precisas se disponível
  if (returnRouteResult && returnRouteResult.routes && returnRouteResult.routes[0]) {
    const legs   = returnRouteResult.routes[0].legs;
    const endLoc = legs[legs.length - 1].end_location;
    const lat    = typeof endLoc.lat === "function" ? endLoc.lat() : endLoc.lat;
    const lng    = typeof endLoc.lng === "function" ? endLoc.lng() : endLoc.lng;
    url = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes&zoom=17`;
  } else if (routeResult && routeResult.routes && routeResult.routes[0]) {
    const legs   = routeResult.routes[0].legs;
    const endLoc = legs[legs.length - 1].end_location;
    const lat    = typeof endLoc.lat === "function" ? endLoc.lat() : endLoc.lat;
    const lng    = typeof endLoc.lng === "function" ? endLoc.lng() : endLoc.lng;
    url = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes&zoom=17`;
  } else {
    url = `https://waze.com/ul?q=${encodeURIComponent(dest)}&navigate=yes`;
  }

  window.open(url, "_blank");
  showToast("Abrindo Waze!", "success");
}

/** Gera e copia link compartilhável do Google Maps */
function shareRouteLink() {
  const origin = document.getElementById("originInput").value.trim();
  const dest   = document.getElementById("destInput").value.trim();
  if (!origin || !dest) {
    showToast("Preencha origem e destino para gerar o link.", "error");
    return;
  }
  const url = buildGoogleMapsURL();
  navigator.clipboard.writeText(url)
    .then(() => showToast("Link da rota copiado! Compartilhe à vontade.", "success"))
    .catch(() => {
      // fallback: abre em nova aba
      window.open(url, "_blank");
      showToast("Link aberto em nova aba.", "info");
    });
}

/** Exporta rota como PDF */
function exportPDF() {
  if (!routeResult) {
    showToast("Calcule a rota antes de exportar.", "error");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, pageH = 297;
  let y = 0;

  // ── Cabeçalho
  doc.setFillColor(10, 10, 10);
  doc.rect(0, 0, W, 40, "F");

  doc.setFillColor(245, 180, 0);
  doc.rect(0, 38, W, 3, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.setTextColor(255, 255, 255);
  doc.text("PREMIATTA ROUTE MAP", 16, 22);

  doc.setFontSize(9);
  doc.setTextColor(200, 200, 200);
  doc.text("Sistema Premium de Roteirização", 16, 32);

  // Data
  doc.setFontSize(8);
  doc.setTextColor(160, 160, 160);
  doc.text(new Date().toLocaleDateString("pt-BR", { dateStyle: "full" }), W - 16, 32, { align: "right" });

  y = 52;

  // ── Resumo
  const route  = routeResult.routes[selectedAltIndex];
  const totalD = route.legs.reduce((s, l) => s + l.distance.value, 0);
  const totalT = route.legs.reduce((s, l) => s + l.duration.value, 0);

  const cards = [
    ["DISTÂNCIA", formatDistance(totalD)],
    ["TEMPO",     formatDuration(totalT)],
    ["PARADAS",   String(route.legs.length - 1)],
  ];

  cards.forEach(([label, val], i) => {
    const x = 16 + i * 62;
    doc.setFillColor(24, 24, 24);
    doc.roundedRect(x, y, 58, 20, 3, 3, "F");
    doc.setFontSize(7); doc.setTextColor(180, 180, 180); doc.setFont("helvetica", "normal");
    doc.text(label, x + 6, y + 8);
    doc.setFontSize(14); doc.setTextColor(245, 180, 0); doc.setFont("helvetica", "bold");
    doc.text(val, x + 6, y + 17);
  });

  y += 30;

  // ── Endereços
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(245, 180, 0);
  doc.text("ENDEREÇOS DA ROTA", 16, y);
  y += 6;

  doc.setFillColor(245, 180, 0);
  doc.rect(16, y, W - 32, 0.5, "F");
  y += 8;

  const origin  = document.getElementById("originInput").value.trim();
  const dest    = document.getElementById("destInput").value.trim();
  const stops   = [...document.querySelectorAll(".stop-address-input")].map(i => i.value.trim()).filter(Boolean);

  const addresses = [
    { type: "ORIGEM", addr: origin },
    ...stops.map((s, i) => ({ type: `PARADA ${i + 1}`, addr: s })),
    { type: "DESTINO", addr: dest },
  ];

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  addresses.forEach(({ type, addr }) => {
    if (y > pageH - 30) { doc.addPage(); y = 20; }

    doc.setTextColor(150, 150, 150);
    doc.text(type, 16, y);

    doc.setTextColor(240, 240, 240);
    const lines = doc.splitTextToSize(addr, W - 60);
    doc.text(lines, 55, y);

    y += 8 * lines.length + 2;
  });

  y += 8;

  // ── Direções
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(245, 180, 0);
  doc.text("DIREÇÕES DETALHADAS", 16, y);
  y += 6;

  doc.setFillColor(245, 180, 0);
  doc.rect(16, y, W - 32, 0.5, "F");
  y += 8;

  let stepNum = 1;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  route.legs.forEach(leg => {
    leg.steps.forEach(step => {
      if (y > pageH - 20) { doc.addPage(); y = 20; }

      const instruction = step.html_instructions
        .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

      doc.setTextColor(245, 180, 0);
      doc.text(`${stepNum}.`, 16, y);

      doc.setTextColor(220, 220, 220);
      const lines = doc.splitTextToSize(instruction, W - 50);
      doc.text(lines, 24, y);

      doc.setTextColor(150, 150, 150);
      doc.text(step.distance.text, W - 16, y, { align: "right" });

      y += 6 * lines.length + 1;
      stepNum++;
    });
  });

  // ── Rodapé
  doc.setFillColor(10, 10, 10);
  doc.rect(0, pageH - 12, W, 12, "F");
  doc.setFontSize(7); doc.setTextColor(100, 100, 100); doc.setFont("helvetica", "normal");
  doc.text("Premiatta RouteMap — Sistema Premium de Roteirização", W / 2, pageH - 5, { align: "center" });

  doc.save(`premiatta-rota-${Date.now()}.pdf`);
  showToast("PDF exportado com sucesso!", "success");
}

/** Exporta rota como CSV */
function exportCSV() {
  const origin = document.getElementById("originInput").value.trim();
  const dest   = document.getElementById("destInput").value.trim();

  if (!origin && !dest) {
    showToast("Preencha ao menos a origem e o destino.", "error");
    return;
  }

  const stops = [...document.querySelectorAll(".stop-address-input")]
    .map(i => i.value.trim())
    .filter(Boolean);

  const rows = [
    ["Ordem", "Tipo", "Endereço", "Distância Trecho", "Tempo Trecho"],
    ["1", "Origem", origin, "", ""],
    ...stops.map((s, i) => {
      let dist = "", time = "";
      if (routeResult) {
        const leg = routeResult.routes[selectedAltIndex].legs[i];
        if (leg) { dist = leg.distance.text; time = leg.duration.text; }
      }
      return [String(i + 2), `Parada ${i + 1}`, s, dist, time];
    }),
  ];

  // Destino — último leg
  if (routeResult) {
    const legs = routeResult.routes[selectedAltIndex].legs;
    const last = legs[legs.length - 1];
    rows.push([String(stops.length + 2), "Destino", dest, last.distance.text, last.duration.text]);
  } else {
    rows.push([String(stops.length + 2), "Destino", dest, "", ""]);
  }

  const csv = rows.map(r => r.map(cell => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
  const bom  = "\uFEFF"; // BOM para Excel reconhecer UTF-8
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `premiatta-rota-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("CSV exportado com sucesso!", "success");
}

/** Exporta rota como planilha Excel (.xlsx) com SheetJS */
function exportXLSX() {
  if (!window.XLSX) {
    showToast("Biblioteca Excel não carregada. Tente novamente.", "error");
    return;
  }

  const origin = document.getElementById("originInput").value.trim();
  const dest   = document.getElementById("destInput").value.trim();

  if (!origin && !dest) {
    showToast("Preencha ao menos a origem e o destino.", "error");
    return;
  }

  const stops = [...document.querySelectorAll(".stop-address-input")]
    .map(i => i.value.trim()).filter(Boolean);

  const wb = XLSX.utils.book_new();

  // ── ABA 1: RESUMO DA ROTA ──────────────────────────────────
  const resumoData = [
    ["PREMIATTA ROUTE MAP — Resumo da Rota"],
    ["Gerado em:", new Date().toLocaleString("pt-BR")],
    [],
    ["CAMPO", "VALOR"],
    ["Local de Partida", origin],
    ...stops.map((s, i) => [`Parada ${i + 1}`, s]),
    ["Local de Retorno", dest],
  ];

  if (routeResult) {
    const route  = routeResult.routes[selectedAltIndex];
    const totalD = route.legs.reduce((s, l) => s + l.distance.value, 0);
    const totalT = route.legs.reduce((s, l) => s + l.duration.value, 0);
    resumoData.push([]);
    resumoData.push(["MÉTRICAS", ""]);
    resumoData.push(["Distância Total", formatDistance(totalD)]);
    resumoData.push(["Tempo Total", formatDuration(totalT)]);
    resumoData.push(["Total de Paradas", stops.length]);
  }

  const wsResumo = XLSX.utils.aoa_to_sheet(resumoData);

  // Estilo das colunas (largura)
  wsResumo["!cols"] = [{ wch: 28 }, { wch: 55 }];

  // Mescla título
  wsResumo["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];

  XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");

  // ── ABA 2: DETALHAMENTO POR TRECHO ─────────────────────────
  if (routeResult) {
    const route = routeResult.routes[selectedAltIndex];
    const legs  = route.legs;

    const trechoHeaders = ["#", "Tipo", "De", "Para", "Distância", "Tempo", "Endereço Completo (Destino)"];
    const trechoRows = legs.map((leg, i) => {
      const isLast = i === legs.length - 1;
      const tipo   = i === 0 ? "Saída" : isLast ? "Retorno" : `Entrega ${i}`;
      return [
        i + 1,
        tipo,
        leg.start_address.split(",")[0],
        leg.end_address.split(",")[0],
        leg.distance.text,
        leg.duration.text,
        leg.end_address,
      ];
    });

    const wsDetalhes = XLSX.utils.aoa_to_sheet([trechoHeaders, ...trechoRows]);
    wsDetalhes["!cols"] = [
      { wch: 4 }, { wch: 12 }, { wch: 22 }, { wch: 22 },
      { wch: 12 }, { wch: 12 }, { wch: 50 },
    ];
    XLSX.utils.book_append_sheet(wb, wsDetalhes, "Trechos");
  }

  // ── ABA 3: ENDEREÇOS COMPLETOS ──────────────────────────────
  const endHeaders = ["Ordem", "Tipo", "Endereço", "Distância Trecho", "Tempo Trecho"];
  const endRows = [
    [1, "Partida", origin, "", ""],
    ...stops.map((s, i) => {
      let dist = "", time = "";
      if (routeResult) {
        const leg = routeResult.routes[selectedAltIndex].legs[i];
        if (leg) { dist = leg.distance.text; time = leg.duration.text; }
      }
      return [i + 2, `Entrega ${i + 1}`, s, dist, time];
    }),
  ];

  if (routeResult) {
    const legs = routeResult.routes[selectedAltIndex].legs;
    const last = legs[legs.length - 1];
    endRows.push([stops.length + 2, "Retorno", dest, last.distance.text, last.duration.text]);
  } else {
    endRows.push([stops.length + 2, "Retorno", dest, "", ""]);
  }

  const wsEnderecos = XLSX.utils.aoa_to_sheet([endHeaders, ...endRows]);
  wsEnderecos["!cols"] = [{ wch: 7 }, { wch: 14 }, { wch: 55 }, { wch: 16 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsEnderecos, "Endereços");

  // ── Salva o arquivo
  XLSX.writeFile(wb, `premiatta-rota-${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast("Planilha Excel exportada com sucesso!", "success");
}

/** Copia resumo da rota para a área de transferência */
function copyRoute() {
  const origin = document.getElementById("originInput").value.trim();
  const dest   = document.getElementById("destInput").value.trim();
  const stops  = [...document.querySelectorAll(".stop-address-input")]
    .map((i, idx) => `  ${idx + 1}. ${i.value.trim()}`)
    .filter(Boolean);

  if (!origin && !dest) {
    showToast("Preencha a rota antes de copiar.", "error");
    return;
  }

  let text = `🗺️ PREMIATTA ROUTE MAP\n`;
  text    += `📍 Origem: ${origin}\n`;
  if (stops.length) text += `🔁 Paradas:\n${stops.join("\n")}\n`;
  text    += `🏁 Destino: ${dest}\n`;

  if (routeResult) {
    const route = routeResult.routes[selectedAltIndex];
    const d = route.legs.reduce((s, l) => s + l.distance.value, 0);
    const t = route.legs.reduce((s, l) => s + l.duration.value, 0);
    text += `📏 Distância: ${formatDistance(d)} | ⏱ Tempo: ${formatDuration(t)}`;
  }

  navigator.clipboard.writeText(text)
    .then(() => showToast("Rota copiada para a área de transferência!", "success"))
    .catch(() => showToast("Não foi possível copiar. Tente manualmente.", "error"));
}

/* ── ⑮ UTILITÁRIOS ─────────────────────────────────────────── */

function formatDistance(meters) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
  return `${meters} m`;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m} min`;
}

function showLoading(show) {
  const el = document.getElementById("loadingOverlay");
  if (show) el.classList.remove("hidden");
  else      el.classList.add("hidden");
}

function highlight(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.classList.add("error");
  el.focus();
  el.addEventListener("input", () => el.classList.remove("error"), { once: true });
}

function handleRouteError(status) {
  const msgs = {
    NOT_FOUND:              "Endereço não encontrado. Verifique os campos.",
    ZERO_RESULTS:           "Não foi possível traçar rota entre os endereços.",
    MAX_WAYPOINTS_EXCEEDED: "Número máximo de paradas excedido (23 paradas).",
    INVALID_REQUEST:        "Requisição inválida. Verifique os endereços.",
    OVER_DAILY_LIMIT:       "Limite diário da API atingido.",
    OVER_QUERY_LIMIT:       "Muitas requisições. Aguarde e tente novamente.",
    REQUEST_DENIED:         "Requisição negada. Verifique a API Key e permissões.",
    UNKNOWN_ERROR:          "Erro desconhecido. Tente novamente.",
  };
  showToast(msgs[status] || `Erro: ${status}`, "error");
}

/* ── ⑯ TOAST SYSTEM ─────────────────────────────────────────── */
const icons = {
  success: "check-circle",
  error:   "alert-circle",
  info:    "info",
};

function showToast(message, type = "info", duration = 3500) {
  const container = document.getElementById("toastContainer");
  const toast     = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `
    <i data-lucide="${icons[type] || "info"}" class="toast-icon" style="width:16px;height:16px;flex-shrink:0"></i>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  lucide.createIcons({ nodes: [toast] });

  setTimeout(() => {
    toast.classList.add("toast-out");
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

/* ── ⑰ TEMA ESCURO DO MAPA ──────────────────────────────────── */
function darkMapStyles() {
  return [
    { elementType: "geometry",         stylers: [{ color: "#1a1a1a" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#8a8a8a" }] },
    { elementType: "labels.text.stroke",stylers:[{ color: "#0a0a0a" }] },
    { featureType: "road", elementType: "geometry",      stylers: [{ color: "#2c2c2c" }] },
    { featureType: "road", elementType: "geometry.stroke",stylers:[{ color: "#111111" }] },
    { featureType: "road.highway", elementType: "geometry",stylers:[{ color: "#3c3c3c" }] },
    { featureType: "road.highway", elementType: "geometry.stroke",stylers:[{ color: "#1f1f1f" }] },
    { featureType: "water", elementType: "geometry",     stylers: [{ color: "#0d1b2e" }] },
    { featureType: "water", elementType: "labels.text.fill",stylers:[{ color: "#3d5d8a" }] },
    { featureType: "poi",   stylers: [{ visibility: "simplified" }] },
    { featureType: "poi.park", elementType: "geometry",  stylers: [{ color: "#111f11" }] },
    { featureType: "transit", stylers: [{ visibility: "simplified" }] },
    { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#c0c0c0" }] },
    { featureType: "administrative.country",  elementType: "geometry.stroke",  stylers: [{ color: "#333333" }] },
  ];
}

/* ── ⑱ EVENT LISTENERS ─────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  // Renderiza ícones Lucide
  lucide.createIcons();

  // Botões principais
  document.getElementById("calcBtn").addEventListener("click", calculateRoute);
  document.getElementById("clearBtn").addEventListener("click", clearRoute);
  document.getElementById("addStopBtn").addEventListener("click", () => addStop());

  // Exportações
  document.getElementById("exportGmapsBtn").addEventListener("click", exportGoogleMaps);
  document.getElementById("exportWazeBtn").addEventListener("click", exportWaze);
  document.getElementById("exportXlsxBtn").addEventListener("click", exportXLSX);
  document.getElementById("exportPdfBtn").addEventListener("click", exportPDF);
  document.getElementById("exportCsvBtn").addEventListener("click", exportCSV);
  document.getElementById("copyRouteBtn").addEventListener("click", copyRoute);

  // Modo de transporte fixo: CAMINHÃO (DRIVING) — não há listener de troca

  // Botões limpar campo (origem e destino)
  document.querySelectorAll(".clear-field-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.target);
      if (target) {
        target.value = "";
        target.focus();
        btn.classList.add("hidden");
      }
    });
  });

  // Mostrar/ocultar botão de limpar ao digitar
  ["originInput", "destInput"].forEach(id => {
    const input = document.getElementById(id);
    const clearBtn = input?.parentElement?.querySelector(".clear-field-btn");
    if (!input || !clearBtn) return;
    input.addEventListener("input", () => {
      clearBtn.classList.toggle("hidden", !input.value);
    });
  });

  // Toggle direções passo a passo
  document.getElementById("directionsToggleBtn").addEventListener("click", () => {
    document.getElementById("directionsPanel").classList.toggle("collapsed");
  });

  // Header das direções também faz toggle
  document.querySelector(".directions-header").addEventListener("click", (e) => {
    if (!e.target.closest(".directions-toggle")) return;
    // já tratado acima
  });

  // ── SortableJS para arrastar e soltar paradas ──
  const stopsContainer = document.getElementById("stopsContainer");
  Sortable.create(stopsContainer, {
    handle: ".stop-drag-handle",
    animation: 180,
    ghostClass: "sortable-ghost",
    dragClass: "sortable-drag",
    easing: "cubic-bezier(0.4, 0, 0.2, 1)",
  });

  // ── Atalho de teclado: Enter para calcular ──
  document.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.ctrlKey) calculateRoute();
  });

  console.log("%c 🗺️ PREMIATTA ROUTE MAP", "font-size:16px;font-weight:bold;color:#F5B400;");
  console.log("%c Pressione Ctrl+Enter para calcular a rota rapidamente.", "color:#888");

  // ── SPLASH SCREEN — barra de progresso e saída animada ──
  initSplash();
});

/* ── ⑲ SPLASH SCREEN ──────────────────────────────────────────
   Sequência de loading com barra de progresso animada.
   Dura ~2,8s e então faz fade-out elegante.
   ─────────────────────────────────────────────────────────── */
function initSplash() {
  const splash    = document.getElementById("splashScreen");
  const fill      = document.getElementById("splashProgressFill");
  const label     = document.getElementById("splashProgressLabel");

  if (!splash || !fill || !label) return;

  // Etapas com mensagens e porcentagem alvo
  const steps = [
    { pct: 15,  msg: "Carregando sistema…",        delay: 0   },
    { pct: 35,  msg: "Iniciando mapa interativo…", delay: 400 },
    { pct: 58,  msg: "Configurando rotas…",        delay: 850 },
    { pct: 78,  msg: "Preparando exportações…",    delay: 1350 },
    { pct: 92,  msg: "Quase lá…",                  delay: 1800 },
    { pct: 100, msg: "Pronto!",                    delay: 2200 },
  ];

  steps.forEach(({ pct, msg, delay }) => {
    setTimeout(() => {
      fill.style.width  = pct + "%";
      label.textContent = msg;
    }, delay);
  });

  // Após concluir → fade-out e remove do DOM
  setTimeout(() => {
    splash.classList.add("fade-out");
    setTimeout(() => splash.classList.add("gone"), 850);
  }, 2650);
}
