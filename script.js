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


// ============================================================
// WEATHER API STATE
// ============================================================
let weatherRequestInProgress = false;

let lastWeatherLat = null;
let lastWeatherLon = null;

let lastWeatherUpdate = 0;


// ============================================================
// INITIAL MAP COORDINATES
// Kerala area
// ============================================================
const INITIAL_LATITUDE = 9.6850;
const INITIAL_LONGITUDE = 76.7740;


// ============================================================
// CREATE LEAFLET MAP
// ============================================================
const map = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: true
}).setView(
    [INITIAL_LATITUDE, INITIAL_LONGITUDE],
    16
);


// ============================================================
// OPENSTREETMAP TILES
// ============================================================
L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
        maxZoom: 20,
        attribution: "&copy; OpenStreetMap contributors"
    }
).addTo(map);


// ============================================================
// CUSTOM ROVER ICON
// ============================================================
const roverIcon = L.divIcon({

    className: "custom-rover-pin",

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
        return "#10b981";
    }

    if (value < 1200) {
        return "#f59e0b";
    }

    return "#ef4444";
}


// ============================================================
// CO₂ STATUS
// ============================================================
function updateCO2Status(value) {

    if (!co2Status) return;

    if (value < 800) {

        co2Status.textContent = "OPTIMAL";

        co2Status.style.color = "#10b981";

        co2Status.style.background =
            "rgba(16, 185, 129, 0.15)";

        co2Status.style.borderColor =
            "#10b981";

    } else if (value < 1200) {

        co2Status.textContent = "MODERATE";

        co2Status.style.color = "#f59e0b";

        co2Status.style.background =
            "rgba(245, 158, 11, 0.15)";

        co2Status.style.borderColor =
            "#f59e0b";

    } else {

        co2Status.textContent = "HIGH CO₂";

        co2Status.style.color = "#ef4444";

        co2Status.style.background =
            "rgba(239, 68, 68, 0.15)";

        co2Status.style.borderColor =
            "#ef4444";
    }
}


// ============================================================
// CO₂ PROGRESS BAR
// ============================================================
function updateCO2Bar(value) {

    if (!co2Bar) return;

    let percentage = (value / 2000) * 100;

    percentage = Math.max(
        0,
        Math.min(100, percentage)
    );

    co2Bar.style.width =
        percentage + "%";

    co2Bar.style.background =
        getCO2Color(value);
}


// ============================================================
// UPDATE ROVER MARKER
// ============================================================
function updateRoverMarker(lat, lon) {

    if (roverMarker === null) {

        roverMarker =
            L.marker(
                [lat, lon],
                {
                    icon: roverIcon
                }
            ).addTo(map);

        roverMarker.bindPopup(
            "<strong>🤖 EcoBot Rover</strong><br>Live Position"
        );

        map.setView(
            [lat, lon],
            17
        );

    } else {

        roverMarker.setLatLng(
            [lat, lon]
        );
    }
}


// ============================================================
// ADD CO₂ MAP POINT
// ============================================================
function addCO2Point(
    lat,
    lon,
    value,
    timestamp
) {

    const color =
        getCO2Color(value);

    const point =
        L.circleMarker(
            [lat, lon],
            {
                radius: 8,

                color: "#ffffff",

                fillColor: color,

                fillOpacity: 0.85,

                weight: 2
            }
        );

    point.bindPopup(`
        <div style="
            font-family: inherit;
            font-size: 13px;
            line-height: 1.6;
        ">

            <div style="
                font-weight: 700;
                color: ${color};
                margin-bottom: 4px;
            ">
                🌱 EcoBot Sample
            </div>

            <strong>CO₂:</strong>
            ${value} PPM
            <br>

            <strong>Lat/Lng:</strong>
            ${Number(lat).toFixed(5)},
            ${Number(lon).toFixed(5)}
            <br>

            <strong>Time:</strong>
            ${new Date(timestamp).toLocaleTimeString()}

        </div>
    `);

    point.addTo(map);
}


// ============================================================
// UPDATE ROUTE
// ============================================================
function updateRoute(lat, lon) {

    routePoints.push(
        [lat, lon]
    );

    if (routeLine !== null) {

        map.removeLayer(
            routeLine
        );
    }

    routeLine =
        L.polyline(
            routePoints,
            {
                color: "#06b6d4",

                weight: 4,

                opacity: 0.7,

                dashArray: "6, 8"
            }
        ).addTo(map);
}


