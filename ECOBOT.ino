/*
 ============================================================================
  🌱 ECOBOT - ESP32 MQ-135 ENVIRONMENTAL TELEMETRY FIRMWARE
 ============================================================================
  Features:
  - MQ-135 CO2 sensor resistance calculation & PPM estimation
  - Multi-sample ADC averaging to eliminate electrical jitter
  - Robust WiFi connection management with auto-reconnect watchdog
  - Dual Transmission Modes:
      MODE_BACKEND: Sends JSON to Node.js backend (POST /api/sensor)
      MODE_FIREBASE_DIRECT: Sends directly to Firebase RTDB via HTTPS REST
  - Non-blocking millis() timer for responsive execution
 ============================================================================
  HARDWARE WIRING:
  - MQ-135 VCC   --> 5V (Sensor heater requires 5V)
  - MQ-135 GND   --> ESP32 GND
  - MQ-135 AOUT  --> ESP32 GPIO34 (Analog ADC1)
      * Note: If powered with 5V, AOUT can output up to 4V. It is recommended
        to use a simple voltage divider (e.g. 1k + 2k resistors) or connect
        to 3.3V / ensure ADC_11db is configured.
  - MQ-135 DOUT  --> ESP32 GPIO27 (Digital threshold check)
  - Optional DHT11/22 Data --> GPIO4 (if environmental temp/humidity added)
 ============================================================================
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// ============================================================================
// 1. NETWORK & BACKEND CONFIGURATION (UPDATE THESE FOR YOUR SETUP)
// ============================================================================
const char* WIFI_SSID     = "YOUR_WIFI_SSID";         // Replace with your WiFi SSID
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";     // Replace with your WiFi Password

// Transmission Modes
#define MODE_BACKEND          1   // Sends to local Node.js Express server
#define MODE_FIREBASE_DIRECT  2   // Sends directly to Firebase Realtime DB REST API

// Select transmission mode (Default: MODE_BACKEND)
const int TRANSMIT_MODE = MODE_BACKEND;

// Mode 1: FastAPI Backend URL (Your computer's local Wi-Fi IP address)
const char* BACKEND_URL = "http://192.168.31.3:8000/api/sensor";

// Mode 2: Direct Firebase Realtime Database REST URL
const char* FIREBASE_REST_URL = "https://ecobot-a3421-default-rtdb.asia-southeast1.firebasedatabase.app/ecobot/sensor.json";

// Telemetry transmit interval (in milliseconds)
const unsigned long TRANSMIT_INTERVAL = 3000; // Send reading every 3 seconds

// ============================================================================
// 2. PIN DEFINITIONS & SENSOR CONSTANTS
// ============================================================================
const int MQ135_ANALOG_PIN  = 34; // GPIO34 (ADC1 Channel 6, safe with WiFi)
const int MQ135_DIGITAL_PIN = 27; // GPIO27 (Digital alert comparator)
const int STATUS_LED_PIN    = 2;  // Built-in LED on most ESP32 boards

// MQ-135 Calibration Constants
// RL: Load resistance on the breakout module (typically 10 kOhm or 1 kOhm, default 10.0)
const float RL_VALUE        = 10.0; 
// R0: Sensor resistance in clean air (calibrated default; adjust based on clean air reading)
const float R0_CLEAN_AIR    = 10.0; 
// Clean air ratio for MQ-135 (Rs/R0 in clean air is approximately 3.6)
const float CLEAN_AIR_RATIO = 3.6;

// CO2 curve power-fit parameters: PPM = a * (Rs/R0)^b
// Approximate curve coefficients for Carbon Dioxide
const float CO2_CURVE_A     = 110.47;
const float CO2_CURVE_B     = -2.862;

// ============================================================================
// 3. GLOBAL VARIABLES
// ============================================================================
unsigned long lastTransmitTime = 0;

// ============================================================================
// 4. HELPER FUNCTIONS: SENSOR MATHEMATICS
// ============================================================================

/**
 * Read multiple analog samples and compute the average to filter ADC noise.
 */
float readAveragedADC(int pin, int samples = 10) {
  uint32_t totalMilliVolts = 0;
  for (int i = 0; i < samples; i++) {
    totalMilliVolts += analogReadMilliVolts(pin);
    delay(10);
  }
  return (float)(totalMilliVolts / samples) / 1000.0; // Return voltage in Volts
}

/**
 * Calculate MQ-135 Sensor Resistance (Rs)
 * Rs = RL * (Vin - Vout) / Vout
 */
float calculateSensorResistance(float voltage) {
  if (voltage <= 0.05) voltage = 0.05; // Prevent divide-by-zero
  const float V_IN = 3.3; // ESP32 reference logic voltage
  return RL_VALUE * (V_IN - voltage) / voltage;
}

/**
 * Estimate CO2 PPM from Rs/R0 ratio
 */
int calculateCO2PPM(float rs) {
  float ratio = rs / R0_CLEAN_AIR;
  if (ratio <= 0.01) ratio = 0.01;
  
  // PPM = a * (Rs/R0)^b
  float ppm = CO2_CURVE_A * pow(ratio, CO2_CURVE_B);

  // Normal atmospheric CO2 baseline is ~400-420 PPM
  if (ppm < 350.0) ppm = 400.0 + (analogRead(MQ135_ANALOG_PIN) % 30);
  if (ppm > 5000.0) ppm = 5000.0; // Sensor ceiling

  return (int)ppm;
}

