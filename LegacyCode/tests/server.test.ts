import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppServer } from '../src/server/server.js';

describe('AppServer & REST API Suite', () => {
  let server: AppServer;
  let serverPort: number;
  let baseUrl: string;

  beforeAll(async () => {
    // Start server on dynamic port (e.g. 4123)
    server = new AppServer(4123);
    serverPort = await server.start();
    baseUrl = `http://localhost:${serverPort}`;
  });

  afterAll(async () => {
    await server.stop();
  });

  it('serves static index.html on root GET /', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const contentType = res.headers.get('content-type');
    expect(contentType).toContain('text/html');
    const text = await res.text();
    expect(text).toContain('Work Intelligence');
  });

  it('serves static styles.css with correct Content-Type', async () => {
    const res = await fetch(`${baseUrl}/styles.css`);
    expect(res.status).toBe(200);
    const contentType = res.headers.get('content-type');
    expect(contentType).toContain('text/css');
    const text = await res.text();
    expect(text).toContain('--brand-primary');
  });

  it('serves static app.js with correct Content-Type', async () => {
    const res = await fetch(`${baseUrl}/app.js`);
    expect(res.status).toBe(200);
    const contentType = res.headers.get('content-type');
    expect(contentType).toContain('application/javascript');
    const text = await res.text();
    expect(text).toContain('appState');
  });

  it('returns system status without leaking raw PAT on GET /api/status', async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toBeDefined();
    expect(json.data.organization).toBeDefined();
    expect(json.data.project).toBeDefined();

    // Verify PAT is masked and not exposed in raw form
    if (json.data.patMasked) {
      expect(json.data.patMasked).toMatch(/^\w{4}\.\.\.\w{4}$/);
    }
  });

  it('returns app configuration on GET /api/config', async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data.people)).toBe(true);
    expect(json.data.people.length).toBeGreaterThan(0);
  });

  it('returns journal records on GET /api/journal', async () => {
    const res = await fetch(`${baseUrl}/api/journal`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data.entries)).toBe(true);
  });

  it('returns scheduler status on GET /api/scheduler', async () => {
    const res = await fetch(`${baseUrl}/api/scheduler`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.targetTime).toBeDefined();
    expect(json.data.timezone).toBeDefined();
  });

  it('toggles scheduler state on POST /api/scheduler/toggle', async () => {
    const res = await fetch(`${baseUrl}/api/scheduler/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.enabled).toBe(true);

    // Toggle back to false
    const resOff = await fetch(`${baseUrl}/api/scheduler/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(resOff.status).toBe(200);
    const jsonOff = await resOff.json();
    expect(jsonOff.data.enabled).toBe(false);
  });

  it('exports journal in CSV format on GET /api/journal/export?format=csv', async () => {
    const res = await fetch(`${baseUrl}/api/journal/export?format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const text = await res.text();
    expect(text).toContain('Timestamp,RunId,PersonName,AssignedTo');
  });

  it('exports journal in JSON format on GET /api/journal/export?format=json', async () => {
    const res = await fetch(`${baseUrl}/api/journal/export?format=json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
  });

  it('validates PAT payload on POST /api/config/pat', async () => {
    const res = await fetch(`${baseUrl}/api/config/pat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pat: '' }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('returns recent sanitized logs on GET /api/logs', async () => {
    const res = await fetch(`${baseUrl}/api/logs?limit=20`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data.logs)).toBe(true);
  });

  it('handles 404 for unknown API routes gracefully', async () => {
    const res = await fetch(`${baseUrl}/api/non_existent_route`);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('API route not found');
  });

  it('handles GET /api/explorer with preset parameter', async () => {
    const res = await fetch(`${baseUrl}/api/explorer?preset=today`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.dateRange).toBeDefined();
    expect(json.data.summary).toBeDefined();
    expect(json.data.matrix).toBeDefined();
    expect(Array.isArray(json.data.users)).toBe(true);
  });
});
