// ============================================================
// FIREBASE IMPORTS
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
    getDatabase,
    ref,
    onValue,
    set,
    push
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";

// ============================================================
// FIREBASE CONFIGURATION
// ============================================================
const firebaseConfig = {
    apiKey: "AIzaSyBa_3EZ0v9NdzW-O0MAOcADv2Y0khY_-1E",
    authDomain: "ecobot-a3421.firebaseapp.com",
    databaseURL: "https://ecobot-a3421-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "ecobot-a3421",
    storageBucket: "ecobot-a3421.firebasestorage.app",
    messagingSenderId: "609307478949",
    appId: "1:609307478949:web:ad8c503dd740e6d1c9f64c"
};

// ============================================================
// INITIALIZE FIREBASE
// ============================================================
let app = null;
let database = null;
let sensorRef = null;
let locationRef = null;
let mappingRef = null;

try {
    app = initializeApp(firebaseConfig);
    database = getDatabase(app);
    sensorRef = ref(database, "ecobot/sensor");
    locationRef = ref(database, "ecobot/location");
    mappingRef = ref(database, "ecobot/mapping");
    console.log("Firebase initialized successfully");
} catch (e) {
    console.error("Firebase init failed:", e);
}

// ============================================================
// HTML ELEMENTS
// ============================================================
const connection = document.getElementById("connection");
const co2 = document.getElementById("co2");
const co2Bar = document.getElementById("co2Bar");
const co2Status = document.getElementById("co2Status");
const temperature = document.getElementById("temperature");
const humidity = document.getElementById("humidity");
const latitude = document.getElementById("latitude");
const longitude = document.getElementById("longitude");
const accuracy = document.getElementById("accuracy");
const device = document.getElementById("device");
const lastUpdate = document.getElementById("lastUpdate");
const gpsStatus = document.getElementById("gpsStatus");
const btnRecenter = document.getElementById("btnRecenter");
const btnToggleGps = document.getElementById("btnToggleGps");

// ============================================================
// GLOBAL STATE
// ============================================================
let latestCO2 = null;
let latestTemperature = null;
let latestHumidity = null;
let latestGPS = null;
let roverMarker = null;
let previousGPS = null;
let routePoints = [];
let routeLine = null;
let watchId = null;

// Initial Map Coordinates (Defaults to Kerala area, auto-centers when GPS arrives)
const INITIAL_LATITUDE = 9.6850;
const INITIAL_LONGITUDE = 76.7740;

// ============================================================
// CREATE LEAFLET MAP
// ============================================================
const map = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: true
}).setView([INITIAL_LATITUDE, INITIAL_LONGITUDE], 16);

// OpenStreetMap dark-tinted or standard tiles
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 20,
    attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

