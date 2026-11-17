import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/config.js';

test('provides safe local defaults for development', () => {
  const config = loadConfig({});

  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.port, 8080);
  assert.equal(config.adminUsername, 'admin');
  assert.equal(config.adminPassword, 'dev-only-change-me');
  assert.equal(config.minDelayMs, 180);
  assert.equal(config.maxDelayMs, 900);
  assert.equal(config.publicBaseUrl, null);
});

test('requires explicit admin credentials and session secret in production', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /ADMIN_PASSWORD/);
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', ADMIN_PASSWORD: 'strong-password' }),
    /ADMIN_SESSION_SECRET/,
  );
  assert.throws(
    () => loadConfig({
      NODE_ENV: 'production',
      ADMIN_PASSWORD: 'strong-password',
      ADMIN_SESSION_SECRET: 'too-short-secret',
    }),
    /at least 32 characters/i,
  );
});

test('reads explicit settings from environment variables', () => {
  const config = loadConfig({
    PORT: '9090',
    DATA_DIR: '/var/lib/fake-llm',
    ADMIN_USERNAME: 'operator',
    ADMIN_PASSWORD: 'secret',
    ADMIN_SESSION_SECRET: 'session-secret-that-is-at-least-thirty-two-characters',
    API_DELAY_MIN_MS: '25',
    API_DELAY_MAX_MS: '400',
    PUBLIC_BASE_URL: 'https://llm.example.test/',
  });

  assert.equal(config.port, 9090);
  assert.equal(config.dataDir, '/var/lib/fake-llm');
  assert.equal(config.adminUsername, 'operator');
  assert.equal(config.adminPassword, 'secret');
  assert.equal(config.adminSessionSecret, 'session-secret-that-is-at-least-thirty-two-characters');
  assert.equal(config.minDelayMs, 25);
  assert.equal(config.maxDelayMs, 400);
  assert.equal(config.publicBaseUrl, 'https://llm.example.test');
});

test('rejects non-origin public base URLs', () => {
  assert.throws(() => loadConfig({ PUBLIC_BASE_URL: 'ftp://llm.example.test' }), /PUBLIC_BASE_URL/);
  assert.throws(() => loadConfig({ PUBLIC_BASE_URL: 'https://user:secret@llm.example.test' }), /PUBLIC_BASE_URL/);
  assert.throws(() => loadConfig({ PUBLIC_BASE_URL: 'https://llm.example.test/api' }), /PUBLIC_BASE_URL/);
});

test('rejects invalid ports and delay ranges', () => {
  assert.throws(() => loadConfig({ PORT: '0' }), /PORT/);
  assert.throws(() => loadConfig({ API_DELAY_MIN_MS: '-1' }), /API_DELAY_MIN_MS/);
  assert.throws(() => loadConfig({ API_DELAY_MAX_MS: 'not-a-number' }), /API_DELAY_MAX_MS/);
  assert.throws(() => loadConfig({ API_DELAY_MIN_MS: '100', API_DELAY_MAX_MS: '50' }), /delay/i);
});

test('authentication is opt-out with strict configuration and an explicit origin', () => {
  assert.equal(loadConfig({}).adminAuthEnabled, true);
  for (const value of ['0', 'off', 'FALSE', 'typo']) {
    assert.throws(() => loadConfig({ ADMIN_AUTH_ENABLED: value }), /ADMIN_AUTH_ENABLED/);
  }
  assert.throws(() => loadConfig({ ADMIN_AUTH_ENABLED: 'false' }), /PUBLIC_BASE_URL/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', ADMIN_AUTH_ENABLED: 'false', PUBLIC_BASE_URL: 'http://llm.test' }), /HTTPS/);
  const config = loadConfig({ NODE_ENV: 'production', ADMIN_AUTH_ENABLED: 'false', PUBLIC_BASE_URL: 'https://llm.test' });
  assert.equal(config.adminAuthEnabled, false);
  assert.ok(config.adminSessionSecret.length >= 32);
});

test('production rejects documented example credentials', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production', ADMIN_PASSWORD: 'change-this-local-password', ADMIN_SESSION_SECRET: 'replace-with-a-long-random-secret' }), /placeholder|example/i);
});

test('only explicit loopback HTTP origins opt out of Secure production cookies', () => {
  const env = { NODE_ENV: 'production', ADMIN_PASSWORD: 'test-only-password', ADMIN_SESSION_SECRET: 'test-only-secret-with-more-than-32-characters' };
  for (const origin of ['http://localhost:8080', 'http://127.0.0.1:8080', 'http://[::1]:8080']) {
    assert.equal(loadConfig({ ...env, PUBLIC_BASE_URL: origin }).adminCookieSecure, false);
  }
  for (const origin of ['', 'https://localhost:8080', 'https://llm.test', 'http://llm.test', 'http://localhost.evil.test']) {
    assert.equal(loadConfig({ ...env, PUBLIC_BASE_URL: origin }).adminCookieSecure, true);
  }
  assert.throws(() => loadConfig({ ...env, ADMIN_AUTH_ENABLED: 'false', PUBLIC_BASE_URL: 'http://localhost:8080' }), /HTTPS/);
});