// ============================================================
// WEATHER FROM PHONE GPS
// ============================================================
//
// Gets current temperature and relative humidity
// for the PHONE'S GPS coordinates.
//
// Open-Meteo:
// https://api.open-meteo.com/v1/forecast
//
// Updates:
// - Every 5 minutes
// - OR when phone moves ~100 m or more
// ============================================================
async function updateWeatherFromPhoneGPS(
    lat,
    lon
) {

    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon)
    ) {
        return;
    }


    const now = Date.now();


    // Don't request weather more than once
    // every 5 minutes.
    if (
        now - lastWeatherUpdate <
        5 * 60 * 1000
    ) {
        return;
    }


    // If GPS has barely moved,
    // don't request again.
    if (
        lastWeatherLat !== null &&
        lastWeatherLon !== null &&
        Math.abs(lat - lastWeatherLat) < 0.001 &&
        Math.abs(lon - lastWeatherLon) < 0.001
    ) {
        return;
    }


    // Prevent multiple simultaneous requests.
    if (weatherRequestInProgress) {
        return;
    }


    weatherRequestInProgress = true;


    try {

        const url =
            "https://api.open-meteo.com/v1/forecast" +

            "?latitude=" +
            encodeURIComponent(lat) +

            "&longitude=" +
            encodeURIComponent(lon) +

            "&current=temperature_2m,relative_humidity_2m" +

            "&temperature_unit=celsius" +

            "&timezone=auto";


        console.log(
            "Requesting weather for:",
            lat,
            lon
        );


        const response =
            await fetch(url);


        if (!response.ok) {

            throw new Error(
                `Weather API HTTP ${response.status}`
            );
        }


        const weather =
            await response.json();


        const temperatureValue =
            weather.current?.temperature_2m;


        const humidityValue =
            weather.current?.relative_humidity_2m;


        if (
            typeof temperatureValue !== "number" ||
            typeof humidityValue !== "number"
        ) {

            throw new Error(
                "Invalid weather data received"
            );
        }


        // Save latest weather values.
        latestTemperature =
            temperatureValue;

        latestHumidity =
            humidityValue;


        // Update dashboard.
        if (temperature) {

            temperature.textContent =
                temperatureValue.toFixed(1);
        }


        if (humidity) {

            humidity.textContent =
                humidityValue.toFixed(1);
        }


        console.log(
            "Live weather:",
            temperatureValue,
            "°C",
            humidityValue,
            "%"
        );


        // Remember last successful request.
        lastWeatherLat = lat;
        lastWeatherLon = lon;

        lastWeatherUpdate =
            Date.now();


    } catch (error) {

        console.error(
            "Weather API error:",
            error
        );

    } finally {

        weatherRequestInProgress =
            false;
    }
}


// ============================================================
// SENSOR DATA HANDLER
// ============================================================
//
// IMPORTANT:
// Temperature and humidity are NOT taken from
// Firebase sensor data anymore.
//
// They come from Open-Meteo using phone GPS.
// ============================================================
function handleSensorData(data) {

    if (!data) return;


    // Connection status
    if (connection) {

        connection.textContent =
            "● Live Telemetry";

        connection.className =
            "connection online";
    }


    // ========================================================
    // CO₂ SIMULATION
    // ========================================================
    //
    // Your MQ-2 is not a true CO₂ sensor.
    // Therefore we keep the dashboard value
    // between 425 and 445 PPM for demonstration.
    //
    latestCO2 =
        Math.floor(
            425 +
            Math.random() * 21
        );


    if (co2) {

        co2.textContent =
            latestCO2;
    }


    updateCO2Status(
        latestCO2
    );

    updateCO2Bar(
        latestCO2
    );


    // ========================================================
    // TEMPERATURE & HUMIDITY
    // ========================================================
    //
    // DO NOT use:
    //
    // latestTemperature = data.temperature
    // latestHumidity = data.humidity
    //
    // because these may be random simulator values.
    //
    // Open-Meteo supplies these values instead.
    // ========================================================

    if (temperature) {

        temperature.textContent =
            latestTemperature !== null
                ? latestTemperature.toFixed(1)
                : "--";
    }


    if (humidity) {

        humidity.textContent =
            latestHumidity !== null
                ? latestHumidity.toFixed(1)
                : "--";
    }


    // ========================================================
    // DEVICE
    // ========================================================
    if (
        device &&
        data.device
    ) {

        device.textContent =
            data.device;
    }


    // ========================================================
    // LAST UPDATE
    // ========================================================
    if (lastUpdate) {

        const timeVal =
            data.lastUpdate
                ? new Date(data.lastUpdate)
                : new Date();

        lastUpdate.textContent =
            timeVal.toLocaleTimeString();
    }


    // Create mapping point.
    createMappingPoint();
}


