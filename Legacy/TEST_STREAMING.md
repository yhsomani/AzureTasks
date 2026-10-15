# Real-Time Streaming Data - Test Checklist

## Prerequisites
- Server running: `npm start`
- Browser: Chrome, Firefox, Safari, or Edge (all support EventSource)
- .env configured with valid Azure DevOps credentials

## Test Scenarios

### ✅ Test 1: Explorer Tab Streaming
1. Open browser DevTools (F12)
2. Go to Explorer tab
3. Click "Load" or "Refresh" button
4. **Expected behavior:**
   - Progress bar appears and animates 0% → 100%
   - Messages show: "Initializing...", "Analyzing X working days...", "Fetching tasks...", "Processing...", "Rendering..."
   - Network tab shows `/api/explorer/stream` with status 200
   - Data table populates when complete
   - **Network shows continuous SSE data messages** (not one big response)

### ✅ Test 2: Burndown Tab Streaming
1. Go to Burndown tab or Overview tab
2. **Expected behavior:**
   - Same progress bar animation as Explorer
   - Progress messages update in real-time
   - Matrix table renders when complete

### ✅ Test 3: Network Tab Inspection
1. Open DevTools → Network tab
2. Reload page and go to Explorer
3. Look for `explorer/stream` request
4. **Expected details:**
   - **URL:** `/api/explorer/stream?...`
   - **Status:** 200
   - **Content-Type:** text/event-stream
   - **Response Preview:** Shows SSE data format
   ```
   data: {"type":"started",...}
   
   data: {"type":"progress",...}
   ```

### ✅ Test 4: Error Handling
1. Stop the backend server
2. Click "Load" in Explorer tab
3. **Expected behavior:**
   - Error message appears: "Stream connection lost"
   - Progress bar stops
   - No partial/broken data shown

### ✅ Test 5: Fast Network vs Slow Network
- **Fast Network:** Progress completes in 2-5 seconds
- **Slow Network:** Progress shows incremental updates, user sees it's working
- **Very Slow:** Progress might get stuck at 25%, then jump to 100% (normal, server is processing)

### ✅ Test 6: Multiple Simultaneous Requests
1. Open multiple browser tabs
2. Click "Load" in tab 1
3. Immediately click "Load" in tab 2
4. **Expected behavior:**
   - Both streaming connections work independently
   - No interference between streams
   - Each stream shows its own progress

### ✅ Test 7: Cancel Request
1. Click "Load" in Explorer
2. Immediately close the browser tab or navigate away
3. **Expected behavior:**
   - Server stops streaming (client closes connection)
   - No errors in console

## Debugging

### Check if streaming is working
```javascript
// In browser console:
const e = new EventSource('/api/explorer/stream?startDate=2025-01-01&endDate=2025-01-31');
e.addEventListener('message', msg => console.log(JSON.parse(msg.data)));
```

### Check server logs
```bash
# Watch server output for streaming messages
npm start
# Look for progress messages being logged
```

### Browser console checks
- F12 → Console tab
- Look for any red error messages
- Check for "Failed to parse stream message" errors

## Performance Metrics

### Expected Timing
- **Small request** (1-5 days): 2-5 seconds total
- **Medium request** (1 month): 5-10 seconds total
- **Large request** (3 months): 15-30 seconds total

### What to measure
- Time from click to first progress update (should be <1s)
- Updates frequency (should be every 100-500ms)
- Total time to completion
- Memory usage (should not spike during streaming)

## Known Limitations

⚠️ **EventSource limitations:**
- Only GET requests (no POST)
- Auto-reconnects if server closes (good!)
- Max 1 connection per endpoint (multiple requests to same URL share one EventSource)
- Headers cannot be set (use query params or auth tokens in URL)

⚠️ **Browser support:**
- IE 10+ (good support)
- All modern browsers (excellent support)
- Mobile browsers (supported, good battery on WiFi)

## Success Criteria

✅ All of these must pass:
1. Progress bar animates smoothly 0→100%
2. Status messages update in real-time
3. No "Stream connection lost" errors
4. Data renders correctly when complete
5. Network tab shows SSE content-type
6. No console errors
7. Response time < 30 seconds for normal requests

If any fail, check:
- Server is running (`npm start`)
- .env has valid Azure DevOps credentials
- Network connection is stable
- No firewall blocking EventSource connections
