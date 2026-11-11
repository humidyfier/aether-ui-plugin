# Aether UI Plugin

> Visual pair-programming engine, AST surgery, and multi-stage design studio plugin for **Hermes Agent** and **Hermes Desktop**.

Aether UI bridges generative AI agents with visual frontend pair programming. Instead of dumping raw HTML/code blocks directly into conversation threads, Aether UI provides a structured multi-stage workflow:
1. **Context & Ingestion** (`FR-01`): Structured brief validation and readiness checks.
2. **UX Exploration** (`FR-02`, `FR-03`): Interactive horizontal card decks rendered right inside Hermes chat (`composer.top`), allowing users to browse generations and select UX directions.
3. **UI Concept Synthesis** (`FR-04`, `FR-05`): High-fidelity style archetypes with color palettes, typography, layout density, and component traits.
4. **Isolated Dual-Slot Sandbox & AST Surgery** (`FR-09` to `FR-19`): Slot A (verified baseline) vs. Slot B (candidate edit). AST mutations are verified and previewed in an isolated worktree before host promotion.
5. **Production Handoff Package** (`FR-20`): Deterministic JSON and Markdown exports including Merkle manifests, design tokens, and audit profiles.

---

## Architecture Overview

```
                      ┌──────────────────────────────┐
                      │    Hermes Desktop / Agent    │
                      └──────┬────────────────┬──────┘
                             │ (MCP Protocol) │ (Desktop SDK / Host)
                             ▼                ▼
                     ┌──────────────┐   ┌──────────────────────────┐
                     │  Aether MCP  │   │     Aether Desktop       │
                     │    Server    │   │      plugin.js           │
                     └──────┬───────┘   │ (Cards & Stage Switcher) │
                            │           └─────────────┬────────────┘
                            │ REST / WebSocket        │
                            ▼                         │
                      ┌─────────────────────────┐     │
                      │   StudioServer (REST)   │◄────┘
                      │ (Port 3000 / Dynamic)   │
                      └────────────┬────────────┘
                                   │
                 ┌─────────────────┴─────────────────┐
                 ▼                                   ▼
      ┌────────────────────┐               ┌────────────────────┐
      │ SQLite StateLedger │               │  DualSlotManager   │
      │   (Checkpoints &   │               │   (Slot A & B      │
      │  Session Records)  │               │ Preview Worktrees) │
      └────────────────────┘               └────────────────────┘
```

---

## Features

- **In-Chat UX & UI Concept Decks**: Interactive visual cards with horizontal scroll ribbons (`Gen 1 → Gen 2 → ...`) anchored above the composer in Hermes Desktop.
- **Strict Session Isolation**: State, generations, and selections are scoped per Hermes conversation `sessionId`, preventing cross-session state bleed.
- **Stage Switcher & UX History Context**: Inspect prior UX selections and toggle between UX directions and UI concept cards seamlessly.
- **Same-Turn Selection Guard**: Prevents autonomous agents from prematurely auto-selecting options in the same turn they were generated, keeping the user in full control.
- **Safe Code Evolution**: Zero host pollution. Candidate edits execute via AST surgery on Slot B; dev annotations (`data-aether-uid`) are strictly stripped before promoting to production.

---

## Installation & Deployment

### Build from Source
```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run comprehensive test suite
npm test
```

### Deploy to Hermes Desktop
Deploy the plugin manifest, MCP server, desktop frontend, and agent skills directly into your local Hermes environment:
```bash
node scripts/deploy-hermes.js
```

This installs:
- MCP Server & Plugin Manifest: `%LOCALAPPDATA%\hermes\plugins\aether-ui`
- Desktop UI Plugin: `%LOCALAPPDATA%\hermes\desktop-plugins\aether-ui\plugin.js`
- Agent Skill: `%LOCALAPPDATA%\hermes\skills\aether-ui\SKILL.md`

---

## Available MCP Tools

| Tool | Purpose |
|------|---------|
| `aether_status` | Inspect lifecycle state, active selection, and slot statuses |
| `aether_submit_context` | Ingest user intent, project purpose, target audience, and tasks |
| `aether_generate_ux` | Synthesize 2–3 divergent UX directions and display cards |
| `aether_select_ux` | Choose a UX direction to advance to UI concept synthesis |
| `aether_generate_ui` | Generate 2–3 UI concept cards grounded in selected UX direction |
| `aether_select_ui` | Choose a UI concept and initialize isolated dual-slot preview |
| `aether_edit_direct` | Execute deterministic AST surgery on Slot B |
| `aether_preview_sync` | Synchronize and audit active preview slots |
| `aether_approve_promote` | Strip dev UIDs and promote verified build to host codebase |
| `aether_revert_candidate` | Discard candidate changes and revert Slot B to Slot A |
| `aether_handoff_export` | Export production package (Markdown & JSON) |

---

## License

ISC License. Built for Hermes Agent & Hermes Desktop.
