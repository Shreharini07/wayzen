const MAPTILER_KEY = "Wsc9v8EanmK2CtjmBSGs";

let activeRouteLayers = [];
let routesData = [];
let navigationMarker;
let selectedRouteIndex = null;
let crimePoints = [];
let navigationStarted = false;
let navigationFrame = null;


function speak(message){
    if (!('speechSynthesis' in window)) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = "en-US";
    window.speechSynthesis.speak(utterance);
}



const map = new maplibregl.Map({
    container: 'map',
    style: `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${MAPTILER_KEY}`,
    center: [78.9629, 20.5937],
    zoom: 5,
    pitch: 45
});

map.addControl(new maplibregl.NavigationControl());

map.on('load', () => {
    loadCrime();
});



function updateStatus(msg){
    document.getElementById("statusBar").innerText = msg;
}



function clearRoutes(){

    if(navigationFrame){
        cancelAnimationFrame(navigationFrame);
    }

    activeRouteLayers.forEach(id => {
        try{
            if(map.getLayer(id)) map.removeLayer(id);
            if(map.getSource(id)) map.removeSource(id);
        }catch{}
    });

    activeRouteLayers = [];

    if(navigationMarker){
        navigationMarker.remove();
        navigationMarker = null;
    }
}



async function geocode(place){

    try{

        let url =
            `https://api.maptiler.com/geocoding/${encodeURIComponent(place)}.json?key=${MAPTILER_KEY}`;

        let res = await fetch(url);
        let data = await res.json();

        if(data.features.length){
            return data.features[0].center;
        }

        url =
            `https://api.maptiler.com/geocoding/${encodeURIComponent(place + ", Tamil Nadu")}.json?key=${MAPTILER_KEY}`;

        res = await fetch(url);
        data = await res.json();

        if(data.features.length){
            speak("Location refined using regional context");
            return data.features[0].center;
        }

        url =
            `https://api.maptiler.com/geocoding/${encodeURIComponent(place + " India")}.json?key=${MAPTILER_KEY}`;

        res = await fetch(url);
        data = await res.json();

        if(data.features.length){
            speak("Approximate location match found");
            return data.features[0].center;
        }

        throw "Not found";

    }catch{
        throw "Not found";
    }
}


async function generateRoutes(){

    const btn = document.getElementById("routeBtn");
    btn.disabled = true;
    btn.innerText = "Calculating...";

    const startName = document.getElementById("start").value;
    const endName = document.getElementById("end").value;

    if(!startName || !endName){
        speak("Enter locations");
        resetButton();
        return;
    }

    updateStatus("🧭 Calculating routes");

    try{
        const start = await geocode(startName);
        const end = await geocode(endName);

        await fetchRoutes(start, end);

    }catch{
        speak("Location not found. Try entering full place name.");
        updateStatus("❌ Location not found");
    }

    resetButton();
}

function resetButton(){
    const btn = document.getElementById("routeBtn");
    btn.disabled = false;
    btn.innerText = "Find Routes";
}



async function fetchRoutes(start, end){

    clearRoutes();
    document.getElementById("routes").innerHTML = "";
    routesData = [];

    const res = await fetch("http://127.0.0.1:5000/route", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({start, end})
    });

    const data = await res.json();

    const analyzedRoutes = data.routes.map((coords, index) => {

        const routeId = "route_" + index;

        const analysis = analyzeRouteSafety(coords, routeId);

        return {
            coords,
            score: parseFloat(analysis.score),
            risks: analysis.risks,
            routeId
        };
    });

    analyzedRoutes.sort((a, b) => b.score - a.score);

    routesData = analyzedRoutes;

    routesData.forEach((route, i) => {
        drawRoute(route.coords, i);
        createRouteCard(i, route.score.toFixed(1), route.risks);
    });

    fitMap(routesData[0].coords);

    updateStatus("✅ Routes Ready");   
    speak("Routes ranked by safety");
}



function analyzeRouteSafety(coords, routeId){

    let penalty = 0;
    let risks = 0;

    coords.forEach(routePoint => {

        crimePoints.forEach(crime => {

            const dist = getDistance(
                routePoint[1], routePoint[0],
                crime.lat, crime.lng
            );

            if(dist < 0.2){
                penalty += 1.5;
                risks++;
            }
            else if(dist < 0.5){
                penalty += 0.7;
            }
        });
    });

    penalty += getFeedbackAdjustment(routeId);

    let score = (10 - penalty).toFixed(1);
    score = Math.max(1, Math.min(10, score));

    return {score, risks};
}

function getDistance(lat1, lon1, lat2, lon2){

    const R = 6371;
    const dLat = (lat2-lat1) * Math.PI/180;
    const dLon = (lon2-lon1) * Math.PI/180;

    const a =
        Math.sin(dLat/2) ** 2 +
        Math.cos(lat1*Math.PI/180) *
        Math.cos(lat2*Math.PI/180) *
        Math.sin(dLon/2) ** 2;

    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}



