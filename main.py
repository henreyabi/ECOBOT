import os
import time
import random
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import httpx
from dotenv import load_dotenv

# Load environment variables
load_dotenv(override=True)

PORT = int(os.getenv("PORT", "8000"))

def get_firebase_url() -> str:
    """Dynamically read the Firebase URL from .env on each request"""
    load_dotenv(override=True)
    return os.getenv(
        "FIREBASE_DB_URL",
        "https://ecobot-a3421-default-rtdb.asia-southeast1.firebasedatabase.app"
    ).rstrip("/")

# Server start timestamp for uptime calculation
START_TIME = time.time()

# In-memory cache of latest telemetry
latest_sensor_data = {
    "co2": 450,
    "temperature": 27.5,
    "humidity": 62.0,
    "device": "EcoBot Rover (Standby)",
    "lastUpdate": int(time.time() * 1000)
}

# Lifespan context manager for shared HTTP client
http_client: Optional[httpx.AsyncClient] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client
    http_client = httpx.AsyncClient(timeout=10.0)
    print("=" * 60)
    print(f"[EcoBot] FastAPI Server running on http://0.0.0.0:{PORT}")
    print(f"[ESP32]  Ingestion Endpoint: POST http://<YOUR_IP>:{PORT}/api/sensor")
    print(f"[Firebase] Target: {get_firebase_url()}/ecobot/sensor.json")
    print("=" * 60)
    yield
    await http_client.aclose()

app = FastAPI(
    title="EcoBot IoT Backend",
    description="FastAPI ingestion bridge between ESP32 and Firebase Realtime Database",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for all origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# PYDANTIC SCHEMAS
# ============================================================
class SensorPayload(BaseModel):
    co2: Optional[float] = None
    rawADC: Optional[float] = None
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    device: Optional[str] = "EcoBot ESP32 Rover"

# ============================================================
# FIREBASE SYNC HELPER
# ============================================================
async def sync_to_firebase(path: str, data: dict, method: str = "PATCH") -> bool:
    """Send JSON data to Firebase Realtime Database REST API"""
    if not http_client:
        return False
    
    db_url = get_firebase_url()
    url = f"{db_url}/{path.strip('/')}.json"
    try:
        if method.upper() == "PATCH":
            resp = await http_client.patch(url, json=data)
        elif method.upper() == "PUT":
            resp = await http_client.put(url, json=data)
        elif method.upper() == "POST":
            resp = await http_client.post(url, json=data)
        else:
            resp = await http_client.patch(url, json=data)
            
        if resp.is_success:
            print(f"[FastAPI -> Firebase] Sync successful to {path}")
            return True
        else:
            print(f"[FastAPI -> Firebase Error] HTTP {resp.status_code}: {resp.text}")
            return False
    except Exception as e:
        print(f"[FastAPI -> Firebase Exception] {str(e)}")
        return False

# ============================================================
# API ROUTES
# ============================================================

@app.post("/api/sensor")
async def ingest_sensor_data(payload: SensorPayload):
    """
    Ingest live telemetry from ESP32, store in memory,
    and persist directly to Firebase Realtime Database.
    """
    global latest_sensor_data
    
    co2_val = payload.co2 if payload.co2 is not None else payload.rawADC
    if co2_val is None:
        raise HTTPException(status_code=400, detail="Missing required field: 'co2' or 'rawADC'")
    
    formatted_data = {
        "co2": int(co2_val),
        "temperature": round(payload.temperature, 1) if payload.temperature is not None else None,
        "humidity": round(payload.humidity, 1) if payload.humidity is not None else None,
        "device": payload.device or "EcoBot ESP32 Rover",
        "lastUpdate": int(time.time() * 1000)
    }
    
    latest_sensor_data = formatted_data
    
    print(f"[ESP32 -> FastAPI] CO2: {formatted_data['co2']} PPM | "
          f"Temp: {formatted_data['temperature']} C | "
          f"Hum: {formatted_data['humidity']}%")
    
    # Asynchronously save to Firebase RTDB
    await sync_to_firebase("ecobot/sensor", formatted_data)
    
    return {
        "status": "success",
        "message": "Telemetry received and synced to Firebase",
        "data": formatted_data
    }

@app.get("/api/sensor")
async def get_latest_sensor_data():
    """Return the current cached telemetry"""
    return latest_sensor_data

@app.post("/api/simulate")
async def simulate_reading():
    """
    Generate a realistic simulated sensor reading and push to Firebase.
    Ideal for testing the web UI and pipeline without hardware.
    """
    global latest_sensor_data
    
    mock_payload = {
        "co2": random.randint(400, 1450),
        "temperature": round(random.uniform(24.0, 32.0), 1),
        "humidity": round(random.uniform(50.0, 78.0), 1),
        "device": "EcoBot FastAPI Simulator",
        "lastUpdate": int(time.time() * 1000)
    }
    
    latest_sensor_data = mock_payload
    print(f"[Simulator] Generated: CO2: {mock_payload['co2']} PPM, Temp: {mock_payload['temperature']} C")
    
    await sync_to_firebase("ecobot/sensor", mock_payload)
    
    return {
        "status": "success",
        "message": "Simulated reading pushed to Firebase",
        "data": mock_payload
    }

@app.get("/api/health")
async def health_check():
    """System health check and verify Firebase connectivity"""
    firebase_status = "unknown"
    db_url = get_firebase_url()
    if http_client:
        try:
            check_resp = await http_client.get(f"{db_url}/.json?shallow=true")
            firebase_status = "connected" if check_resp.is_success else f"status_{check_resp.status_code}"
        except Exception as e:
            firebase_status = f"error_{str(e)}"
            
    return {
        "status": "healthy",
        "framework": "FastAPI",
        "uptime_seconds": round(time.time() - START_TIME, 1),
        "firebase_configured": bool(db_url),
        "firebase_url": db_url,
        "firebase_status": firebase_status,
        "timestamp": int(time.time() * 1000)
    }

# ============================================================
# SERVE FRONTEND STATIC FILES
# ============================================================
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))

@app.get("/")
async def serve_index():
    return FileResponse(os.path.join(CURRENT_DIR, "index.html"))

# Mount CSS, JS, and other static assets
app.mount("/", StaticFiles(directory=CURRENT_DIR, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=True)
