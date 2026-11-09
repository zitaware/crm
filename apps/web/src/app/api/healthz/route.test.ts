import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /api/healthz', () => {
  it('reports ok status', async () => {
    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('web');
  });
});