function storeFeedback(routeId, rating){

    let feedbackData =
        JSON.parse(localStorage.getItem("routeFeedback")) || {};

    if(!feedbackData[routeId]){
        feedbackData[routeId] = [];
    }

    feedbackData[routeId].push(rating);

    localStorage.setItem(
        "routeFeedback",
        JSON.stringify(feedbackData)
    );
}

function getFeedbackAdjustment(routeId){

    const feedbackData =
        JSON.parse(localStorage.getItem("routeFeedback")) || {};

    if(!feedbackData[routeId]) return 0;

    let penalty = 0;

    feedbackData[routeId].forEach(r => {

        if(r === "Poor") penalty += 1.5;
        else if(r === "Bad") penalty += 1.0;
        else if(r === "Fair") penalty += 0.3;
        else if(r === "Good") penalty -= 0.2;
    });

    return penalty;
}



function drawRoute(coords, id){

    const sourceId = `route-${id}`;

    if(map.getSource(sourceId)) return;

    map.addSource(sourceId, {
        type: "geojson",
        data: {
            type: "Feature",
            geometry: {type: "LineString", coordinates: coords}
        }
    });

    const color = id === 0 ? "#22c55e" : "#f97316";

    map.addLayer({
        id: sourceId,
        type: "line",
        source: sourceId,
        paint: {
            "line-color": color,
            "line-width": id === 0 ? 6 : 4
        }
    });

    activeRouteLayers.push(sourceId);
}



function fitMap(coords){
    const bounds = coords.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(coords[0], coords[0])
    );
    map.fitBounds(bounds, {padding: 60});
}



function createRouteCard(index, score, risks){

    const card = document.createElement("div");
    card.className = "route-card";

    card.innerHTML = `
        <h3>Route ${index + 1}</h3>
        <p>🛡 Score: <b>${score}</b></p>
        <p>⚠ Risk Zones: ${risks}</p>
    `;

    card.onclick = () => startJourney(index);
    document.getElementById("routes").appendChild(card);
}



function startJourney(index){

    if(!routesData[index]) return;

    navigationStarted = true;
    selectedRouteIndex = index;

    updateStatus("🧭 Navigation Active");   
    speak("Navigation started");            
    const coords = routesData[index].coords;

    if(navigationMarker) navigationMarker.remove();

    navigationMarker = new maplibregl.Marker()
        .setLngLat(coords[0])
        .addTo(map);

    smoothNavigate(coords);
}

function smoothNavigate(coords){

    if(navigationFrame){
        cancelAnimationFrame(navigationFrame);
    }

    let segmentIndex = 0;
    let progress = 0;
    let voiceCounter = 0;

    const speed = 0.0005;

    function animate(){

        if(segmentIndex >= coords.length - 1){

            updateStatus("✅ Destination Reached");   
            speak("Destination reached");

            document.getElementById("surveyModal").style.display = "block";

            navigationStarted = false;
            return;
        }

        const start = coords[segmentIndex];
        const end = coords[segmentIndex + 1];

        progress += speed;
        voiceCounter++;

        if(progress >= 1){
            progress = 0;
            segmentIndex++;
        }

        const lng = start[0] + (end[0] - start[0]) * progress;
        const lat = start[1] + (end[1] - start[1]) * progress;

        const position = [lng, lat];

        navigationMarker.setLngLat(position);

        map.easeTo({
            center: position,
            zoom: 16,
            duration: 300
        });

        if(voiceCounter % 600 === 0){
            speak("Monitoring route safety");
        }

        navigationFrame = requestAnimationFrame(animate);
    }

    animate();
}



async function loadCrime(){

    const res = await fetch("http://127.0.0.1:5000/crime");
    const data = await res.json();

    crimePoints = data.data;

    data.data.forEach(point => {

        const el = document.createElement("div");
        el.className = "danger-zone";

        new maplibregl.Marker({element: el})
            .setLngLat([point.lng, point.lat])
            .addTo(map);
    });
}



function triggerSOS(){
    document.getElementById("sosModal").style.display = "block";
    speak("Emergency mode activated");
}

function closeSOS(){
    document.getElementById("sosModal").style.display = "none";
}



async function submitSurvey(){

    if(selectedRouteIndex === null){
        alert("Navigation required");
        return;
    }

    const rating = document.getElementById("rating").value;
    const feedback = document.getElementById("feedback").value;

    if(!rating){
        alert("Select rating");
        return;
    }

    storeFeedback("route_" + selectedRouteIndex, rating);

    await fetch("http://127.0.0.1:5000/feedback", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            routeId: "route_" + selectedRouteIndex,
            rating,
            feedback
        })
    });

    document.getElementById("surveyModal").style.display = "none";

    selectedRouteIndex = null;

    speak("Feedback recorded");
    updateStatus("✅ Community feedback recorded");
}