// Custom Rover Icon
const roverIcon = L.divIcon({
    className: 'custom-rover-pin',
    html: `
        <div style="
            width: 32px;
            height: 32px;
            background: linear-gradient(135deg, #06b6d4, #0284c7);
            border: 3px solid #ffffff;
            border-radius: 50%;
            box-shadow: 0 0 16px rgba(6, 182, 212, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            color: #ffffff;
            font-size: 16px;
        ">🤖</div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
});

// ============================================================
// CO₂ COLOR LOGIC
// ============================================================
function getCO2Color(value) {
    if (value < 800) {
        return "#10b981"; // Emerald Normal
    }
    if (value < 1200) {
        return "#f59e0b"; // Amber Moderate
    }
    return "#ef4444"; // Coral High
}

function updateCO2Status(value) {
    if (!co2Status) return;
    if (value < 800) {
        co2Status.textContent = "OPTIMAL";
        co2Status.style.color = "#10b981";
        co2Status.style.background = "rgba(16, 185, 129, 0.15)";
        co2Status.style.borderColor = "#10b981";
    } else if (value < 1200) {
        co2Status.textContent = "MODERATE";
        co2Status.style.color = "#f59e0b";
        co2Status.style.background = "rgba(245, 158, 11, 0.15)";
        co2Status.style.borderColor = "#f59e0b";
    } else {
        co2Status.textContent = "HIGH CO₂";
        co2Status.style.color = "#ef4444";
        co2Status.style.background = "rgba(239, 68, 68, 0.15)";
        co2Status.style.borderColor = "#ef4444";
    }
}

function updateCO2Bar(value) {
    if (!co2Bar) return;
    let percentage = (value / 2000) * 100;
    percentage = Math.max(0, Math.min(100, percentage));
    co2Bar.style.width = percentage + "%";
    co2Bar.style.background = getCO2Color(value);
}

// ============================================================
// MAP VISUALIZATIONS
// ============================================================
function updateRoverMarker(lat, lon) {
    if (roverMarker === null) {
        roverMarker = L.marker([lat, lon], { icon: roverIcon }).addTo(map);
        roverMarker.bindPopup("<strong>🤖 EcoBot Rover</strong><br>Live Position");
        map.setView([lat, lon], 17);
    } else {
        roverMarker.setLatLng([lat, lon]);
    }
}

function addCO2Point(lat, lon, value, timestamp) {
    const color = getCO2Color(value);
    const point = L.circleMarker([lat, lon], {
        radius: 8,
        color: "#ffffff",
        fillColor: color,
        fillOpacity: 0.85,
        weight: 2
    });

    point.bindPopup(`
        <div style="font-family: inherit; font-size: 13px; line-height: 1.6;">
            <div style="font-weight: 700; color: ${color}; margin-bottom: 4px;">🌱 EcoBot Sample</div>
            <strong>CO₂:</strong> ${value} PPM<br>
            <strong>Lat/Lng:</strong> ${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}<br>
            <strong>Time:</strong> ${new Date(timestamp).toLocaleTimeString()}
        </div>
    `);

    point.addTo(map);
}

function updateRoute(lat, lon) {
    routePoints.push([lat, lon]);
    if (routeLine !== null) {
        map.removeLayer(routeLine);
    }
    routeLine = L.polyline(routePoints, {
        color: "#06b6d4",
        weight: 4,
        opacity: 0.7,
        dashArray: "6, 8"
    }).addTo(map);
}

// ============================================================
// SENSOR DATA HANDLER (Used by Firebase & Backend SSE)
// ============================================================
function handleSensorData(data) {
    if (!data) return;

    if (connection) {
        connection.textContent = "● Live Telemetry";
        connection.className = "connection online";
    }

    latestCO2 = Number(data.co2 ?? 0);
    if (co2) co2.textContent = latestCO2;
    updateCO2Status(latestCO2);
    updateCO2Bar(latestCO2);

    latestTemperature = data.temperature ?? null;
    if (temperature) {
        temperature.textContent = (latestTemperature !== null) ? latestTemperature : "--";
    }

    latestHumidity = data.humidity ?? null;
    if (humidity) {
        humidity.textContent = (latestHumidity !== null) ? latestHumidity : "--";
    }

    if (device && data.device) {
        device.textContent = data.device;
    }

    if (lastUpdate) {
        const timeVal = data.lastUpdate ? new Date(data.lastUpdate) : new Date();
        lastUpdate.textContent = timeVal.toLocaleTimeString();
    }

    // Correlate with GPS if available
    createMappingPoint();
}

// ============================================================
// CREATE CO₂ + GPS MAPPING POINT
// ============================================================
async function createMappingPoint() {
    if (latestGPS === null || latestCO2 === null) {
        return;
    }

    // Avoid duplicate points if GPS didn't move
    if (previousGPS && 
        previousGPS.lat === latestGPS.latitude && 
        previousGPS.lon === latestGPS.longitude) {
        return;
    }

    previousGPS = { lat: latestGPS.latitude, lon: latestGPS.longitude };

    const mappingPoint = {
        co2: latestCO2,
        temperature: latestTemperature,
        humidity: latestHumidity,
        latitude: latestGPS.latitude,
        longitude: latestGPS.longitude,
        accuracy: latestGPS.accuracy,
        timestamp: Date.now()
    };

    // Add directly to map
    addCO2Point(
        latestGPS.latitude,
        latestGPS.longitude,
        latestCO2,
        mappingPoint.timestamp
    );

    // Save to Firebase RTDB if connected
    if (mappingRef) {
        try {
            const newPoint = push(mappingRef);
            await set(newPoint, mappingPoint);
            console.log("Mapping point saved to Firebase:", mappingPoint);
        } catch (error) {
            console.warn("Could not save mapping point to Firebase:", error.message);
        }
    }
}

// ============================================================
// PHONE GPS TRACKING
// ============================================================
function startGPS() {
    if (!navigator.geolocation) {
        if (gpsStatus) {
            gpsStatus.textContent = "GPS Not Supported";
            gpsStatus.style.color = "#ef4444";
        }
        return;
    }

    if (gpsStatus) {
        gpsStatus.textContent = "● Requesting GPS...";
    }

    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
    }

    watchId = navigator.geolocation.watchPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            const acc = position.coords.accuracy;

            if (latitude) latitude.textContent = lat.toFixed(6);
            if (longitude) longitude.textContent = lon.toFixed(6);
            if (accuracy) accuracy.textContent = acc.toFixed(1);

            if (gpsStatus) {
                gpsStatus.textContent = "● GPS Active";
                gpsStatus.style.background = "rgba(16, 185, 129, 0.15)";
                gpsStatus.style.color = "#10b981";
                gpsStatus.style.borderColor = "rgba(16, 185, 129, 0.3)";
            }

            updateRoverMarker(lat, lon);
            updateRoute(lat, lon);

            latestGPS = {
                latitude: lat,
                longitude: lon,
                accuracy: acc,
                timestamp: Date.now()
            };

            if (locationRef) {
                try {
                    await set(locationRef, latestGPS);
                } catch (e) {
                    console.warn("Could not sync GPS to Firebase:", e);
                }
            }

            createMappingPoint();
        },
        (error) => {
            console.warn("Geolocation warning:", error.message);
            if (gpsStatus) {
                gpsStatus.textContent = "GPS Inactive / Denied";
                gpsStatus.style.background = "rgba(239, 68, 68, 0.12)";
                gpsStatus.style.color = "#ef4444";
            }
        },
        {
            enableHighAccuracy: true,
            maximumAge: 2000,
            timeout: 10000
        }
    );
}

// ============================================================
// FIREBASE REAL-TIME LISTENERS
// ============================================================
if (sensorRef) {
    onValue(sensorRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            handleSensorData(data);
        }
    }, (err) => {
        console.warn("Firebase sensor listener warning:", err);
    });
}

if (mappingRef) {
    onValue(mappingRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        Object.values(data).forEach(point => {
            if (point.latitude !== undefined && point.longitude !== undefined && point.co2 !== undefined) {
                addCO2Point(
                    Number(point.latitude),
                    Number(point.longitude),
                    Number(point.co2),
                    point.timestamp ?? Date.now()
                );
            }
        });
    }, { onlyOnce: true });
}

// ============================================================
// BACKEND SSE STREAM LISTENER (Zero-latency fallback)
// ============================================================
function initBackendStream() {
    try {
        const eventSource = new EventSource('/api/stream');
        eventSource.addEventListener('sensor_update', (event) => {
            try {
                const data = JSON.parse(event.data);
                handleSensorData(data);
            } catch (e) {
                console.error("SSE parse error", e);
            }
        });
        eventSource.addEventListener('initial_state', (event) => {
            try {
                const data = JSON.parse(event.data);
                handleSensorData(data);
            } catch (e) {}
        });
        eventSource.onerror = () => {
            // Backend offline or running in standalone static mode
            eventSource.close();
        };
    } catch (e) {
        // SSE not supported or not hosted on server
    }
}

// ============================================================
// UI EVENT LISTENERS
// ============================================================
if (btnRecenter) {
    btnRecenter.addEventListener("click", () => {
        if (latestGPS) {
            map.setView([latestGPS.latitude, latestGPS.longitude], 18, { animate: true });
        } else {
            map.setView([INITIAL_LATITUDE, INITIAL_LONGITUDE], 17, { animate: true });
        }
    });
}

if (btnToggleGps) {
    btnToggleGps.addEventListener("click", () => {
        startGPS();
    });
}

// Local simulation fallback for testing in browser directly
window.pushLocalSimulation = function() {
    const mockCO2 = Math.floor(400 + Math.random() * 1100);
    const mockTemp = Number((25 + Math.random() * 6).toFixed(1));
    const mockHum = Number((55 + Math.random() * 25).toFixed(1));
    handleSensorData({
        co2: mockCO2,
        temperature: mockTemp,
        humidity: mockHum,
        device: "Local Simulator",
        lastUpdate: Date.now()
    });
};

// ============================================================
// START APPLICATION
// ============================================================
startGPS();
initBackendStream();
