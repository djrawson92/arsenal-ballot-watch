import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authHeader, credentials } from '../src/x.mjs';

// The worked example from X's "Creating a signature" OAuth 1.0a guide.
test('signs requests exactly like X documents', () => {
  const creds = {
    consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
    consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
    token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
    tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
  };
  const header = authHeader(
    'post',
    'https://api.twitter.com/1.1/statuses/update.json',
    creds,
    { status: 'Hello Ladies + Gentlemen, a signed OAuth request!', include_entities: 'true' },
    'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
    1318622958,
  );
  assert.match(header, /oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"/);
});

test('tweeting is off until all four keys are set', () => {
  const all = { X_API_KEY: 'a', X_API_SECRET: 'b', X_ACCESS_TOKEN: 'c', X_ACCESS_SECRET: 'd' };
  assert.ok(credentials(all));
  assert.equal(credentials({ ...all, X_ACCESS_SECRET: '' }), null);
});
