---
name: aether-ui
description: "Conversational frontend UX/UI design workspace. Always start by submitting project context and generating selectable UX direction cards before any UI concepts or code."
version: 1.0.0
---

# Aether UI — Conversational Visual Design Experience

Aether UI connects Hermes Agent to interactive visual UX cards attached directly to the conversation above the composer in Hermes Desktop.

## MANDATORY WORKFLOW SEQUENCE (STRICT ORDER REQUIRED)

You MUST follow this exact 3-step sequence for EVERY frontend, UI, UX, web application, or design request:

### Step 1: Call `aether_submit_context`
- Ingest the user's intent, project purpose, target audience, and primary tasks.
- DO NOT create or write `.html` files, mockup code, or frontend scripts directly to disk.

### Step 2: Call `aether_generate_ux`
- Immediately synthesize 2–3 distinct UX alternative directions into interactive cards attached above the composer (`composer.top`).
- DO NOT dump prose tables or long text directions into the chat. The visual cards appear in the UI automatically.

### Step 3: (MANDATORY STOP) Stop and Wait for User Selection
- Present a concise 2–3 sentence summary in chat highlighting the key differences between the generated directions.
- **YOU MUST STOP YOUR TURN HERE AND WAIT FOR THE USER.**
- **CRITICAL RESTRICTION:** NEVER call `aether_select_ux` in the same turn that `aether_generate_ux` was called. The user must choose their direction first (by clicking a card in Hermes Desktop or answering in chat).
- **CRITICAL RESTRICTION:** NEVER call `aether_generate_ui` or `aether_select_ui` until a UX direction has been explicitly chosen by the user. Backend gates will reject early calls with `PRECONDITION_FAILED`.

### Step 4: UI Concept Generation & (MANDATORY STOP) User Selection
- **If User Requests UX Refinement:** Call `aether_generate_ux` with `refinement` set to the user's feedback. Generation 2 will be added to the deck. Stop and wait again.
- **Once User Chooses a UX Direction:** Call `aether_select_ux` (if not already selected via card click). Then call `aether_generate_ui` to synthesize visual UI concepts attached above the composer.
- **CRITICAL RESTRICTION:** After calling `aether_generate_ui`, present a 2-sentence summary in chat directing the user to review the visual UI concept cards above the composer. **YOU MUST STOP YOUR TURN HERE AND WAIT FOR THE USER.** NEVER call `aether_select_ui` on the same turn without user selection.

### Step 5: UI Concept Selection & Live Studio Preview
- **Once User Chooses a UI Concept:** Call `aether_select_ui` with the chosen concept ID/title/index. This activates the candidate sandbox and live preview servers.

## Tool Sequence & Preconditions

| Tool | Sequence & Prerequisites | Action |
| --- | --- | --- |
| `aether_submit_context` | **Step 1 (First Call)** | Ingest user requirements and project scope. |
| `aether_generate_ux` | **Step 2 (After Step 1)** | Render 2–3 interactive UX cards in `composer.top`. |
| `aether_select_ux` | **Step 3 (After User Input)** | Lock chosen UX direction. Fails if called in the same automated turn as `aether_generate_ux`. |
| `aether_generate_ui` | **Step 4 (After Selection)** | Generate 2–3 visual UI concepts. Fails if called before a UX card is selected. |
| `aether_select_ui` | **Step 5 (After UI Concept)** | Lock UI concept and activate live dual-slot sandboxes. |
| `aether_status` | Any time | Check current session state, active selection, and stage. |
