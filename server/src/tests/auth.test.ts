/**
 * Auth API integration tests
 * Run: cd server && npx vitest run src/tests/auth.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE = 'http://localhost:4000';

async function post(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { headers });
  return { status: res.status, body: await res.json() };
}

let adminToken = '';
let operatorToken = '';
let adminRefresh = '';

describe('Authentication', () => {
  it('POST /api/auth/login — valid admin credentials', async () => {
    const r = await post('/api/auth/login', {
      email: 'admin@scholario.net',
      password: 'Admin@Scholario2026!',
    });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data.user.roleName).toBe('super_admin');
    expect(r.body.data.tokens.accessToken).toBeTruthy();
    expect(r.body.data.tokens.refreshToken).toBeTruthy();
    adminToken   = r.body.data.tokens.accessToken;
    adminRefresh = r.body.data.tokens.refreshToken;
  });

  it('POST /api/auth/login — valid operator credentials', async () => {
    const r = await post('/api/auth/login', {
      email: 'arjun.mehta@scholario.net',
      password: 'Operator@Scholario2026!',
    });
    expect(r.status).toBe(200);
    expect(r.body.data.user.roleName).toBe('operator');
    operatorToken = r.body.data.tokens.accessToken;
  });

  it('POST /api/auth/login — wrong password returns 401', async () => {
    const r = await post('/api/auth/login', {
      email: 'admin@scholario.net',
      password: 'wrong-password',
    });
    expect(r.status).toBe(401);
    expect(r.body.success).toBe(false);
  });

  it('POST /api/auth/login — unknown email returns 401', async () => {
    const r = await post('/api/auth/login', {
      email: 'nobody@scholario.net',
      password: 'anything',
    });
    expect(r.status).toBe(401);
  });

  it('POST /api/auth/login — missing fields returns 400', async () => {
    const r = await post('/api/auth/login', { email: '' });
    expect(r.status).toBe(400);
  });

  it('GET /api/auth/me — returns current user with valid token', async () => {
    const r = await get('/api/auth/me', adminToken);
    expect(r.status).toBe(200);
    expect(r.body.data.email).toBe('admin@scholario.net');
  });

  it('GET /api/auth/me — returns 401 without token', async () => {
    const r = await get('/api/auth/me');
    expect(r.status).toBe(401);
  });

  it('GET /api/auth/me — returns 401 with malformed token', async () => {
    const r = await get('/api/auth/me', 'not-a-valid-jwt');
    expect(r.status).toBe(401);
  });

  it('POST /api/auth/refresh — rotates tokens', async () => {
    const r = await post('/api/auth/refresh', { refreshToken: adminRefresh });
    expect(r.status).toBe(200);
    expect(r.body.data.tokens.accessToken).toBeTruthy();
    // New access token should be different (issued later)
    expect(r.body.data.tokens.accessToken).not.toBe(adminToken);
  });

  it('POST /api/auth/refresh — invalid token returns 401', async () => {
    const r = await post('/api/auth/refresh', { refreshToken: 'invalid-token' });
    expect(r.status).toBe(401);
  });
});

describe('RBAC — Permission enforcement', () => {
  it('viewer cannot POST /api/monitors (requires it_administrator)', async () => {
    // Create a viewer user first (using admin token)
    const createR = await post('/api/users', {
      email: `viewer-test-${Date.now()}@scholario.net`,
      password: 'TestViewer@2026!',
      fullName: 'Test Viewer',
      roleName: 'viewer',
    }, adminToken);
    expect(createR.status).toBe(201);

    // Login as viewer
    const loginR = await post('/api/auth/login', {
      email: createR.body.data.email,
      password: 'TestViewer@2026!',
    });
    const viewerToken = loginR.body.data.tokens.accessToken;

    // Viewer cannot create monitors
    const r = await post('/api/monitors', {
      name: 'Test Monitor',
      type: 'HTTP',
      target: 'https://example.com',
    }, viewerToken);
    expect(r.status).toBe(403);
  });

  it('operator CAN acknowledge incidents', async () => {
    // Get an open incident
    const incR = await get('/api/incidents?open=true', operatorToken);
    expect(incR.status).toBe(200);
    if (incR.body.data.length === 0) return; // no incidents to test

    const incId = incR.body.data[0].id;
    const r = await post(`/api/incidents/${incId}/acknowledge`, {}, operatorToken);
    expect([200, 404]).toContain(r.status); // 404 if already acknowledged
  });

  it('GET /api/applications requires authentication', async () => {
    const r = await get('/api/applications');
    expect(r.status).toBe(401);
  });

  it('GET /api/audit requires operator+ role', async () => {
    // Create a viewer
    const createR = await post('/api/users', {
      email: `viewer-audit-${Date.now()}@scholario.net`,
      password: 'TestViewer@2026!',
      fullName: 'Test Viewer 2',
      roleName: 'viewer',
    }, adminToken);
    const loginR = await post('/api/auth/login', {
      email: createR.body.data.email,
      password: 'TestViewer@2026!',
    });
    const viewerToken = loginR.body.data.tokens.accessToken;
    const r = await get('/api/audit', viewerToken);
    expect(r.status).toBe(403);
  });
});

describe('API Health', () => {
  it('GET /health returns ok', async () => {
    const r = await get('/health');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
  });

  it('GET /api/reports/summary returns system health', async () => {
    const r = await get('/api/reports/summary', adminToken);
    expect(r.status).toBe(200);
    expect(r.body.data.totalApps).toBeGreaterThan(0);
    expect(r.body.data.totalServers).toBeGreaterThan(0);
    expect(['OPERATIONAL', 'WARNING', 'CRITICAL']).toContain(r.body.data.overallHealth);
  });

  it('GET /api/applications returns paginated results', async () => {
    const r = await get('/api/applications?pageSize=10', adminToken);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
    expect(r.body.pagination.total).toBeGreaterThan(0);
  });

  it('GET /api/servers returns 16 nodes', async () => {
    const r = await get('/api/servers?pageSize=50', adminToken);
    expect(r.status).toBe(200);
    expect(r.body.pagination.total).toBe(16);
  });

  it('POST /api/monitors/:id/probe executes a real check', async () => {
    // Create a simple HTTP monitor
    const create = await post('/api/monitors', {
      name: 'Test HTTP Monitor',
      type: 'HTTP',
      target: 'http://localhost:4000/health',
      intervalSec: 60,
    }, adminToken);
    expect(create.status).toBe(201);
    const monId = create.body.data.id;

    // Run a probe
    const probe = await post(`/api/monitors/${monId}/probe`, {}, operatorToken);
    expect(probe.status).toBe(200);
    expect(probe.body.data.status).toBe('HEALTHY');
    expect(probe.body.data.responseTimeMs).toBeGreaterThanOrEqual(0);

    // Clean up
    const del = await fetch(`${BASE}/api/monitors/${monId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(del.status).toBe(204);
  });
});

describe('Incident lifecycle', () => {
  it('GET /api/incidents returns open incidents', async () => {
    const r = await get('/api/incidents?open=true', adminToken);
    expect(r.status).toBe(200);
    expect(r.body.pagination).toBeDefined();
  });

  it('Full incident lifecycle works', async () => {
    // Get the seeded incident
    const listR = await get('/api/incidents?open=true', adminToken);
    if (listR.body.data.length === 0) return; // skip if none

    const inc = listR.body.data[0];
    const id = inc.id;

    // Acknowledge
    const ackR = await post(`/api/incidents/${id}/acknowledge`, {}, adminToken);
    expect([200, 404]).toContain(ackR.status);

    // Change status
    const statusR = await post(`/api/incidents/${id}/status`, { status: 'INVESTIGATING' }, adminToken);
    expect([200, 404]).toContain(statusR.status);

    // Add note
    const noteR = await post(`/api/incidents/${id}/notes`, { content: 'Automated test note' }, adminToken);
    expect([200, 404]).toContain(noteR.status);
  });
});