// ============================================================
// CREATE CO₂ + WEATHER + GPS MAPPING POINT
// ============================================================
async function createMappingPoint() {

    if (
        latestGPS === null ||
        latestCO2 === null
    ) {
        return;
    }


    // Don't create duplicate points
    // if GPS hasn't moved.
    if (
        previousGPS &&
        previousGPS.lat === latestGPS.latitude &&
        previousGPS.lon === latestGPS.longitude
    ) {

        return;
    }


    previousGPS = {

        lat:
            latestGPS.latitude,

        lon:
            latestGPS.longitude
    };


    const mappingPoint = {

        co2:
            latestCO2,

        temperature:
            latestTemperature,

        humidity:
            latestHumidity,

        latitude:
            latestGPS.latitude,

        longitude:
            latestGPS.longitude,

        accuracy:
            latestGPS.accuracy,

        timestamp:
            Date.now()
    };


    // ========================================================
    // ADD POINT DIRECTLY TO MAP
    // ========================================================
    addCO2Point(

        latestGPS.latitude,

        latestGPS.longitude,

        latestCO2,

        mappingPoint.timestamp
    );


    // ========================================================
    // SAVE TO FIREBASE
    // ========================================================
    if (mappingRef) {

        try {

            const newPoint =
                push(mappingRef);

            await set(
                newPoint,
                mappingPoint
            );

            console.log(
                "Mapping point saved to Firebase:",
                mappingPoint
            );

        } catch (error) {

            console.warn(
                "Could not save mapping point to Firebase:",
                error.message
            );
        }
    }
}


// ============================================================
// CHECK WHETHER DEVICE IS A PHONE
// ============================================================
function isPhoneDevice() {

    return /android|iphone|ipad|ipod|mobile/i
        .test(
            navigator.userAgent
        );
}


// ============================================================
// PHONE GPS TRACKING
// ============================================================
function startGPS() {

    // IMPORTANT:
    // Only the phone should request GPS.
    //
    // Laptop receives phone GPS through Firebase.
    if (!isPhoneDevice()) {

        if (gpsStatus) {

            gpsStatus.textContent =
                "● Waiting for Phone GPS";

            gpsStatus.style.background =
                "rgba(245, 158, 11, 0.12)";

            gpsStatus.style.color =
                "#f59e0b";

            gpsStatus.style.borderColor =
                "rgba(245, 158, 11, 0.3)";
        }

        console.log(
            "Laptop detected. Waiting for phone GPS through Firebase."
        );

        return;
    }


    // ========================================================
    // CHECK GPS SUPPORT
    // ========================================================
    if (!navigator.geolocation) {

        if (gpsStatus) {

            gpsStatus.textContent =
                "GPS Not Supported";

            gpsStatus.style.color =
                "#ef4444";
        }

        return;
    }


    if (gpsStatus) {

        gpsStatus.textContent =
            "● Requesting GPS";
    }


    // Clear previous GPS watcher.
    if (watchId !== null) {

        navigator.geolocation.clearWatch(
            watchId
        );
    }


    // ========================================================
    // START WATCHING PHONE GPS
    // ========================================================
    watchId =
        navigator.geolocation.watchPosition(

            async (position) => {

                const lat =
                    position.coords.latitude;

                const lon =
                    position.coords.longitude;

                const acc =
                    position.coords.accuracy;


                // ==================================================
                // UPDATE PHONE SCREEN
                // ==================================================
                if (latitude) {

                    latitude.textContent =
                        lat.toFixed(6);
                }


                if (longitude) {

                    longitude.textContent =
                        lon.toFixed(6);
                }


                if (accuracy) {

                    accuracy.textContent =
                        acc.toFixed(1);
                }


                // ==================================================
                // GPS STATUS
                // ==================================================
                if (gpsStatus) {

                    gpsStatus.textContent =
                        "● GPS Active";

                    gpsStatus.style.background =
                        "rgba(16, 185, 129, 0.15)";

                    gpsStatus.style.color =
                        "#10b981";

                    gpsStatus.style.borderColor =
                        "rgba(16, 185, 129, 0.3)";
                }


                // ==================================================
                // UPDATE LOCAL MAP
                // ==================================================
                updateRoverMarker(
                    lat,
                    lon
                );

                updateRoute(
                    lat,
                    lon
                );


                // ==================================================
                // SAVE GPS LOCALLY
                // ==================================================
                latestGPS = {

                    latitude:
                        lat,

                    longitude:
                        lon,

                    accuracy:
                        acc,

                    timestamp:
                        Date.now()
                };


                // ==================================================
                // SEND GPS TO FIREBASE
                // ==================================================
                if (locationRef) {

                    try {

                        await set(
                            locationRef,
                            latestGPS
                        );

                        console.log(
                            "Phone GPS sent to Firebase:",
                            latestGPS
                        );

                    } catch (e) {

                        console.warn(
                            "Could not sync GPS to Firebase:",
                            e
                        );
                    }
                }


                // ==================================================
                // GET WEATHER USING PHONE GPS
                // ==================================================
                await updateWeatherFromPhoneGPS(
                    lat,
                    lon
                );


                // ==================================================
                // CREATE MAPPING POINT
                // ==================================================
                createMappingPoint();
            },


            // ======================================================
            // GPS ERROR
            // ======================================================
            (error) => {

                console.warn(
                    "Geolocation warning:",
                    error.message
                );


                if (gpsStatus) {

                    gpsStatus.textContent =
                        "GPS Inactive / Denied";

                    gpsStatus.style.background =
                        "rgba(239, 68, 68, 0.12)";

                    gpsStatus.style.color =
                        "#ef4444";
                }
            },


            // ======================================================
            // GPS OPTIONS
            // ======================================================
            {
                enableHighAccuracy: true,

                maximumAge: 2000,

                timeout: 10000
            }
        );
}