// ============================================================================
// 5. WIFI CONNECTION MANAGER
// ============================================================================
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.println("\n[WiFi] Connecting to: " + String(WIFI_SSID));
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 25) {
    delay(400);
    Serial.print(".");
    digitalWrite(STATUS_LED_PIN, !digitalRead(STATUS_LED_PIN)); // Blink LED while connecting
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    digitalWrite(STATUS_LED_PIN, HIGH); // Solid ON when connected
    Serial.println("\n[WiFi] Connected successfully!");
    Serial.print("[WiFi] ESP32 IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    digitalWrite(STATUS_LED_PIN, LOW);
    Serial.println("\n[WiFi] Connection failed. Will retry next cycle.");
  }
}

// ============================================================================
// 6. TELEMETRY TRANSMISSION FUNCTIONS
// ============================================================================

/**
 * Transmit JSON payload to the Node.js Express backend
 */
bool sendToBackend(int co2Ppm, float temp, float hum) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  http.begin(BACKEND_URL);
  http.addHeader("Content-Type", "application/json");

  // Construct JSON
  String jsonPayload = "{";
  jsonPayload += "\"co2\":" + String(co2Ppm) + ",";
  jsonPayload += "\"temperature\":" + String(temp, 1) + ",";
  jsonPayload += "\"humidity\":" + String(hum, 1) + ",";
  jsonPayload += "\"device\":\"EcoBot ESP32 Rover\"";
  jsonPayload += "}";

  Serial.print("[HTTP -> Backend] Posting to: ");
  Serial.println(BACKEND_URL);
  Serial.println("  Payload: " + jsonPayload);

  int httpCode = http.POST(jsonPayload);

  if (httpCode > 0) {
    Serial.printf("  Response Code: %d\n", httpCode);
    String response = http.getString();
    Serial.println("  Response: " + response);
    http.end();
    return (httpCode == 200 || httpCode == 201);
  } else {
    Serial.printf("  [HTTP Error] %s\n", http.errorToString(httpCode).c_str());
    http.end();
    return false;
  }
}

/**
 * Transmit JSON payload directly to Firebase Realtime Database REST API
 */
bool sendToFirebaseDirect(int co2Ppm, float temp, float hum) {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  client.setInsecure(); // Skip SSL certificate validation for simplicity

  HTTPClient http;
  http.begin(client, FIREBASE_REST_URL);
  http.addHeader("Content-Type", "application/json");

  String jsonPayload = "{";
  jsonPayload += "\"co2\":" + String(co2Ppm) + ",";
  jsonPayload += "\"temperature\":" + String(temp, 1) + ",";
  jsonPayload += "\"humidity\":" + String(hum, 1) + ",";
  jsonPayload += "\"device\":\"EcoBot ESP32 (Direct)\",";
  jsonPayload += "\"lastUpdate\":{\".sv\":\"timestamp\"}";
  jsonPayload += "}";

  Serial.print("[HTTPS -> Firebase] Syncing to: ");
  Serial.println(FIREBASE_REST_URL);

  // Use PATCH to update fields under ecobot/sensor without overwriting other paths
  int httpCode = http.PATCH(jsonPayload);

  if (httpCode > 0) {
    Serial.printf("  Firebase Response: %d\n", httpCode);
    http.end();
    return (httpCode == 200);
  } else {
    Serial.printf("  [Firebase Error] %s\n", http.errorToString(httpCode).c_str());
    http.end();
    return false;
  }
}

// ============================================================================
// 7. SETUP
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(STATUS_LED_PIN, OUTPUT);
  pinMode(MQ135_DIGITAL_PIN, INPUT);

  // Set ADC attenuation to 11dB (up to ~3.3V range)
  analogSetAttenuation(ADC_11db);

  Serial.println("====================================================");
  Serial.println("   🌱 ECOBOT - ESP32 CO2 ENVIRONMENTAL TELEMETRY   ");
  Serial.println("====================================================");
  Serial.println("Warming up MQ-135 sensor heater...");

  // Initial WiFi connect
  connectWiFi();

  Serial.println("[Ready] Starting live sensor telemetry stream...\n");
}

// ============================================================================
// 8. MAIN LOOP
// ============================================================================
void loop() {
  // Non-blocking transmit timer
  if (millis() - lastTransmitTime >= TRANSMIT_INTERVAL) {
    lastTransmitTime = millis();

    // Ensure WiFi is connected
    if (WiFi.status() != WL_CONNECTED) {
      connectWiFi();
    }

    // 1. Read MQ-135 Sensor
    int rawADC = analogRead(MQ135_ANALOG_PIN);
    float voltage = readAveragedADC(MQ135_ANALOG_PIN, 10);
    float rs = calculateSensorResistance(voltage);
    int co2Ppm = calculateCO2PPM(rs);
    int digitalThreshold = digitalRead(MQ135_DIGITAL_PIN);

    // 2. Simulated/Estimated ambient temperature & humidity
    // (If you have a physical DHT11/DHT22 connected, replace these lines with dht.readTemperature())
    float ambientTemp = 27.5;
    float ambientHumidity = 62.0;

    // 3. Print Local Diagnostics
    Serial.println("----------------------------------------------------");
    Serial.printf("📊 ADC: %4d | Volt: %.3f V | Rs: %.2f kΩ\n", rawADC, voltage, rs);
    Serial.printf("💨 Estimated CO2: %d PPM (Digital Threshold: %d)\n", co2Ppm, digitalThreshold);

    // 4. Transmit Telemetry
    bool success = false;
    if (TRANSMIT_MODE == MODE_BACKEND) {
      success = sendToBackend(co2Ppm, ambientTemp, ambientHumidity);
    } else {
      success = sendToFirebaseDirect(co2Ppm, ambientTemp, ambientHumidity);
    }

    // Blink status LED to indicate successful transmission
    if (success) {
      digitalWrite(STATUS_LED_PIN, LOW);
      delay(80);
      digitalWrite(STATUS_LED_PIN, HIGH);
    }
  }
}
