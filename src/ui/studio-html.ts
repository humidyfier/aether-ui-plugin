export interface StudioHtmlOptions {
  embed?: string | string[];
}

export function renderStudioHtml(initialState?: any, options?: StudioHtmlOptions): string {
  const stateJson = JSON.stringify(initialState || {}).replace(/</g, '\\u003c');
  const isEmbedInitial = Boolean(options?.embed === 'hermes');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aether UI — Hermes Studio Workspace</title>
  <style>
    :root {
      --bg-dark: #0f172a;
      --bg-card: #1e293b;
      --bg-surface: #182234;
      --bg-panel: #111827;
      --border-color: #334155;
      --border-subtle: #1e293b;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --accent: #8b5cf6;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      --font-mono: 'JetBrains Mono', 'Fira Code', Menlo, monospace;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg-dark);
      color: var(--text-main);
      font-family: var(--font-sans);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      font-size: 13px;
    }

    /* TOP BAR (Region 1: Project/Version Strip) */
    header#top-bar {
      height: 48px;
      background-color: var(--bg-panel);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      gap: 16px;
      z-index: 10;
      flex-shrink: 0;
    }
    .top-left { display: flex; align-items: center; gap: 12px; }
    .project-title { font-weight: 700; font-size: 14px; letter-spacing: -0.2px; color: #fff; }
    .state-badge {
      padding: 3px 8px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      background: rgba(59, 130, 246, 0.15);
      color: #60a5fa;
      border: 1px solid rgba(59, 130, 246, 0.3);
    }
    .revision-strip {
      display: flex;
      gap: 8px;
      font-family: var(--font-mono);
      font-size: 11px;
    }
    .rev-pill {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      padding: 2px 6px;
      border-radius: 4px;
      color: var(--text-muted);
    }
    .rev-pill span { color: #38bdf8; }
    .viewport-switcher {
      display: flex;
      background: var(--bg-card);
      border-radius: 6px;
      padding: 2px;
      border: 1px solid var(--border-color);
    }
    .viewport-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 4px 10px;
      font-size: 11px;
      cursor: pointer;
      border-radius: 4px;
      font-weight: 500;
      transition: all 0.15s ease;
    }
    .viewport-btn.active {
      background: var(--primary);
      color: white;
    }
    .slot-toggle {
      display: flex;
      background: var(--bg-card);
      border-radius: 6px;
      padding: 2px;
      border: 1px solid var(--border-color);
    }
    .slot-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 4px 8px;
      font-size: 11px;
      cursor: pointer;
      border-radius: 4px;
    }
    .slot-btn.active {
      background: #059669;
      color: white;
      font-weight: 600;
    }

    /* HERMES SPLIT-SCREEN EMBED STYLES */
    .hermes-badge {
      padding: 3px 8px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.5px;
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.4);
    }
    .split-mode-btn, .chat-toggle-btn {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      padding: 4px 10px;
      font-size: 11px;
      cursor: pointer;
      border-radius: 6px;
      font-weight: 500;
      transition: all 0.15s ease;
    }
    .split-mode-btn:hover, .chat-toggle-btn:hover {
      background: #334155;
    }
    .split-mode-btn.active {
      background: var(--primary);
      border-color: var(--primary);
      color: #fff;
    }
    body.hermes-embed #left-pane {
      display: none !important;
    }
    body.hermes-embed.show-chat #left-pane {
      display: flex !important;
    }
    body.hermes-embed #hermes-badge {
      display: inline-block !important;
    }
    body.hermes-embed #chat-toggle-btn {
      display: inline-block !important;
    }
    body.hermes-embed .preview-frame-wrapper {
      max-width: 100% !important;
    }

    /* MAIN WORKSPACE (Regions 2, 3, 4) */
    #workspace-body {
      flex: 1;
      display: flex;
      min-height: 0;
      overflow: hidden;
    }

    /* REGION 2: Left Conversation Pane */
    aside#left-pane {
      width: 320px;
      background: var(--bg-panel);
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }
    .pane-header {
      padding: 10px 14px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border-subtle);
    }
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .chat-msg {
      padding: 8px 12px;
      border-radius: 6px;
      line-height: 1.4;
      max-width: 90%;
      word-break: break-word;
    }
    .chat-msg.user {
      align-self: flex-end;
      background: #1e3a8a;
      color: #e0e7ff;
    }
    .chat-msg.agent {
      align-self: flex-start;
      background: var(--bg-card);
      color: var(--text-main);
      border: 1px solid var(--border-color);
    }
    .chat-input-bar {
      padding: 10px;
      border-top: 1px solid var(--border-color);
      display: flex;
      gap: 6px;
      background: var(--bg-panel);
    }
    .chat-input-bar input {
      flex: 1;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      padding: 8px 10px;
      border-radius: 6px;
      outline: none;
      font-size: 12px;
    }
    .btn-send {
      background: var(--primary);
      color: white;
      border: none;
      padding: 0 12px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 500;
    }

    /* REGION 3: Center Design Canvas */
    main#center-canvas {
      flex: 1;
      background: #0a0f1d;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow: hidden;
      align-items: center;
      justify-content: center;
    }
    .canvas-container {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 16px;
      position: relative;
    }
    .preview-frame-wrapper {
      transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      height: 100%;
      background: var(--bg-card);
      border-radius: 8px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
      position: relative;
      overflow: hidden;
      border: 1px solid var(--border-color);
    }
    iframe#preview-frame {
      width: 100%;
      height: 100%;
      border: none;
      background: #0f172a;
    }
    .validation-overlay {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      border: 3px dashed var(--warning);
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s ease;
      z-index: 5;
    }
    .validation-overlay.active { opacity: 1; }
    .commit-flash {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(16, 185, 129, 0.2);
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.4s ease;
      z-index: 6;
    }
    .commit-flash.active { opacity: 1; }

    /* CARD GALLERIES FOR BRIEF/UX/UI REVIEWS */
    .review-gallery {
      width: 100%;
      max-width: 960px;
      max-height: 90%;
      overflow-y: auto;
      padding: 16px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
    }
    .review-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      transition: border-color 0.15s ease, transform 0.15s ease;
    }
    .review-card.selected {
      border-color: var(--primary);
      box-shadow: 0 0 0 2px var(--primary);
    }
    .review-card h4 { font-size: 15px; color: #fff; }
    .review-card p { color: var(--text-muted); font-size: 12px; line-height: 1.4; }
    .btn-select-card {
      margin-top: auto;
      background: var(--primary);
      color: white;
      border: none;
      padding: 8px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 500;
      font-size: 12px;
    }

    /* REGION 4: Right Properties Panel */
    aside#right-pane {
      width: 320px;
      background: var(--bg-panel);
      border-left: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      overflow-y: auto;
    }
    .panel-section {
      padding: 14px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .blast-radius-badge {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #f87171;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .prop-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .prop-group label {
      font-size: 11px;
      color: var(--text-muted);
      font-weight: 500;
    }
    .prop-group input {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      color: #fff;
      padding: 6px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-family: var(--font-mono);
    }
    .btn-apply-edit {
      background: var(--primary);
      color: white;
      border: none;
      padding: 8px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      margin-top: 6px;
    }
    .lock-pill {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
      cursor: pointer;
    }

    /* REGION 5: Bottom Reference Shelf */
    section#bottom-shelf {
      height: 72px;
      background: var(--bg-panel);
      border-top: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      padding: 0 16px;
      gap: 12px;
      overflow-x: auto;
      flex-shrink: 0;
    }
    .ref-chip {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 6px 10px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 180px;
    }
    .ref-chip .title { font-weight: 600; font-size: 11px; color: #fff; }
    .ref-chip .source { font-size: 10px; color: var(--text-muted); }

    /* REGION 6: Bottom Decision Bar */
    footer#decision-bar {
      height: 52px;
      background: #0f172a;
      border-top: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      flex-shrink: 0;
    }
    .decision-actions { display: flex; gap: 10px; }
    .btn-action {
      background: var(--primary);
      color: white;
      border: none;
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s ease;
    }
    .btn-action:hover { background: var(--primary-hover); }
    .btn-action.secondary {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      color: var(--text-main);
    }
    .btn-action.secondary:hover { background: #334155; }
    .btn-action.danger {
      background: rgba(239, 68, 68, 0.2);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #f87171;
    }

    /* MODAL */
    .modal-backdrop {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      z-index: 100;
      align-items: center;
      justify-content: center;
    }
    .modal-backdrop.open { display: flex; }
    .modal-dialog {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      width: 520px;
      max-width: 90vw;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
    }
    .modal-header h3 { font-size: 16px; color: #fff; }
    .modal-body { font-size: 12px; color: var(--text-muted); line-height: 1.5; }
    .modal-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
  </style>
</head>
<body>

  <!-- REGION 1: Top Bar (Project / Version Strip) -->
  <header id="top-bar">
    <div class="top-left">
      <span class="project-title" id="project-title">Aether UI</span>
      <span class="state-badge" id="state-badge">GATHERING_BRIEF</span>
      <span class="hermes-badge" id="hermes-badge" style="display: none;">Hermes Split Mode</span>
      <div class="revision-strip">
        <div class="rev-pill" title="Host Baseline Revision">Host: <span id="rev-host">--</span></div>
        <div class="rev-pill" title="Slot A Verified Revision">Slot A: <span id="rev-slot-a">--</span></div>
        <div class="rev-pill" title="Slot B Candidate Revision">Slot B: <span id="rev-slot-b">--</span></div>
      </div>
    </div>

    <div style="display: flex; align-items: center; gap: 10px;">
      <button class="split-mode-btn" id="split-mode-btn" onclick="toggleSplitMode()">Compact / Split-Screen</button>
      <button class="chat-toggle-btn" id="chat-toggle-btn" onclick="toggleChatSidebar()" style="display: none;">Chat Sidebar</button>

      <div class="slot-toggle">
        <button class="slot-btn active" id="slot-b-btn" onclick="switchSlot('SLOT_B')">Slot B (Candidate)</button>
        <button class="slot-btn" id="slot-a-btn" onclick="switchSlot('SLOT_A')">Slot A (Verified)</button>
      </div>

      <div class="viewport-switcher">
        <button class="viewport-btn active" id="vp-1280" onclick="setViewport(1280)">1280px</button>
        <button class="viewport-btn" id="vp-768" onclick="setViewport(768)">768px</button>
        <button class="viewport-btn" id="vp-375" onclick="setViewport(375)">375px</button>
      </div>
    </div>
  </header>

  <!-- MAIN WORKSPACE -->
  <div id="workspace-body">
    <!-- REGION 2: Left Conversation Pane -->
    <aside id="left-pane">
      <div class="pane-header">Conversation & Activity</div>
      <div class="chat-messages" id="chat-messages">
        <div class="chat-msg agent">Welcome to Aether UI Hermes Studio. Describe your product concept or primary user tasks below to begin.</div>
      </div>
      <div class="chat-input-bar">
        <input type="text" id="chat-input" placeholder="Type prompt or instruction..." onkeydown="handleChatKey(event)">
        <button class="btn-send" onclick="sendChat()">Send</button>
      </div>
    </aside>

    <!-- REGION 3: Center Design Canvas -->
    <main id="center-canvas">
      <div class="canvas-container">
        <div class="preview-frame-wrapper" id="frame-wrapper" style="width: 1280px;">
          <iframe id="preview-frame" src="about:blank"></iframe>
          <div class="validation-overlay" id="val-overlay"></div>
          <div class="commit-flash" id="commit-flash"></div>
        </div>
        <div class="review-gallery" id="review-gallery" style="display: none;"></div>
      </div>
    </main>

    <!-- REGION 4: Right Properties Panel -->
    <aside id="right-pane">
      <div class="pane-header">Properties & AST Inspector</div>
      <div class="panel-section" id="selection-section">
        <div style="font-size: 11px; color: var(--text-muted);">Selected Target UID</div>
        <div id="prop-uid" style="font-family: var(--font-mono); font-size: 12px; color: #38bdf8;">None (Click element in preview)</div>
        <div id="blast-warning" class="blast-radius-badge" style="display: none;">
          ⚠️ BR-08: Shared Component (Affects multiple files)
        </div>
      </div>

      <div class="panel-section">
        <div style="font-size: 11px; font-weight: 600; color: #fff;">USER_LOCKED Property Scopes</div>
        <div style="display: flex; gap: 6px; flex-wrap: wrap;" id="lock-pills">
          <span class="lock-pill" onclick="toggleLock('typography')">Typography: UNLOCKED</span>
          <span class="lock-pill" onclick="toggleLock('layout')">Layout: UNLOCKED</span>
          <span class="lock-pill" onclick="toggleLock('color')">Color: UNLOCKED</span>
        </div>
      </div>

      <div class="panel-section">
        <div class="prop-group">
          <label>Text Content</label>
          <input type="text" id="prop-text" placeholder="Element text content">
        </div>
        <div class="prop-group">
          <label>Tailwind Classes</label>
          <input type="text" id="prop-classes" placeholder="e.g. text-blue-600 font-bold p-4">
        </div>
        <button class="btn-apply-edit" onclick="applyDirectEdit()">Apply Edit (Tier 1 AST Surgery)</button>
        <button class="btn-action secondary" style="margin-top: 6px;" onclick="clearSelection()">Clear Selection (Esc)</button>
      </div>
    </aside>
  </div>

  <!-- REGION 5: Bottom Reference Shelf -->
  <section id="bottom-shelf">
    <div style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">References:</div>
    <div class="ref-chip">
      <span class="title">Linear Design System</span>
      <span class="source">Observed: High-density, subtle borders, monochromatic palettes</span>
    </div>
    <div class="ref-chip">
      <span class="title">Stripe Dashboard</span>
      <span class="source">Observed: Clear tab navigation, crisp typography, responsive drawer</span>
    </div>
  </section>

  <!-- REGION 6: Bottom Decision Bar -->
  <footer id="decision-bar">
    <div style="display: flex; gap: 8px;">
      <button class="btn-action secondary" onclick="exportHandoff('markdown')">Export HANDOFF.md (FR-20)</button>
      <button class="btn-action secondary" onclick="exportHandoff('json')">Export JSON</button>
    </div>
    <div class="decision-actions">
      <button class="btn-action danger" onclick="denyCandidate()">Revert Candidate (Slot B)</button>
      <button class="btn-action" id="primary-action-btn" onclick="handlePrimaryAction()">Proceed to Next Stage</button>
    </div>
  </footer>

  <!-- IMPLEMENTATION APPROVAL MODAL (FR-19) -->
  <div class="modal-backdrop" id="approval-modal">
    <div class="modal-dialog">
      <div class="modal-header">
        <h3>Implementation Approval Gate (FR-19)</h3>
      </div>
      <div class="modal-body" id="approval-modal-body">
        Review candidate changes before promoting Slot B to the host project.
      </div>
      <div class="modal-footer">
        <button class="btn-action secondary" onclick="closeApprovalModal()">Cancel</button>
        <button class="btn-action" onclick="confirmPromote()">Approve & Promote to Host</button>
      </div>
    </div>
  </div>

  <script>
    let studioState = ${stateJson};
    let activeSlot = 'SLOT_B';
    let currentSelectedUid = null;
    let ws = null;
    const urlParams = new URLSearchParams(window.location.search);
    let isSplitMode = urlParams.get('embed') === 'hermes' || ${isEmbedInitial};

    function updateSplitModeUI() {
      if (isSplitMode) {
        document.body.classList.add('hermes-embed');
        document.getElementById('split-mode-btn').classList.add('active');
        document.getElementById('hermes-badge').style.display = 'inline-block';
        document.getElementById('chat-toggle-btn').style.display = 'inline-block';
      } else {
        document.body.classList.remove('hermes-embed');
        document.body.classList.remove('show-chat');
        document.getElementById('split-mode-btn').classList.remove('active');
        document.getElementById('hermes-badge').style.display = 'none';
        document.getElementById('chat-toggle-btn').style.display = 'none';
      }
    }

    function toggleSplitMode() {
      isSplitMode = !isSplitMode;
      updateSplitModeUI();
    }

    function toggleChatSidebar() {
      document.body.classList.toggle('show-chat');
    }

    function init() {
      updateSplitModeUI();
      renderState(studioState);
      connectWebSocket();
      setupIframeListener();
    }

    function connectWebSocket() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = protocol + '//' + window.location.host + '/ws';
      ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'STATE_UPDATE') {
            studioState = msg.state;
            renderState(studioState);
          } else if (msg.type === 'TRANSACTION_COMMITTED') {
            flashCommit();
          } else if (msg.type === 'VALIDATION_STARTED') {
            setValidationOverlay(true);
          } else if (msg.type === 'VALIDATION_COMPLETED') {
            setValidationOverlay(false);
          }
        } catch (e) {
          console.error('[Studio UI] Error handling WS message', e);
        }
      };

      ws.onclose = () => {
        setTimeout(connectWebSocket, 2000);
      };
    }

    function setupIframeListener() {
      window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'AETHER_ELEMENT_SELECTED') {
          handleElementSelected(event.data.uid, event.data.signature);
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          clearSelection();
        }
      });
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    async function generateUXDirections() {
      try {
        const res = await fetch('/api/ux/generate', { method: 'POST' });
        const data = await res.json();
        if (data.directions) {
          renderState({ ...studioState, currentState: 'UX Review', uxDirections: data.directions });
        }
      } catch (e) {
        alert('Failed to generate UX directions: ' + e.message);
      }
    }

    async function selectUXDirection(id) {
      try {
        const res = await fetch('/api/ux/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ directionId: id })
        });
        const data = await res.json();
        if (data.success) {
          const uiRes = await fetch('/api/ui/generate', { method: 'POST' });
          const uiData = await uiRes.json();
          if (uiData.concepts) {
            renderState({ ...studioState, currentState: 'UI Review', uiConcepts: uiData.concepts });
          }
        }
      } catch (e) {
        alert('Failed to select UX direction: ' + e.message);
      }
    }

    async function selectUIConcept(id) {
      try {
        const res = await fetch('/api/ui/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conceptId: id })
        });
        const data = await res.json();
        if (data.success) {
          renderState({ ...studioState, currentState: 'Preview Ready' });
        }
      } catch (e) {
        alert('Failed to select UI concept: ' + e.message);
      }
    }

    function renderBriefCard(gallery, brief) {
      gallery.innerHTML = '';
      var card = document.createElement('div');
      card.className = 'review-card selected';
      card.style.gridColumn = '1 / -1';
      var isReady = brief.readiness && brief.readiness.isReady;
      var tasksHtml = (brief.primaryTasks || []).map(function(t) {
        return '<li>' + escapeHtml(t.goal || t.id) + '</li>';
      }).join('') || '<li>None</li>';
      var audHtml = (brief.targetAudience || []).map(function(a) {
        return '<li>' + escapeHtml(a.role || 'User') + ' (' + escapeHtml(a.skillLevel || 'any') + ')</li>';
      }).join('') || '<li>General</li>';

      card.innerHTML =
        '<div style="display:flex; justify-content:space-between; align-items:center;">' +
          '<h3 style="margin:0; font-size:18px; color:#fff;">📋 Active Project Brief: ' + escapeHtml(brief.name || 'Untitled') + '</h3>' +
          '<span style="font-size:11px; padding:3px 8px; border-radius:9999px; background:' + (isReady ? 'rgba(16,185,129,0.2)' : 'rgba(234,179,8,0.2)') + '; color:' + (isReady ? '#34d399' : '#facc15') + ';">' +
            (isReady ? 'READY FOR UX' : 'GATHERING') +
          '</span>' +
        '</div>' +
        '<p style="color:#cbd5e1; font-size:13px; line-height:1.5;">' + escapeHtml(brief.productContext || 'No context provided') + '</p>' +
        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:8px;">' +
          '<div style="background:var(--bg-panel); padding:10px; border-radius:6px; border:1px solid var(--border-color);">' +
            '<div style="font-size:11px; font-weight:600; color:var(--text-muted); margin-bottom:6px;">PRIMARY TASKS</div>' +
            '<ul style="margin:0; padding-left:16px; font-size:12px; color:var(--text-main);">' + tasksHtml + '</ul>' +
          '</div>' +
          '<div style="background:var(--bg-panel); padding:10px; border-radius:6px; border:1px solid var(--border-color);">' +
            '<div style="font-size:11px; font-weight:600; color:var(--text-muted); margin-bottom:6px;">TARGET AUDIENCE</div>' +
            '<ul style="margin:0; padding-left:16px; font-size:12px; color:var(--text-main);">' + audHtml + '</ul>' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:16px; display:flex; gap:10px;">' +
          '<button class="btn-select-card" style="width:100%;" onclick="generateUXDirections()">✨ Generate UX Directions</button>' +
        '</div>';
      gallery.appendChild(card);
    }

    function renderUXCards(gallery, uxDirections) {
      gallery.innerHTML = '';
      uxDirections.forEach(function(dir) {
        var card = document.createElement('div');
        card.className = 'review-card' + (dir.isSelected ? ' selected' : '');
        var recBadge = dir.isRecommended ? '<span style="font-size:10px; padding:2px 6px; border-radius:4px; background:#2563eb; color:white; font-weight:600;">RECOMMENDED</span>' : '';
        var strengths = (dir.strengths || []).join(', ');
        card.innerHTML =
          '<div style="display:flex; justify-content:space-between; align-items:flex-start;">' +
            '<h4 style="margin:0; font-size:16px; color:#fff;">' + escapeHtml(dir.title) + '</h4>' +
            recBadge +
          '</div>' +
          '<div style="font-size:11px; color:#38bdf8; text-transform:uppercase; font-weight:600;">Approach: ' + escapeHtml(dir.approach) + '</div>' +
          '<p style="color:#cbd5e1; font-size:13px; line-height:1.4;">' + escapeHtml(dir.userTaskFit || '') + '</p>' +
          '<div style="font-size:11px; color:var(--text-muted); margin-top:4px;">' +
            '<strong>Strengths:</strong> ' + escapeHtml(strengths) +
          '</div>' +
          '<button class="btn-select-card" onclick="selectUXDirection(\'' + escapeHtml(dir.id) + '\')">' +
            (dir.isSelected ? '✓ Selected' : 'Select This Direction') +
          '</button>';
        gallery.appendChild(card);
      });
    }

    function renderUICards(gallery, uiConcepts) {
      gallery.innerHTML = '';
      uiConcepts.forEach(function(c) {
        var card = document.createElement('div');
        card.className = 'review-card' + (c.isSelected ? ' selected' : '');
        var p = c.palette || {};
        var font = (c.typography && c.typography.fontFamilySans) || 'Sans';
        card.innerHTML =
          '<div style="display:flex; justify-content:space-between; align-items:flex-start;">' +
            '<h4 style="margin:0; font-size:16px; color:#fff;">' + escapeHtml(c.name) + '</h4>' +
          '</div>' +
          '<p style="color:#cbd5e1; font-size:13px; line-height:1.4;">' + escapeHtml(c.styleApproach || '') + '</p>' +
          '<div style="margin:8px 0;">' +
            '<div style="font-size:11px; font-weight:600; color:var(--text-muted); margin-bottom:6px;">PALETTE</div>' +
            '<div style="display:flex; gap:8px;">' +
              '<div title="Primary: ' + (p.primary || '') + '" style="width:28px; height:28px; border-radius:4px; background:' + (p.primary || '#3b82f6') + '; border:1px solid rgba(255,255,255,0.2);"></div>' +
              '<div title="Background: ' + (p.background || '') + '" style="width:28px; height:28px; border-radius:4px; background:' + (p.background || '#0f172a') + '; border:1px solid rgba(255,255,255,0.2);"></div>' +
              '<div title="Surface: ' + (p.surface || '') + '" style="width:28px; height:28px; border-radius:4px; background:' + (p.surface || '#1e293b') + '; border:1px solid rgba(255,255,255,0.2);"></div>' +
              '<div title="Text: ' + (p.textPrimary || '') + '" style="width:28px; height:28px; border-radius:4px; background:' + (p.textPrimary || '#f8fafc') + '; border:1px solid rgba(255,255,255,0.2);"></div>' +
              '<div title="Border: ' + (p.border || '') + '" style="width:28px; height:28px; border-radius:4px; background:' + (p.border || '#334155') + '; border:1px solid rgba(255,255,255,0.2);"></div>' +
            '</div>' +
          '</div>' +
          '<div style="font-size:11px; color:var(--text-muted);">' +
            '<strong>Font:</strong> ' + escapeHtml(font) +
          '</div>' +
          '<button class="btn-select-card" onclick="selectUIConcept(\'' + escapeHtml(c.id) + '\')">' +
            (c.isSelected ? '✓ Selected (Preview Ready)' : 'Select & Launch Preview') +
          '</button>';
        gallery.appendChild(card);
      });
    }

    function renderIdleCard(gallery) {
      gallery.innerHTML = '';
      var card = document.createElement('div');
      card.className = 'review-card';
      card.style.gridColumn = '1 / -1';
      card.style.padding = '32px';
      card.style.textAlign = 'center';
      card.style.maxWidth = '680px';
      card.style.margin = '40px auto';
      card.style.background = 'var(--bg-card)';
      card.style.border = '1px solid var(--border-color)';
      card.innerHTML =
        '<div style="font-size:36px; margin-bottom:12px;">🎨</div>' +
        '<h3 style="font-size:20px; font-weight:700; color:#fff; margin-bottom:8px;">Aether UI Design Studio</h3>' +
        '<p style="color:var(--text-muted); font-size:13px; line-height:1.6; margin-bottom:20px;">' +
          'Aether is ready to pair with you. When you ask Hermes in chat to design, prototype, or edit any UI component, ' +
          'your live brief, UX directions, and UI concepts will automatically appear here in real time.' +
        '</p>' +
        '<div style="display:inline-block; text-align:left; background:var(--bg-panel); padding:16px 20px; border-radius:8px; border:1px solid var(--border-subtle); margin-bottom:20px; width:100%;">' +
          '<div style="font-size:11px; font-weight:600; color:#38bdf8; text-transform:uppercase; margin-bottom:8px;">Example Prompts for Hermes:</div>' +
          '<div style="color:#cbd5e1; font-size:12px; margin-bottom:6px;">💬 "Create a clean dashboard analytics card with metrics and chart"</div>' +
          '<div style="color:#cbd5e1; font-size:12px; margin-bottom:6px;">💬 "Redesign the user profile modal with modern dark styling"</div>' +
          '<div style="color:#cbd5e1; font-size:12px;">💬 "Build an interactive pricing table with feature comparisons"</div>' +
        '</div>' +
        '<div style="font-size:11px; color:var(--text-muted);">' +
          'Studio Engine: <span style="color:#38bdf8; font-family:var(--font-mono);">http://127.0.0.1:4173</span>' +
        '</div>';
      gallery.appendChild(card);
    }

    function renderState(state) {
      if (!state) return;
      studioState = state;
      if (state.currentState) {
        document.getElementById('state-badge').innerText = state.currentState;
        updatePrimaryActionBtn(state.currentState);
      }
      if (state.revisionPointers) {
        document.getElementById('rev-host').innerText = (state.revisionPointers.host_baseline_rev || '').slice(0, 8);
        document.getElementById('rev-slot-a').innerText = (state.revisionPointers.verified_preview_rev || '').slice(0, 8);
        document.getElementById('rev-slot-b').innerText = (state.revisionPointers.candidate_work_rev || '').slice(0, 8);
      }

      const gallery = document.getElementById('review-gallery');
      const frameWrapper = document.getElementById('frame-wrapper');
      const currentState = state.currentState;

      if (currentState === 'UX Review' && state.uxDirections && state.uxDirections.length > 0) {
        frameWrapper.style.display = 'none';
        gallery.style.display = 'grid';
        renderUXCards(gallery, state.uxDirections);
      } else if (currentState === 'UI Review' && state.uiConcepts && state.uiConcepts.length > 0) {
        frameWrapper.style.display = 'none';
        gallery.style.display = 'grid';
        renderUICards(gallery, state.uiConcepts);
      } else if (currentState === 'Gathering Brief' && state.brief) {
        frameWrapper.style.display = 'none';
        gallery.style.display = 'grid';
        renderBriefCard(gallery, state.brief);
      } else if (currentState === 'Preview Ready' || currentState === 'Applying Edit' || currentState === 'Implementation Approval' || currentState === 'Building' || currentState === 'Build Success') {
        gallery.style.display = 'none';
        frameWrapper.style.display = 'block';

        // Slot preview URL handling
        const slotAPort = state.slotAPort || 4174;
        const slotBPort = state.slotBPort || 4175;
        const targetPort = activeSlot === 'SLOT_A' ? slotAPort : slotBPort;
        const previewUrl = 'http://' + window.location.hostname + ':' + targetPort;

        const iframe = document.getElementById('preview-frame');
        if (iframe && iframe.src !== previewUrl) {
          iframe.src = previewUrl;
        }
      } else {
        frameWrapper.style.display = 'none';
        gallery.style.display = 'grid';
        renderIdleCard(gallery);
      }
    }

    function setViewport(width) {
      document.getElementById('frame-wrapper').style.width = width + 'px';
      document.querySelectorAll('.viewport-btn').forEach(b => b.classList.remove('active'));
      const activeBtn = document.getElementById('vp-' + width);
      if (activeBtn) activeBtn.classList.add('active');
    }

    function switchSlot(slotId) {
      activeSlot = slotId;
      document.getElementById('slot-a-btn').classList.toggle('active', slotId === 'SLOT_A');
      document.getElementById('slot-b-btn').classList.toggle('active', slotId === 'SLOT_B');
      renderState(studioState);
    }

    function handleElementSelected(uid, signature) {
      currentSelectedUid = uid;
      const uidEl = document.getElementById('prop-uid');
      if (!uid) {
        uidEl.innerText = 'None (Click element in preview)';
        document.getElementById('blast-warning').style.display = 'none';
        return;
      }

      uidEl.innerText = uid;
      if (signature) {
        document.getElementById('prop-text').value = signature.textContent || '';
        document.getElementById('prop-classes').value = (signature.attributes && signature.attributes.class) || '';
      }
    }

    function clearSelection() {
      handleElementSelected(null, null);
      const iframe = document.getElementById('preview-frame');
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'AETHER_SELECT_ELEMENT', targetUid: null }, '*');
      }
    }

    function toggleLock(scope) {
      alert('Toggled lock scope for ' + scope);
    }

    async function applyDirectEdit() {
      if (!currentSelectedUid) {
        alert('Please select an element with [data-aether-uid] first.');
        return;
      }
      const newText = document.getElementById('prop-text').value;
      const newClasses = document.getElementById('prop-classes').value;

      try {
        const res = await fetch('/api/edit/direct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetUid: currentSelectedUid,
            classes: newClasses,
            text: newText
          })
        });
        const data = await res.json();
        if (data.success) {
          flashCommit();
        } else {
          alert('Edit failed: ' + (data.error || 'Unknown error'));
        }
      } catch (err) {
        alert('Request failed: ' + err.message);
      }
    }

    async function sendChat() {
      const input = document.getElementById('chat-input');
      const val = input.value.trim();
      if (!val) return;

      appendChatMessage('user', val);
      input.value = '';

      try {
        const res = await fetch('/api/session/context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: val })
        });
        const data = await res.json();
        if (data.reply) {
          appendChatMessage('agent', data.reply);
        }
      } catch (err) {
        appendChatMessage('agent', 'Error sending context: ' + err.message);
      }
    }

    function handleChatKey(e) {
      if (e.key === 'Enter') sendChat();
    }

    function appendChatMessage(sender, text) {
      const box = document.getElementById('chat-messages');
      const msg = document.createElement('div');
      msg.className = 'chat-msg ' + sender;
      msg.innerText = text;
      box.appendChild(msg);
      box.scrollTop = box.scrollHeight;
    }

    function flashCommit() {
      const flash = document.getElementById('commit-flash');
      flash.classList.add('active');
      setTimeout(() => flash.classList.remove('active'), 500);
    }

    function setValidationOverlay(active) {
      const val = document.getElementById('val-overlay');
      val.classList.toggle('active', active);
    }

    function updatePrimaryActionBtn(state) {
      const btn = document.getElementById('primary-action-btn');
      if (state === 'GATHERING_BRIEF') {
        btn.innerText = 'Approve Brief & Proceed to UX';
      } else if (state === 'UX_REVIEW') {
        btn.innerText = 'Lock UX & Proceed to UI';
      } else if (state === 'UI_REVIEW') {
        btn.innerText = 'Select UI & Prepare Preview';
      } else if (state === 'PREVIEW_READY' || state === 'APPLYING_EDIT') {
        btn.innerText = 'Review & Approve Implementation';
      } else {
        btn.innerText = 'Proceed';
      }
    }

    function handlePrimaryAction() {
      const curState = studioState.currentState;
      if (curState === 'PREVIEW_READY' || curState === 'APPLYING_EDIT') {
        openApprovalModal();
      } else if (curState === 'GATHERING_BRIEF') {
        fetch('/api/ux/generate', { method: 'POST' }).then(() => fetchState());
      } else if (curState === 'UX_REVIEW') {
        fetch('/api/ui/generate', { method: 'POST' }).then(() => fetchState());
      }
    }

    function openApprovalModal() {
      document.getElementById('approval-modal').classList.add('open');
    }
    function closeApprovalModal() {
      document.getElementById('approval-modal').classList.remove('open');
    }

    async function confirmPromote() {
      closeApprovalModal();
      try {
        const res = await fetch('/api/approval/promote', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          alert('Promoted successfully to host!');
          fetchState();
        } else {
          alert('Promotion rejected: ' + data.error);
        }
      } catch (err) {
        alert('Promotion failed: ' + err.message);
      }
    }

    async function denyCandidate() {
      if (!confirm('Revert all unapproved candidate edits in Slot B back to Slot A?')) return;
      await fetch('/api/approval/deny', { method: 'POST' });
      fetchState();
    }

    function exportHandoff(format) {
      window.open('/api/handoff/export?format=' + format, '_blank');
    }

    async function fetchState() {
      const res = await fetch('/api/state');
      studioState = await res.json();
      renderState(studioState);
    }

    window.onload = init;
  </script>
</body>
</html>
`;
}
