'use strict';

/**
 * Address suggestions — Place Autocomplete (New) + Place Details proxy.
 * In-process with supertest; auth and Google are mocked.
 */

let mockAuthed = true;
jest.mock('../permissions', () => ({
  requireAuth: (req, res, next) => (mockAuthed ? next() : res.status(401).json({ error: 'Not authenticated' })),
}));
jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));

const request = require('supertest');
const express = require('express');
const axios = require('axios');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', require('../maps-routes'));
  return app;
}

const TOKEN = '0f8b5c1e-2a3d-4e5f-8a9b-1c2d3e4f5a6b';

describe('maps autocomplete routes', () => {
  let app;
  beforeEach(() => {
    mockAuthed = true;
    process.env.GOOGLE_MAPS_API_KEY = 'test-key-abcdefghijklmnop';
    axios.post.mockReset(); axios.get.mockReset();
    app = buildApp();
  });
  afterAll(() => { delete process.env.GOOGLE_MAPS_API_KEY; });

  test('autocomplete maps predictions and sends AU restriction, WA restriction, session token', async () => {
    axios.post.mockResolvedValue({ data: { suggestions: [
      { placePrediction: { placeId: 'ChIJabc', text: { text: '64 Talbot Ave, Como WA, Australia' }, structuredFormat: { mainText: { text: '64 Talbot Ave' } } } },
      { queryPrediction: { text: { text: 'talbot cafes' } } },
    ] } });

    const r = await request(app).post('/api/maps/autocomplete').send({ input: '64 Talb', sessionToken: TOKEN });

    expect(r.status).toBe(200);
    expect(r.body.suggestions).toEqual([{ placeId: 'ChIJabc', name: '64 Talbot Ave', addr: '64 Talbot Ave, Como WA, Australia' }]);
    const [url, body, opts] = axios.post.mock.calls[0];
    expect(url).toBe('https://places.googleapis.com/v1/places:autocomplete');
    expect(body).toMatchObject({ input: '64 Talb', includedRegionCodes: ['au'], sessionToken: TOKEN });
    expect(body.locationRestriction.rectangle.low.latitude).toBeLessThan(body.locationRestriction.rectangle.high.latitude);
    expect(opts.headers['X-Goog-Api-Key']).toBe('test-key-abcdefghijklmnop');
  });

  test('autocomplete drops a malformed session token and rejects empty input', async () => {
    axios.post.mockResolvedValue({ data: {} });
    await request(app).post('/api/maps/autocomplete').send({ input: 'Perth', sessionToken: 'bad token!' });
    expect(axios.post.mock.calls[0][1].sessionToken).toBeUndefined();

    const r = await request(app).post('/api/maps/autocomplete').send({ input: '   ' });
    expect(r.status).toBe(400);
  });

  test('Google errors surface without Google detail', async () => {
    axios.post.mockRejectedValue({ response: { status: 400, data: { error: { message: 'API key not valid' } } } });
    const r = await request(app).post('/api/maps/autocomplete').send({ input: 'Perth' });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toMatch(/API key/);
  });

  test('place details returns address and coordinates', async () => {
    axios.get.mockResolvedValue({ data: { formattedAddress: '64 Talbot Ave, Como WA 6152, Australia', location: { latitude: -32.0, longitude: 115.86 } } });
    const r = await request(app).get(`/api/maps/place/ChIJabc?sessionToken=${TOKEN}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ addr: '64 Talbot Ave, Como WA 6152, Australia', lat: -32.0, lng: 115.86 });
    const [url, opts] = axios.get.mock.calls[0];
    expect(url).toBe('https://places.googleapis.com/v1/places/ChIJabc');
    expect(opts.params).toEqual({ sessionToken: TOKEN });
    expect(opts.headers['X-Goog-FieldMask']).toBe('formattedAddress,location');
  });

  test('place details rejects an id that is not a place id', async () => {
    const r = await request(app).get('/api/maps/place/..%2F..%2Fevil');
    expect(r.status).toBe(400);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('both routes require a signed-in user', async () => {
    mockAuthed = false;
    expect((await request(app).post('/api/maps/autocomplete').send({ input: 'Perth' })).status).toBe(401);
    expect((await request(app).get('/api/maps/place/ChIJabc')).status).toBe(401);
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('503 when no key is configured', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    expect((await request(app).post('/api/maps/autocomplete').send({ input: 'Perth' })).status).toBe(503);
    expect((await request(app).get('/api/maps/place/ChIJabc')).status).toBe(503);
  });
});
