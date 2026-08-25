/**
 * End-to-end test of arrival-alert push, without a phone.
 *
 * Everything except the final hop is verifiable here, and the final hop is Google's and
 * Apple's job. So this stands up a fake push service, registers a subscription against it with
 * *real* P-256 keys, drives the actual alert path, and then decrypts the notification with the
 * subscriber's private key.
 *
 * That last part is the point. Encrypted push fails silently when it is wrong: the push
 * service happily returns 201 and the browser quietly cannot decrypt the message, so a broken
 * implementation looks identical to a working one from the server's side. Decrypting the
 * payload here — implementing RFC 8291 in reverse, independently of the library that wrote it
 * — is the only way to know the bytes on the wire are actually readable by a browser.
 *
 *   node --test scripts/test-push.mjs
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// An isolated database, so a test run never touches real subscriptions.
const DB_FILE = path.join(os.tmpdir(), `st-push-test-${Date.now()}.db`);
process.env.DB_FILE = DB_FILE;
process.env.VAPID_PUBLIC_KEY ||= '';
process.env.VAPID_PRIVATE_KEY ||= '';

// Keys must exist before push.mjs is imported; generate a throwaway pair if none are set.
if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  const webpush = (await import('web-push')).default;
  const keys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
}
process.env.VAPID_SUBJECT = 'mailto:test@example.com';

const db = await import('../server/db.mjs');
const push = await import('../server/push.mjs');

/* ------------------------------------------------------------------ subscriber */

/** A browser's half of a push subscription: an ECDH keypair and a 16-byte auth secret. */
function makeSubscriber() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    ecdh,
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: crypto.randomBytes(16),
  };
}

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/** HKDF-Expand with a single output block, which is all RFC 8291 ever needs. */
function hkdfExpand(prk, info, length) {
  return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

/**
 * Decrypts an aes128gcm push payload (RFC 8188 framing, RFC 8291 key derivation).
 * Written from the spec rather than reusing the sender's code — a bug shared by both halves
 * would cancel itself out and prove nothing.
 */
function decryptPush(body, subscriber) {
  const salt = body.subarray(0, 16);
  const keyIdLen = body.readUInt8(20);
  const serverPublic = body.subarray(21, 21 + keyIdLen);
  const ciphertext = body.subarray(21 + keyIdLen);

  const sharedSecret = subscriber.ecdh.computeSecret(serverPublic);
  const subscriberPublic = subscriber.ecdh.getPublicKey();

  // IKM comes from the shared secret, keyed by the auth secret and bound to both public keys.
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'), subscriberPublic, serverPublic,
  ]);
  const ikm = hkdfExpand(hmac(subscriber.auth, sharedSecret), keyInfo, 32);

  const prk = hmac(salt, ikm);
  const cek = hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\0'), 12);

  const tag = ciphertext.subarray(ciphertext.length - 16);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);

  // Strip the RFC 8188 padding delimiter and everything after it.
  const delimiter = plain.lastIndexOf(0x02);
  return JSON.parse(plain.subarray(0, delimiter >= 0 ? delimiter : plain.length).toString('utf8'));
}

/* ------------------------------------------------------------------ fake push service */

/**
 * A self-signed certificate, because `web-push` always speaks TLS regardless of the endpoint's
 * scheme — an http:// endpoint fails with a confusing "wrong version number" SSL error rather
 * than a plain connection. Every real push endpoint is https, so this is the library being
 * right; the test just has to meet it there.
 */
function selfSigned() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-push-tls-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-keyout', key, '-out', cert, '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1',
  ], { stdio: 'ignore' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert), dir };
}

// Trusting one throwaway certificate is not worth wiring a custom agent through web-push, and
// this only ever affects the test process.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const TLS = selfSigned();
after(() => fs.rmSync(TLS.dir, { recursive: true, force: true }));

function startPushService(handler) {
  const received = [];
  const server = https.createServer(TLS, handler || ((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks), url: req.url });
      res.writeHead(201).end();
    });
  }));
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, received, port: server.address().port });
    });
  });
}

/* ------------------------------------------------------------------ the test */

// Teardown belongs here rather than in the first test: deleting the file mid-run would leave
// the next test opening a fresh database at the same path and leaking it.
after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_FILE + suffix); } catch { /* already gone */ }
  }
});

