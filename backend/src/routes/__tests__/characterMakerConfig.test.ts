/** Standalone public configuration route: no running database or credentials. */
import express from 'express';
import request from 'supertest';
import configRoutes from '../config';

jest.mock('../../services/email', () => ({ isSmtpConfigured: () => false }));

const savedOrigin = process.env.INSULAM_CHARACTER_MAKER_ORIGIN;
const savedNodeEnv = process.env.NODE_ENV;
const app = express();
app.use('/api/config', configRoutes);

afterEach(() => {
  if (savedOrigin === undefined) delete process.env.INSULAM_CHARACTER_MAKER_ORIGIN;
  else process.env.INSULAM_CHARACTER_MAKER_ORIGIN = savedOrigin;
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
});

describe('public CharacterMaker configuration', () => {
  it('does not advertise a connection unless configured', async () => {
    delete process.env.INSULAM_CHARACTER_MAKER_ORIGIN;
    const result = await request(app).get('/api/config');
    expect(result.status).toBe(200);
    expect(result.body).not.toHaveProperty('characterMaker');
    expect(result.body).toHaveProperty('uploadLimits');
    expect(result.body.smtp).toEqual({ configured: false });
  });

  it('returns only the normalized public origin for an explicitly enabled source', async () => {
    process.env.NODE_ENV = 'production';
    process.env.INSULAM_CHARACTER_MAKER_ORIGIN = 'https://source.example/';
    const result = await request(app).get('/api/config');
    expect(result.status).toBe(200);
    expect(result.body.characterMaker).toEqual({ origin: 'https://source.example' });
  });

  it.each(['https://user:synthetic-secret@source.example', 'http://localhost:3001'])('fails closed in production without leaking invalid configuration %s', async (origin) => {
    process.env.NODE_ENV = 'production';
    process.env.INSULAM_CHARACTER_MAKER_ORIGIN = origin;
    const result = await request(app).get('/api/config');
    expect(result.status).toBe(200);
    expect(result.body).not.toHaveProperty('characterMaker');
    expect(JSON.stringify(result.body)).not.toContain('synthetic-secret');
    expect(JSON.stringify(result.body)).not.toContain(origin);
  });
});