// ============================================================
// FIREBASE PHONE LOCATION LISTENER
// ============================================================
//
// This runs on the LAPTOP.
//
// It receives GPS that the PHONE has already sent
// to Firebase.
// ============================================================
if (locationRef) {

    onValue(

        locationRef,

        async (snapshot) => {

            const data =
                snapshot.val();


            if (!data) {

                return;
            }


            const lat =
                Number(data.latitude);

            const lon =
                Number(data.longitude);

            const acc =
                Number(data.accuracy);


            if (
                !Number.isFinite(lat) ||
                !Number.isFinite(lon)
            ) {

                return;
            }


            // ==================================================
            // SAVE RECEIVED PHONE GPS
            // ==================================================
            latestGPS = {

                latitude:
                    lat,

                longitude:
                    lon,

                accuracy:
                    Number.isFinite(acc)
                        ? acc
                        : 0,

                timestamp:
                    data.timestamp ??
                    Date.now()
            };


            // ==================================================
            // UPDATE LAPTOP UI
            // ==================================================
            if (latitude) {

                latitude.textContent =
                    lat.toFixed(6);
            }


            if (longitude) {

                longitude.textContent =
                    lon.toFixed(6);
            }


            if (accuracy) {

                accuracy.textContent =
                    Number.isFinite(acc)
                        ? acc.toFixed(1)
                        : "--";
            }


            if (gpsStatus) {

                gpsStatus.textContent =
                    "● PHONE GPS RECEIVED";

                gpsStatus.style.background =
                    "rgba(16, 185, 129, 0.15)";

                gpsStatus.style.color =
                    "#10b981";

                gpsStatus.style.borderColor =
                    "rgba(16, 185, 129, 0.3)";
            }


            // ==================================================
            // UPDATE LAPTOP MAP
            // ==================================================
            updateRoverMarker(
                lat,
                lon
            );


            // ==================================================
            // WEATHER USING PHONE LOCATION
            // ==================================================
            await updateWeatherFromPhoneGPS(
                lat,
                lon
            );


            // ==================================================
            // CREATE MAPPING POINT
            // ==================================================
            createMappingPoint();


            console.log(
                "Phone GPS received from Firebase:",
                lat,
                lon
            );
        },


        (err) => {

            console.warn(
                "Firebase location listener warning:",
                err
            );
        }
    );
}


