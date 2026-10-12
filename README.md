# OnekickX API — Live Sports & Odds Gateway

High-performance sports data and betting odds gateway featuring autonomous Chrome 124 TLS & HTTP/2 network impersonation, continuous elite proxy broadening, and open CORS access.

## Quick Start (Replit / Local / VPS)

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start the Server**:
   ```bash
   npm start
   ```

The application will start on port `3000` (or `process.env.PORT`).

---

## API Endpoints

### 1. Unified Sports Data Endpoint
- **URL**: `/api/data`
- **Method**: `GET` or `POST`
- **CORS**: `Access-Control-Allow-Origin: *` (open to all domains)

#### Example GET
```bash
curl "http://localhost:3000/api/data?url=https://www.sofascore.com/api/v1/event/16115794/odds/1/all"
```

#### Example POST
```bash
curl -X POST "http://localhost:3000/api/data" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.sofascore.com/api/v1/event/16115794/odds/1/all"}'
```

### 2. Live Proxy Pool Status
- **URL**: `/api/data/pool`
- **Method**: `GET`

Returns the active count and verified proxy list currently being used and broadened.
