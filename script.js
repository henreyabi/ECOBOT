```javascript
// ============================================================
// FIREBASE IMPORTS
// ============================================================

import { initializeApp }
    from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";


import {

    getDatabase,
    ref,
    onValue,
    set,
    push

}
from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";



// ============================================================
// FIREBASE CONFIGURATION
// ============================================================

const firebaseConfig = {

    apiKey:
        "AIzaSyBa_3EZ0v9NdzW-O0MAOcADv2Y0khY_-1E",

    authDomain:
        "lpgdet-5c3cc.firebaseapp.com",

    databaseURL:
        "https://lpgdet-5c3cc-default-rtdb.asia-southeast1.firebasedatabase.app",

    projectId:
        "lpgdet-5c3cc",

    storageBucket:
        "lpgdet-5c3cc.firebasestorage.app",

    messagingSenderId:
        "609307478949",

    appId:
        "1:609307478949:web:ad8c503dd740e6d1c9f64c"

};



// ============================================================
// INITIALIZE FIREBASE
// ============================================================

const app =
    initializeApp(firebaseConfig);


const database =
    getDatabase(app);



// ============================================================
// FIREBASE DATABASE REFERENCES
// ============================================================

// ESP32 CO₂ data

const sensorRef =
    ref(
        database,
        "ecobot/sensor"
    );


// Phone GPS data

const locationRef =
    ref(
        database,
        "ecobot/location"
    );


// Combined CO₂ + GPS mapping

const mappingRef =
    ref(
        database,
        "ecobot/mapping"
    );



// ============================================================
// HTML ELEMENTS
// ============================================================

const connection =
    document.getElementById("connection");


const co2 =
    document.getElementById("co2");


const co2Bar =
    document.getElementById("co2Bar");


const co2Status =
    document.getElementById("co2Status");


const temperature =
    document.getElementById("temperature");


const humidity =
    document.getElementById("humidity");


const latitude =
    document.getElementById("latitude");


const longitude =
    document.getElementById("longitude");


const accuracy =
    document.getElementById("accuracy");


const device =
    document.getElementById("device");


const lastUpdate =
    document.getElementById("lastUpdate");


const gpsStatus =
    document.getElementById("gpsStatus");



// ============================================================
// GLOBAL VARIABLES
// ============================================================

let latestCO2 = null;

let latestTemperature = null;

let latestHumidity = null;

let latestGPS = null;

let roverMarker = null;

let previousGPS = null;



// ============================================================
// INITIAL MAP LOCATION
// ============================================================
//
// Change these coordinates to the area where the rover
// will operate.
//
// Example:
// Kerala / Erattupetta area.
//
// The map itself will NOT automatically move.
//

const INITIAL_LATITUDE =
    9.6850;


const INITIAL_LONGITUDE =
    76.7740;



// ============================================================
// CREATE MAP
// ============================================================

const map = L.map(

    "map",

    {

        zoomControl: true,

        scrollWheelZoom: true

    }

).setView(

    [

        INITIAL_LATITUDE,

        INITIAL_LONGITUDE

    ],

    17

);



// ============================================================
// OPEN STREET MAP
// ============================================================

L.tileLayer(

    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",

    {

        maxZoom: 20,

        attribution:
            "&copy; OpenStreetMap contributors"

    }

).addTo(map);



// ============================================================
// CO₂ COLOR FUNCTION
// ============================================================

function getCO2Color(value) {


    if (value < 800) {

        return "#2ca45b";

    }


    if (value < 1200) {

        return "#e7ad26";

    }


    return "#df3737";

}



// ============================================================
// UPDATE CO₂ STATUS
// ============================================================

function updateCO2Status(value) {


    if (value < 800) {

        co2Status.textContent =
            "NORMAL";

        co2Status.style.color =
            "#24944d";

        return;

    }


    if (value < 1200) {

        co2Status.textContent =
            "MODERATE";

        co2Status.style.color =
            "#c18b00";

        return;

    }


    co2Status.textContent =
        "HIGH CO₂";

    co2Status.style.color =
        "#d52f2f";

}



// ============================================================
// UPDATE CO₂ BAR
// ============================================================

function updateCO2Bar(value) {


    let percentage =
        (value / 2000) * 100;


    percentage =
        Math.max(

            0,

            Math.min(
                100,
                percentage
            )

        );


    co2Bar.style.width =
        percentage + "%";


    co2Bar.style.background =
        getCO2Color(value);

}



// ============================================================
// UPDATE ROVER MARKER
// ============================================================

function updateRoverMarker(
    lat,
    lon
) {


    if (roverMarker === null) {


        // Create marker first time

        roverMarker =
            L.marker(

                [

                    lat,
                    lon

                ]

            ).addTo(map);


        roverMarker.bindPopup(

            "<strong>🤖 EcoBot Rover</strong>"

        );


    }


    else {


        // Move existing marker

        roverMarker.setLatLng(

            [

                lat,
                lon

            ]

        );

    }

}



// ============================================================
// ADD CO₂ POINT TO MAP
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

            [

                lat,
                lon

            ],

            {

                radius: 7,

                color: color,

                fillColor: color,

                fillOpacity: 0.75,

                weight: 2

            }

        );


    point.bindPopup(

        `

        <div>

            <strong>🌱 EcoBot Reading</strong>

            <br><br>

            <strong>CO₂:</strong>
            ${value} ppm

            <br>

            <strong>Latitude:</strong>
            ${Number(lat).toFixed(6)}

            <br>

            <strong>Longitude:</strong>
            ${Number(lon).toFixed(6)}

            <br>

            <strong>Time:</strong>
            ${new Date(timestamp).toLocaleTimeString()}

        </div>

        `

    );


    point.addTo(map);

}



// ============================================================
// DRAW ROUTE LINE
// ============================================================

let routePoints = [];


let routeLine = null;



function updateRoute(

    lat,
    lon

) {


    routePoints.push(

        [

            lat,
            lon

        ]

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

                weight: 4,

                opacity: 0.7

            }

        ).addTo(map);

}



// ============================================================
// SAVE GPS
// ============================================================

async function saveGPS(

    lat,
    lon,
    acc

) {


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


    try {


        await set(

            locationRef,

            latestGPS

        );


        console.log(
            "GPS saved",
            latestGPS
        );


    }


    catch (error) {


        console.error(
            "GPS Firebase error:",
            error
        );


    }


    // Create combined measurement

    createMappingPoint();

}



// ============================================================
// CREATE CO₂ + GPS MAPPING POINT
// ============================================================

async function createMappingPoint() {


    if (

        latestGPS === null ||

        latestCO2 === null

    ) {

        return;

    }



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



    try {


        const newPoint =
            push(mappingRef);


        await set(

            newPoint,

            mappingPoint

        );


        console.log(
            "Mapping point saved:",
            mappingPoint
        );


    }


    catch (error) {


        console.error(
            "Mapping error:",
            error
        );


    }

}



// ============================================================
// READ ESP32 SENSOR DATA
// ============================================================

onValue(

    sensorRef,

    (snapshot) => {


        const data =
            snapshot.val();


        console.log(
            "ESP32 DATA:",
            data
        );


        if (!data) {


            connection.textContent =
                "● No sensor data";


            connection.className =
                "connection offline";


            return;

        }



        // ====================================================
        // CO₂
        // ====================================================

        latestCO2 =
            Number(
                data.co2 ?? 0
            );


        co2.textContent =
            latestCO2;


        updateCO2Status(
            latestCO2
        );


        updateCO2Bar(
            latestCO2
        );



        // ====================================================
        // TEMPERATURE
        // ====================================================

        latestTemperature =
            data.temperature ?? null;


        temperature.textContent =
            data.temperature ?? "--";



        // ====================================================
        // HUMIDITY
        // ====================================================

        latestHumidity =
            data.humidity ?? null;


        humidity.textContent =
            data.humidity ?? "--";



        // ====================================================
        // DEVICE
        // ====================================================

        device.textContent =
            data.device ??
            "EcoBot Rover";



        // ====================================================
        // CONNECTION
        // ====================================================

        connection.textContent =
            "● Firebase Connected";


        connection.className =
            "connection online";



        // ====================================================
        // LAST UPDATE
        // ====================================================

        if (data.lastUpdate) {


            lastUpdate.textContent =

                new Date(
                    data.lastUpdate
                ).toLocaleTimeString();

        }


        else {


            lastUpdate.textContent =
                new Date().toLocaleTimeString();

        }



        // ====================================================
        // CREATE MAPPING POINT
        // ====================================================

        createMappingPoint();

    },


    (error) => {


        console.error(
            "Firebase error:",
            error
        );


        connection.textContent =
            "● Firebase Error";


        connection.className =
            "connection offline";

    }

);



// ============================================================
// LOAD EXISTING MAPPING DATA
// ============================================================

onValue(

    mappingRef,

    (snapshot) => {


        const data =
            snapshot.val();


        if (!data) {

            return;

        }



        console.log(
            "Historical mapping:",
            data
        );



        Object.values(data).forEach(

            point => {


                if (

                    point.latitude === undefined ||

                    point.longitude === undefined ||

                    point.co2 === undefined

                ) {

                    return;

                }



                addCO2Point(

                    Number(
                        point.latitude
                    ),

                    Number(
                        point.longitude
                    ),

                    Number(
                        point.co2
                    ),

                    point.timestamp ??
                    Date.now()

                );

            }

        );

    }

);



// ============================================================
// PHONE GPS
// ============================================================

function startGPS() {


    if (
        !navigator.geolocation
    ) {


        gpsStatus.textContent =
            "GPS Not Supported";


        return;

    }



    gpsStatus.textContent =
        "Requesting GPS...";



    navigator.geolocation.watchPosition(

        async (position) => {


            const lat =
                position.coords.latitude;


            const lon =
                position.coords.longitude;


            const acc =
                position.coords.accuracy;



            console.log(

                "GPS:",
                lat,
                lon,
                acc

            );



            // ================================================
            // DISPLAY GPS
            // ================================================

            latitude.textContent =
                lat.toFixed(6);


            longitude.textContent =
                lon.toFixed(6);


            accuracy.textContent =
                acc.toFixed(1);



            // ================================================
            // GPS STATUS
            // ================================================

            gpsStatus.textContent =
                "● GPS Active";


            gpsStatus.style.background =
                "#e3f7eb";


            gpsStatus.style.color =
                "#208348";



            // ================================================
            // ROVER MARKER
            // ================================================

            updateRoverMarker(
                lat,
                lon
            );



            // ================================================
            // ROUTE
            // ================================================

            updateRoute(
                lat,
                lon
            );



            // ================================================
            // SAVE GPS
            // ================================================

            await saveGPS(

                lat,
                lon,
                acc

            );

        },


        (error) => {


            console.error(
                "GPS ERROR:",
                error
            );


            gpsStatus.textContent =
                "GPS Error";


            gpsStatus.style.background =
                "#fdeaea";


            gpsStatus.style.color =
                "#c53030";

        },


        {

            enableHighAccuracy:
                true,

            maximumAge:
                1000,

            timeout:
                10000

        }

    );

}



// ============================================================
// START GPS
// ============================================================

startGPS();
```