test('an arrival alert reaches the push service, and the browser could read it', async (t) => {
  const service = await startPushService();
  t.after(() => service.server.close());

  db.open();
  const subscriber = makeSubscriber();
  const endpoint = `https://127.0.0.1:${service.port}/push/abc123`;

  const subId = db.subscriptions.upsert({
    endpoint,
    p256dh: subscriber.p256dh,
    auth: subscriber.auth.toString('base64url'),
  });

  // Waiting at Tankara for GJ-18-ZT-1028, notify within 2 km.
  db.alerts.add({
    subId, plate: 'GJ-18-ZT-1028', label: 'Tankara',
    lat: 22.6600, lng: 70.9500, radiusKm: 2,
  });

  assert.deepEqual(db.alerts.pendingPlates(), ['GJ-18-ZT-1028'],
    'the tracker must know to keep watching this plate');

  // --- the bus is still far away: nothing should fire
  const farAway = await push.evaluate('GJ-18-ZT-1028', { lat: 22.30, lng: 70.78 });
  assert.equal(farAway, 0, 'an alert must not fire from 40 km away');
  assert.equal(service.received.length, 0);

  // --- the bus arrives within the radius
  const fired = await push.evaluate(
    'GJ-18-ZT-1028', { lat: 22.6550, lng: 70.9460 }, { nextStop: 'Tankara' },
  );
  assert.equal(fired, 1, 'exactly one alert fires');
  assert.equal(service.received.length, 1, 'exactly one notification is sent');

  const sent = service.received[0];

  // VAPID: the push service uses this to know who we are.
  assert.match(sent.headers.authorization || '', /^vapid /i, 'a VAPID Authorization header is present');
  assert.equal(sent.headers['content-encoding'], 'aes128gcm', 'payload uses the current encryption');
  assert.ok(Number(sent.headers.ttl) > 0, 'a TTL is set so a stale alert is not delivered late');

  // The part that cannot be checked any other way: can a browser actually read this?
  const payload = decryptPush(sent.body, subscriber);
  console.log('  notification as the phone would see it:', JSON.stringify(payload));
  assert.match(payload.title, /GJ-18-ZT-1028/, 'the notification names the bus');
  assert.match(payload.body, /Tankara/, 'and the stop being waited at');
  assert.equal(payload.plate, 'GJ-18-ZT-1028');
  assert.match(payload.url, /^\/\?plate=GJ-18-ZT-1028$/,
    'tapping it opens that bus — and via `plate`, the one deep link the client routes');

  // --- it must never fire twice for the same alert
  const again = await push.evaluate('GJ-18-ZT-1028', { lat: 22.6551, lng: 70.9461 });
  assert.equal(again, 0, 'a fired alert does not fire again on the next poll');
  assert.equal(service.received.length, 1);
  assert.equal(db.alerts.pendingPlates().length, 0, 'and the plate no longer needs watching');
});

test('a subscription the browser has discarded is deleted, not retried', async (t) => {
  // A push service answers 410 Gone once the browser drops a subscription.
  const gone = https.createServer(TLS, (req, res) => { req.resume(); res.writeHead(410).end(); });
  await new Promise((r) => gone.listen(0, '127.0.0.1', r));
  t.after(() => gone.close());

  db.open();
  const subscriber = makeSubscriber();
  const endpoint = `https://127.0.0.1:${gone.address().port}/dead`;
  const subId = db.subscriptions.upsert({
    endpoint, p256dh: subscriber.p256dh, auth: subscriber.auth.toString('base64url'),
  });
  db.alerts.add({ subId, plate: 'GJ-99-XX-0001', label: 'Nowhere', lat: 22.0, lng: 70.0, radiusKm: 5 });

  const before = db.stats().subscriptions;
  await push.evaluate('GJ-99-XX-0001', { lat: 22.0, lng: 70.0 });
  assert.equal(db.stats().subscriptions, before - 1,
    'a 410 means gone for good — carrying it around forever would leak');
});

test('the test notification is a real round trip, and says so plainly', async (t) => {
  const service = await startPushService();
  t.after(() => service.server.close());

  db.open();
  const subscriber = makeSubscriber();
  const endpoint = `https://127.0.0.1:${service.port}/push/test-button`;
  const subId = db.subscriptions.upsert({
    endpoint, p256dh: subscriber.p256dh, auth: subscriber.auth.toString('base64url'),
  });

  const result = await push.sendTest({
    endpoint, p256dh: subscriber.p256dh, auth: subscriber.auth.toString('base64url'), sub_id: subId,
  });

  assert.equal(result.ok, true);
  assert.equal(service.received.length, 1, 'it goes through the push service, not around it');

  const payload = decryptPush(service.received[0].body, subscriber);
  assert.match(payload.title, /working/i, 'the notification states the outcome by itself');
  assert.equal(payload.test, true, 'and is marked so nothing mistakes it for a real arrival');
  assert.ok(!payload.plate, 'no bus is approaching — it must not claim one is');

  // Tapping a notification has to arrive somewhere. The client routes `plate`, `from`/`to` and
  // the hash, and silently falls back to the home screen for anything else — which is exactly
  // how `?screen=settings` went unnoticed.
  assert.match(payload.url, /^\/(#\w+|\?(plate|from)=)/,
    'the tap target must be a route the app actually handles');
});
