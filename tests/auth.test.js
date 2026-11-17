import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAdminSession,
  hashApiToken,
  matchesApiToken,
  verifyAdminSession,
} from '../server/auth.js';

test('admin sessions are signed and expire', () => {
  const created = createAdminSession('session-secret', 'admin', { now: 1000, ttlMs: 5000 });

  assert.equal(created.payload.sub, 'admin');
  assert.equal(verifyAdminSession(created.token, 'session-secret', 5999)?.sub, 'admin');
  assert.equal(verifyAdminSession(created.token, 'session-secret', 6000), null);
  assert.equal(verifyAdminSession(created.token, 'wrong-secret', 2000), null);
});

test('admin sessions reject tampering and malformed cookie values', () => {
  const created = createAdminSession('session-secret', 'admin', { now: 1000, ttlMs: 5000 });
  const [payload, signature] = created.token.split('.');
  const alteredFirstSignatureChar = signature[0] === 'a' ? 'b' : 'a';
  const tampered = `${payload}.${alteredFirstSignatureChar}${signature.slice(1)}`;

  assert.equal(verifyAdminSession(tampered, 'session-secret', 2000), null);
  assert.equal(verifyAdminSession('not.a.session', 'session-secret', 2000), null);
});

test('consumer tokens are stored as hashes and compared without exposing the secret', () => {
  const token = 'sk-mock-test-secret';
  const hash = hashApiToken(token);

  assert.notEqual(hash, token);
  assert.equal(matchesApiToken(token, hash), true);
  assert.equal(matchesApiToken('sk-mock-wrong-secret', hash), false);
});
