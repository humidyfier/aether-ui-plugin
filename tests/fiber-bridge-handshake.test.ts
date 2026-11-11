import { test, describe, afterEach } from 'node:test';
import * as assert from 'node:assert';
import {
  FiberBridgeServer,
  MockFiberClient,
} from '../src/index';

describe('Module 2 Requirement 3: Runtime Fiber Bridge & WebSocket Handshake', () => {
  let server: FiberBridgeServer | null = null;
  let client: MockFiberClient | null = null;
  const bridgePort = 6280;

  afterEach(async () => {
    if (client) {
      client.disconnect();
      client = null;
    }
    if (server) {
      await server.stop();
      server = null;
    }
  });

  test('Performs full handshake: AETHER_PENDING_WRITE -> vite:afterUpdate -> AETHER_HMR_ACK', async () => {
    server = new FiberBridgeServer({ port: bridgePort });
    await server.start();

    client = new MockFiberClient(server.getWsUrl());
    await client.connect();

    // Register simulated DOM element in the mock browser client
    client.registerDomElement({
      uid: 'aether-btn-1',
      tagName: 'button',
      textContent: 'Save Changes',
      attributes: {
        'data-aether-uid': 'aether-btn-1',
        class: 'primary-button',
      },
      computedStyles: {
        backgroundColor: 'rgb(46, 125, 50)',
        color: 'rgb(255, 255, 255)',
        padding: '10px 18px',
      },
    });

    const txId = 'tx-1001';

    // 1. Host registers pending candidate AST write
    server.registerPendingWrite({
      txId,
      targetUid: 'aether-btn-1',
      expectedTag: 'button',
      expectedProps: { class: 'primary-button' },
      expectedStyles: { color: 'rgb(255, 255, 255)' },
      expectedText: 'Save Changes',
      timestamp: new Date().toISOString(),
    });

    // 2. Browser receives Vite HMR afterUpdate and responds with AETHER_HMR_ACK
    setTimeout(() => {
      client?.simulateViteAfterUpdate(txId);
    }, 20);

    // 3. Host waits for handshake completion
    const result = await server.waitForHmrAck(txId, 2000);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.verified, true);
    assert.strictEqual(result.targetUid, 'aether-btn-1');
    assert.ok(result.latencyMs >= 0);
    assert.strictEqual(result.ackPayload?.domSignature?.tagName, 'button');
    assert.strictEqual(result.ackPayload?.verificationDetails?.tagMatches, true);
    assert.strictEqual(result.ackPayload?.verificationDetails?.propsMatch, true);
    assert.strictEqual(result.ackPayload?.verificationDetails?.stylesMatch, true);
    assert.strictEqual(result.ackPayload?.verificationDetails?.textMatches, true);
  });

  test('Detects mismatch when live DOM does not reflect candidate AST mutation', async () => {
    server = new FiberBridgeServer({ port: bridgePort + 1 });
    await server.start();

    client = new MockFiberClient(server.getWsUrl());
    await client.connect();

    // Register DOM element with mismatched color and text
    client.registerDomElement({
      uid: 'aether-card-2',
      tagName: 'div',
      textContent: 'Old Text',
      attributes: { 'data-aether-uid': 'aether-card-2' },
      computedStyles: { color: 'rgb(0, 0, 0)' },
    });

    const txId = 'tx-1002';

    server.registerPendingWrite({
      txId,
      targetUid: 'aether-card-2',
      expectedTag: 'div',
      expectedStyles: { color: 'rgb(255, 0, 0)' }, // Expecting red, actual is black
      expectedText: 'New Updated Card Title', // Expecting new text
      timestamp: new Date().toISOString(),
    });

    setTimeout(() => {
      client?.simulateViteAfterUpdate(txId);
    }, 20);

    const result = await server.waitForHmrAck(txId, 2000);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.verified, false); // Failed verification
    assert.ok(result.error?.includes('DOM mismatches'));
    assert.strictEqual(result.ackPayload?.verificationDetails?.stylesMatch, false);
    assert.strictEqual(result.ackPayload?.verificationDetails?.textMatches, false);
  });

  test('Handles timeout gracefully if browser HMR stalls', async () => {
    server = new FiberBridgeServer({ port: bridgePort + 2 });
    await server.start();

    const txId = 'tx-stalled-999';

    server.registerPendingWrite({
      txId,
      targetUid: 'aether-missing-node',
      timestamp: new Date().toISOString(),
    });

    // Do NOT trigger simulateViteAfterUpdate -> wait for timeout
    const result = await server.waitForHmrAck(txId, 100);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.verified, false);
    assert.ok(result.error?.includes('HMR handshake timeout'));
  });
});
