# 🌱 EcoBot - IoT Environmental Rover & Live Web Dashboard (FastAPI)

A lightweight, portable IoT environmental monitoring platform combining an ESP32 microcontroller, an MQ-135 CO₂ air quality sensor, a Python **FastAPI** backend ingestion bridge, and a real-time web dashboard synchronized with Firebase Realtime Database.

---

## 📐 System Architecture

```
                       ┌────────────────────────┐
                       │  ESP32 + MQ-135 Sensor │
                       └───────────┬────────────┘
                                   │
                    HTTP POST      │      Direct HTTPS REST
                 /api/sensor       │      (Optional Fallback)
                                   ▼                  │
              ┌───────────────────────────┐           │
              │  Python FastAPI Backend   │           │
              │         (main.py)         │           │
              └─────────────┬─────────────┘           │
                            │                         │
                   PATCH    │                         │
              ecobot/sensor │                         │
                            ▼                         ▼
              ┌─────────────────────────────────────────┐
              │      Firebase Realtime Database         │
              │ (ecobot/sensor, location, mapping)      │
              └─────────────────────┬───────────────────┘
                                    │
                                    │ WebSocket / onValue()
                                    ▼
              ┌─────────────────────────────────────────┐
              │     EcoBot Live Web Dashboard (UI)      │
              │  - Real-time CO₂ Gauge & Status Pill    │
              │  - Temperature & Humidity Telemetry     │
              │  - Leaflet Map with Breadcrumb Trail    │
              │  - Mobile GPS Sync & Rover Pin          │
              └─────────────────────────────────────────┘
```

---

## ⚡ Quick Start: Running the Backend

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Run the FastAPI Server
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
The server will start at:
- Web Dashboard: **`http://localhost:8000`**
- Interactive Swagger API Docs: **`http://localhost:8000/docs`**
- Health Check: **`http://localhost:8000/api/health`**

---

## 🔌 Hardware Wiring Guide

| Sensor Pin (MQ-135) | ESP32 Pin | Notes |
| :--- | :--- | :--- |
| **VCC** | **5V (VIN)** | The MQ-135 internal heater requires 5V to reach thermal equilibrium. |
| **GND** | **GND** | Common ground with ESP32. |
| **AOUT** (Analog Out) | **GPIO 34** | ESP32 ADC1 Channel 6 (Safe to use simultaneously with WiFi). |
| **DOUT** (Digital Out) | **GPIO 27** | Digital high threshold comparator output. |

> [!TIP]
> **MQ-135 Pre-Heating & Calibration:**
> New MQ-135 sensors require 24–48 hours of pre-heating burn-in time for accurate chemical stabilization. For quick testing, allow 5–10 minutes after powering on before taking baseline readings.
> In clean outdoor air, baseline atmospheric CO₂ is approximately **400–420 PPM**.

---

## 💻 ESP32 Firmware Setup

1. Open **Arduino IDE**.
2. Open [`EcoBot_ESP32.ino`](file:///c:/Users/Antony/Documents/PROJECTS/HENRY%20PROJECT/ECOBOT/EcoBot_ESP32.ino) (or copy from [`arduino.txt`](file:///c:/Users/Antony/Documents/PROJECTS/HENRY%20PROJECT/ECOBOT/arduino.txt)).
3. Update WiFi credentials in lines 33–34:
   ```cpp
   const char* WIFI_SSID     = "Your_WiFi_Name";
   const char* WIFI_PASSWORD = "Your_WiFi_Password";
   ```
4. Set the backend URL to your computer's local network IP address (run `ipconfig` in cmd to find your IPv4):
   ```cpp
   const char* BACKEND_URL = "http://192.168.1.XX:8000/api/sensor";
   ```
   *(Or set `TRANSMIT_MODE = MODE_FIREBASE_DIRECT` if you want the ESP32 to talk directly to Firebase over the cloud without the local server!)*
5. In Arduino IDE under **Tools**:
   - **Board**: `ESP32 Dev Module`
   - **Upload Speed**: `921600`
   - **Port**: Select your ESP32 COM port
6. Click **Upload**. Open **Tools -> Serial Monitor** at **`115200 baud`** to verify WiFi connection and sensor transmissions.

---

## 📡 Backend API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/sensor` | Ingests telemetry from ESP32 and syncs to Firebase Realtime Database |
| `GET` | `/api/sensor` | Returns current cached sensor telemetry |
| `POST` | `/api/simulate`| Generates randomized environmental telemetry for testing |
| `GET` | `/api/health` | Service health check and Firebase connectivity status |
| `GET` | `/docs` | Interactive Swagger OpenAPI documentation |
