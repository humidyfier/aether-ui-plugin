import { WebSocket } from 'ws';
import { AetherHmrAckPayload, AetherPendingWrite, DomVerificationSignature } from './handshake.model';

export const FIBER_BRIDGE_BROWSER_CODE = `
(function () {
  const wsPort = window.__AETHER_BRIDGE_WS_PORT__ || 6174;
  const wsUrl = 'ws://' + window.location.hostname + ':' + wsPort;
  let socket = null;
  let activePendingWrites = new Map();
  let selectedUid = null;
  let hoveredUid = null;

  // 1. Inject visual selection overlay styles
  const styleEl = document.createElement('style');
  styleEl.id = '__aether_bridge_styles__';
  styleEl.textContent = \`
    [data-aether-selected="true"] {
      outline: 2px solid #2563eb !important;
      outline-offset: 2px !important;
      background-color: rgba(37, 99, 235, 0.08) !important;
      transition: outline 0.15s ease, background-color 0.15s ease !important;
    }
    [data-aether-hovered="true"]:not([data-aether-selected="true"]) {
      outline: 1.5px dashed #60a5fa !important;
      outline-offset: 1px !important;
      background-color: rgba(96, 165, 250, 0.04) !important;
    }
  \`;
  document.head.appendChild(styleEl);

  function connect() {
    socket = new WebSocket(wsUrl);
    socket.addEventListener('open', () => {
      console.log('[Aether Fiber Bridge] Connected to host bridge server on ' + wsUrl);
      emitLayoutMetrics();
    });

    socket.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'AETHER_PENDING_WRITE') {
          activePendingWrites.set(msg.txId, msg);
        } else if (msg.type === 'AETHER_SELECT_ELEMENT') {
          selectElementByUid(msg.targetUid, false);
        } else if (msg.type === 'AETHER_REQUEST_METRICS') {
          emitLayoutMetrics();
        }
      } catch (e) {
        console.error('[Aether Fiber Bridge] Error parsing message', e);
      }
    });

    socket.addEventListener('close', () => {
      setTimeout(connect, 1500);
    });
  }

  if (typeof window !== 'undefined') {
    connect();
  }

  function inspectDomElement(uid) {
    const el = document.querySelector('[data-aether-uid="' + uid + '"]');
    if (!el) return null;

    const attrs = {};
    for (let i = 0; i < el.attributes.length; i++) {
      const a = el.attributes[i];
      attrs[a.name] = a.value;
    }

    const computed = window.getComputedStyle ? window.getComputedStyle(el) : null;
    const computedStyles = {};
    if (computed) {
      computedStyles.color = computed.color;
      computedStyles.backgroundColor = computed.backgroundColor;
      computedStyles.fontSize = computed.fontSize;
      computedStyles.padding = computed.padding;
      computedStyles.margin = computed.margin;
    }

    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };

    return {
      uid: uid,
      tagName: el.tagName.toLowerCase(),
      textContent: el.textContent ? el.textContent.trim() : '',
      attributes: attrs,
      computedStyles: computedStyles,
      rect: {
        x: rect.x || rect.left || 0,
        y: rect.y || rect.top || 0,
        width: rect.width || 0,
        height: rect.height || 0
      }
    };
  }

  function emitLayoutMetrics() {
    const elements = document.querySelectorAll('[data-aether-uid]');
    const metrics = [];

    elements.forEach((el) => {
      const uid = el.getAttribute('data-aether-uid');
      if (!uid) return;
      const rect = el.getBoundingClientRect();
      const isInteractive = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName);

      metrics.push({
        uid: uid,
        tagName: el.tagName.toLowerCase(),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        isInteractive: isInteractive
      });
    });

    if (socket && socket.readyState === WebSocket.OPEN && metrics.length > 0) {
      socket.send(JSON.stringify({
        type: 'AETHER_LAYOUT_METRICS',
        metrics: metrics,
        viewportWidth: window.innerWidth,
        timestamp: new Date().toISOString()
      }));
    }
  }

  function selectElementByUid(uid, notifyParent = true) {
    // Clear existing selection
    document.querySelectorAll('[data-aether-selected="true"]').forEach((el) => {
      el.removeAttribute('data-aether-selected');
    });

    selectedUid = uid;
    if (uid) {
      const target = document.querySelector('[data-aether-uid="' + uid + '"]');
      if (target) {
        target.setAttribute('data-aether-selected', 'true');
        const sig = inspectDomElement(uid);

        if (notifyParent) {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'AETHER_ELEMENT_SELECTED', uid: uid, signature: sig }, '*');
          }
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'AETHER_ELEMENT_SELECTED', uid: uid, signature: sig }));
          }
        }
      }
    } else {
      if (notifyParent) {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'AETHER_ELEMENT_SELECTED', uid: null }, '*');
        }
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'AETHER_ELEMENT_SELECTED', uid: null }));
        }
      }
    }
  }

  // 2. Interactive DOM Events: Hover & Click selection on [data-aether-uid] elements
  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('[data-aether-uid]');
    if (target) {
      const uid = target.getAttribute('data-aether-uid');
      if (hoveredUid !== uid) {
        if (hoveredUid) {
          const prev = document.querySelector('[data-aether-uid="' + hoveredUid + '"]');
          if (prev) prev.removeAttribute('data-aether-hovered');
        }
        hoveredUid = uid;
        target.setAttribute('data-aether-hovered', 'true');
      }
    } else if (hoveredUid) {
      const prev = document.querySelector('[data-aether-uid="' + hoveredUid + '"]');
      if (prev) prev.removeAttribute('data-aether-hovered');
      hoveredUid = null;
    }
  });

  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-aether-uid]');
    if (target) {
      e.preventDefault();
      e.stopPropagation();
      const uid = target.getAttribute('data-aether-uid');
      selectElementByUid(uid, true);
    }
  }, true);

  // 3. Escape key clears selection (PRD Section 8)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      selectElementByUid(null, true);
    }
  });

  // 4. Hook into Vite HMR afterUpdate event
  function handleHmrUpdate() {
    const now = Date.now();
    for (const [txId, pending] of activePendingWrites.entries()) {
      const sig = inspectDomElement(pending.targetUid);
      const ack = {
        type: 'AETHER_HMR_ACK',
        txId: txId,
        targetUid: pending.targetUid,
        verified: Boolean(sig),
        domSignature: sig || undefined,
        latencyMs: now - new Date(pending.timestamp).getTime(),
        timestamp: new Date().toISOString()
      };

      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(ack));
      }
      activePendingWrites.delete(txId);
    }
    emitLayoutMetrics();
  }

  window.addEventListener('vite:afterUpdate', handleHmrUpdate);

  if (typeof import.meta !== 'undefined' && import.meta.hot) {
    import.meta.hot.on('vite:afterUpdate', handleHmrUpdate);
  }
})();
`;

