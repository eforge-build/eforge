import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('todos routes', () => {
  it('creates and lists todos', async () => {
    const app = createApp();
    const created = await request(app).post('/todos').send({ title: 'write tests' });
    expect(created.status).toBe(201);

    const listed = await request(app).get('/todos');
    expect(listed.status).toBe(200);
    expect(listed.body.some((todo: { title: string }) => todo.title === 'write tests')).toBe(true);
  });

  it('returns 404 for a missing todo', async () => {
    const app = createApp();
    const missing = await request(app).get('/todos/nope');
    expect(missing.status).toBe(404);
  });
});
