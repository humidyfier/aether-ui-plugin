import { test, describe, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  DualSlotManager,
  EditTransactionManager,
  StateLedger,
  MultiStagePipelineOrchestrator,
  UserLockRegistry,
} from '../src/index';

describe('[INTEGRATION TESTS] Module 4: Multi-Stage Pipeline Orchestrator & EditTx Routing', () => {
  const testHostDir = path.join(process.cwd(), '.tmp_test_pipeline_host');

  afterEach(() => {
    if (fs.existsSync(testHostDir)) {
      fs.rmSync(testHostDir, { recursive: true, force: true });
    }
  });

  test('E2E: Valid Brief -> UX -> UI stages populate StateLedger and update state machine', () => {
    fs.mkdirSync(testHostDir, { recursive: true });
    const ledger = new StateLedger(':memory:');
    const slotManager = new DualSlotManager({ baseHostDir: testHostDir, ledger });
    const editTxManager = new EditTransactionManager({ dualSlotManager: slotManager, ledger });
    const orchestrator = new MultiStagePipelineOrchestrator({ ledger, editTxManager });

    // 1. Stage 1: Brief Extraction
    const rawBrief = {
      name: 'PulseFlow',
      productContext: 'Real-time telemetry and service health monitoring suite for cloud infrastructure.',
      targetAudience: [{ role: 'DevOps Engineer', devices: ['desktop'] }],
      primaryTasks: [{ id: 't1', goal: 'Monitor microservice latency' }],
      pagesAndContent: [{ id: 'p1', route: '/telemetry', purpose: 'Live graphs' }],
      uxPreferences: { density: 'compact' },
      visualPreferences: { moodWords: ['Precise', 'Modern'] },
      implementationConstraints: { framework: 'react' },
      practicalConstraints: { contentReadiness: 'ready' },
    };

    const briefRes = orchestrator.processBriefResponse(rawBrief);
    assert.strictEqual(briefRes.success, true);
    assert.ok(briefRes.brief?.id);
    assert.strictEqual(ledger.stateMachine.getState(), 'Gathering Brief');

    // 2. Stage 2: UX Generation (2 directions)
    const rawUx = {
      directions: [
        {
          title: 'Graph-First',
          approach: 'graph-first',
          userTaskFit: 'Surfaces telemetry metrics upfront.',
          pageStructure: [{ pageId: 'pg1', name: 'Live Graphs', route: '/telemetry', hierarchyLevel: 1, components: ['MetricGrid'] }],
          interactionFlow: [{ step: 1, title: 'Inspect', userAction: 'Hover over spike', systemResponse: 'Shows tooltip' }],
          strengths: ['Instant visibility'],
          tradeOffs: ['Higher CPU load'],
          assumptions: ['User has fast connection'],
        },
        {
          title: 'Service-Map-First',
          approach: 'topology-first',
          userTaskFit: 'Visualizes microservice dependencies.',
          pageStructure: [{ pageId: 'pg1', name: 'Topology', route: '/topology', hierarchyLevel: 1, components: ['DependencyGraph'] }],
          interactionFlow: [{ step: 1, title: 'Select Node', userAction: 'Click node', systemResponse: 'Highlights blast radius' }],
          strengths: ['Clear architecture'],
          tradeOffs: ['Needs topology config'],
          assumptions: ['Tracing is enabled'],
        },
      ],
    };

    const uxRes = orchestrator.processUXResponse(briefRes.brief!.id, rawUx);
    assert.strictEqual(uxRes.success, true);
    assert.strictEqual(uxRes.directions?.length, 2);
    assert.strictEqual(ledger.stateMachine.getState(), 'UX Review');

    // Select direction
    const selectedUx = ledger.selectUXDirection(briefRes.brief!.id, uxRes.directions![0].id);

    // 3. Stage 3: UI Synthesis (2 concepts)
    const rawUi = {
      concepts: [
        {
          name: 'Cyberpunk Neon',
          styleApproach: 'High-Contrast Dark',
          palette: { primary: '#06B6D4', secondary: '#3B82F6', background: '#0F172A', surface: '#1E293B', textPrimary: '#F8FAFC', border: '#334155' },
          typography: { fontFamilySans: 'Inter', fontFamilyMono: 'JetBrains Mono', scale: { base: '16px' }, weights: { regular: 400 } },
          density: { mode: 'compact', spacingUnit: 4 },
          designTokens: {},
          componentStyles: [],
          responsiveRules: [],
        },
        {
          name: 'Clean Cloud Light',
          styleApproach: 'Clean Modern',
          palette: { primary: '#2563EB', secondary: '#64748B', background: '#FFFFFF', surface: '#F8FAFC', textPrimary: '#0F172A', border: '#E2E8F0' },
          typography: { fontFamilySans: 'Inter', fontFamilyMono: 'monospace', scale: { base: '16px' }, weights: { regular: 400 } },
          density: { mode: 'comfortable', spacingUnit: 4 },
          designTokens: {},
          componentStyles: [],
          responsiveRules: [],
        },
      ],
    };

    const uiRes = orchestrator.processUIResponse(briefRes.brief!.id, selectedUx.id, rawUi);
    assert.strictEqual(uiRes.success, true);
    assert.strictEqual(uiRes.concepts?.length, 2);
    assert.strictEqual(ledger.stateMachine.getState(), 'UI Review');

    ledger.close();
  });

  test('Invariant: Schema-valid ScopedEditPlan is routed through EditTx and commits to Slot B (Slot A untouched)', async () => {
    fs.mkdirSync(testHostDir, { recursive: true });
    const ledger = new StateLedger(':memory:');
    const slotManager = new DualSlotManager({ baseHostDir: testHostDir, ledger });
    await slotManager.initialize(true);

    const initialCode = `
import React from 'react';
export default function App() {
  return (
    <div>
      <button data-aether-uid="btn-save" className="px-3 py-1 bg-gray-500">Save</button>
    </div>
  );
}
    `;
    slotManager.getSlotAWorktree().writeCandidateFile('src/App.tsx', initialCode);
    slotManager.getSlotBWorktree().writeCandidateFile('src/App.tsx', initialCode);
    const baseRevision = slotManager.getSlotState('SLOT_B').merkleRoot;

    const editTxManager = new EditTransactionManager({ dualSlotManager: slotManager, ledger });
    const orchestrator = new MultiStagePipelineOrchestrator({ ledger, editTxManager });

    // Valid plan from model
    const planJson = {
      targetUid: 'btn-save',
      filePath: 'src/App.tsx',
      scope: 'ELEMENT',
      propertyGroups: ['color', 'spacing'],
      expectedTier: 'TIER_1_DETERMINISTIC',
      rationale: 'Update button to active brand color and comfortable padding.',
      mutations: [
        {
          type: 'MERGE_CLASSNAMES',
          targetUid: 'btn-save',
          propertyGroup: 'color',
          classesToAdd: 'bg-blue-600 px-4 py-2',
        },
      ],
    };

    const result = await orchestrator.processEditPlanAndExecute(planJson, baseRevision);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.txRecord?.status, 'COMMITTED');

    // Invariant: Slot B updated
    const slotBCode = slotManager.getSlotBWorktree().readFile('src/App.tsx');
    assert.ok(slotBCode.includes('bg-blue-600'));

    // Invariant: Slot A completely untouched
    const slotACode = slotManager.getSlotAWorktree().readFile('src/App.tsx');
    assert.strictEqual(slotACode.includes('bg-blue-600'), false);
    assert.ok(slotACode.includes('bg-gray-500'));

    ledger.close();
  });

  test('Invariant: Schema-valid plan attempting to violate USER_LOCKED property is rejected by EditTx', async () => {
    fs.mkdirSync(testHostDir, { recursive: true });
    const ledger = new StateLedger(':memory:');
    const slotManager = new DualSlotManager({ baseHostDir: testHostDir, ledger });
    await slotManager.initialize(true);

    const initialCode = `
import React from 'react';
export default function App() {
  return <button data-aether-uid="btn-save" className="bg-red-500">Save</button>;
}
    `;
    slotManager.getSlotAWorktree().writeCandidateFile('src/App.tsx', initialCode);
    slotManager.getSlotBWorktree().writeCandidateFile('src/App.tsx', initialCode);
    const baseRevision = slotManager.getSlotState('SLOT_B').merkleRoot;

    const lockRegistry = new UserLockRegistry();
    // User locked the 'color' property group on this button
    lockRegistry.lock('btn-save', 'color', 'bg-red-500', 'user_direct_edit');

    const editTxManager = new EditTransactionManager({ dualSlotManager: slotManager, lockRegistry, ledger });
    const orchestrator = new MultiStagePipelineOrchestrator({ ledger, editTxManager });

    const planJson = {
      targetUid: 'btn-save',
      filePath: 'src/App.tsx',
      scope: 'ELEMENT',
      propertyGroups: ['color'],
      expectedTier: 'TIER_1_DETERMINISTIC',
      rationale: 'Force color to green',
      mutations: [
        {
          type: 'MERGE_CLASSNAMES',
          targetUid: 'btn-save',
          propertyGroup: 'color',
          classesToAdd: 'bg-green-500',
        },
      ],
    };

    // Schema validation passes, but EditTx rejects it due to USER_LOCKED
    const result = await orchestrator.processEditPlanAndExecute(planJson, baseRevision);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.txRecord?.status, 'REJECTED');
    assert.ok(result.errors.some((e) => e.includes('locked property group "color"')));

    ledger.close();
  });
});