/**
 * Mock browser client simulator for end-to-end integration testing of the Fiber Bridge handshake.
 */
export class MockFiberClient {
  private ws: WebSocket | null = null;
  private pendingWrites = new Map<string, AetherPendingWrite>();
  private mockDom = new Map<string, DomVerificationSignature>();

  constructor(private bridgeUrl: string) {}

  public async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.bridgeUrl);

      this.ws.on('open', () => {
        resolve();
      });

      this.ws.on('error', (err) => {
        reject(err);
      });

      this.ws.on('message', (data: string) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'AETHER_PENDING_WRITE') {
            this.pendingWrites.set(msg.txId, msg);
          }
        } catch (e) {
          // ignore
        }
      });
    });
  }

  public registerDomElement(signature: DomVerificationSignature): void {
    this.mockDom.set(signature.uid, signature);
  }

  /**
   * Simulates receipt of Vite's `vite:afterUpdate` HMR event.
   */
  public simulateViteAfterUpdate(txId: string): void {
    const pending = this.pendingWrites.get(txId);
    if (!pending || !this.ws) return;

    const signature = this.mockDom.get(pending.targetUid);
    const latency = Date.now() - new Date(pending.timestamp).getTime();

    const ack: AetherHmrAckPayload = {
      type: 'AETHER_HMR_ACK',
      txId,
      targetUid: pending.targetUid,
      verified: Boolean(signature),
      domSignature: signature,
      latencyMs: Math.max(1, latency),
      timestamp: new Date().toISOString(),
    };

    this.ws.send(JSON.stringify(ack));
    this.pendingWrites.delete(txId);
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