// ============================================================
// FIREBASE SENSOR LISTENER
// ============================================================
if (sensorRef) {

    onValue(

        sensorRef,

        (snapshot) => {

            const data =
                snapshot.val();

            if (data) {

                handleSensorData(
                    data
                );
            }
        },

        (err) => {

            console.warn(
                "Firebase sensor listener warning:",
                err
            );
        }
    );
}


// ============================================================
// FIREBASE MAPPING LISTENER
// ============================================================
if (mappingRef) {

    onValue(

        mappingRef,

        (snapshot) => {

            const data =
                snapshot.val();


            if (!data) return;


            Object.values(data).forEach(
                point => {

                    if (
                        point.latitude !== undefined &&
                        point.longitude !== undefined &&
                        point.co2 !== undefined
                    ) {

                        addCO2Point(

                            Number(point.latitude),

                            Number(point.longitude),

                            Number(point.co2),

                            point.timestamp ??
                            Date.now()
                        );
                    }
                }
            );
        },

        {
            onlyOnce: true
        }
    );
}


// ============================================================
// BACKEND SSE STREAM LISTENER
// ============================================================
function initBackendStream() {

    try {

        const eventSource =
            new EventSource(
                "/api/stream"
            );


        // ======================================================
        // SENSOR UPDATE
        // ======================================================
        eventSource.addEventListener(
            "sensor_update",

            (event) => {

                try {

                    const data =
                        JSON.parse(
                            event.data
                        );

                    handleSensorData(
                        data
                    );

                } catch (e) {

                    console.error(
                        "SSE parse error",
                        e
                    );
                }
            }
        );


        // ======================================================
        // INITIAL STATE
        // ======================================================
        eventSource.addEventListener(
            "initial_state",

            (event) => {

                try {

                    const data =
                        JSON.parse(
                            event.data
                        );

                    handleSensorData(
                        data
                    );

                } catch (e) {

                    console.warn(
                        "SSE initial state error:",
                        e
                    );
                }
            }
        );


        // ======================================================
        // SSE ERROR
        // ======================================================
        eventSource.onerror = () => {

            // Backend offline or
            // static hosting mode.
            eventSource.close();
        };


    } catch (e) {

        // SSE not supported
        // or server not available.
    }
}


// ============================================================
// RECENTER BUTTON
// ============================================================
if (btnRecenter) {

    btnRecenter.addEventListener(
        "click",

        () => {

            if (latestGPS) {

                map.setView(

                    [
                        latestGPS.latitude,

                        latestGPS.longitude
                    ],

                    18,

                    {
                        animate: true
                    }
                );

            } else {

                map.setView(

                    [
                        INITIAL_LATITUDE,

                        INITIAL_LONGITUDE
                    ],

                    17,

                    {
                        animate: true
                    }
                );
            }
        }
    );
}


// ============================================================
// GPS BUTTON
// ============================================================
if (btnToggleGps) {

    btnToggleGps.addEventListener(

        "click",

        () => {

            startGPS();
        }
    );
}


// ============================================================
// LOCAL SIMULATION FALLBACK
// ============================================================
//
// Used only when testing the website manually.
//
// CO₂ = simulated 425–445 PPM
// Temperature/Humidity = NOT random anymore.
//
// Weather will come from phone GPS when available.
// ============================================================
window.pushLocalSimulation =
    function () {

        const mockCO2 =
            Math.floor(
                425 +
                Math.random() * 21
            );


        handleSensorData({

            co2:
                mockCO2,

            device:
                "Local Simulator",

            lastUpdate:
                Date.now()
        });
    };


// ============================================================
// START APPLICATION
// ============================================================
//
// On PHONE:
//     Start GPS
//
// On LAPTOP:
//     Do NOT request GPS.
//     Wait for Firebase phone location.
// ============================================================
startGPS();


// Start backend SSE if available.
initBackendStream();


// ============================================================
// WEATHER AUTO-REFRESH
// ============================================================
//
// If phone stays in the same place,
// refresh weather every 5 minutes.
// ============================================================
setInterval(
    () => {

        if (
            latestGPS &&
            Number.isFinite(
                latestGPS.latitude
            ) &&
            Number.isFinite(
                latestGPS.longitude
            )
        ) {

            // Allow a new request.
            lastWeatherUpdate = 0;

            updateWeatherFromPhoneGPS(

                latestGPS.latitude,

                latestGPS.longitude
            );
        }

    },

    5 * 60 * 1000
);