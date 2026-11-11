import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import {
  AetherStateMachine,
  InvalidStateTransitionError,
  StateLedger,
} from '../src/index';

describe('Requirement 4: Strict State Machine Transitions (PRD Specification)', () => {
  test('Complete canonical lifecycle sequence: Gathering Brief -> UX Review -> UI Review -> Preview Ready -> Applying Edit -> Implementation Approval -> Building', () => {
    const sm = new AetherStateMachine('Idle');

    // 1. Idle -> Gathering Brief
    sm.transition('Gathering Brief', 'User starts new design workflow');
    assert.strictEqual(sm.getState(), 'Gathering Brief');

    // Simulate Brief Ready
    sm.updateContext({
      hasBrief: true,
      isBriefReady: true,
      briefId: 'brief-101',
    });

    // 2. Gathering Brief -> UX Review
    sm.transition('UX Review', 'System generated 2 UX alternatives');
    assert.strictEqual(sm.getState(), 'UX Review');

    // User selects UX direction
    sm.updateContext({
      selectedUxDirectionId: 'ux-dir-1',
    });

    // 3. UX Review -> UI Review
    sm.transition('UI Review', 'System generated 2 UI concepts based on UX');
    assert.strictEqual(sm.getState(), 'UI Review');

    // User selects UI concept
    sm.updateContext({
      selectedUiConceptId: 'ui-concept-1',
    });

    // 4. UI Review -> Preview Ready
    sm.transition('Preview Ready', 'Live preview sandbox booted');
    assert.strictEqual(sm.getState(), 'Preview Ready');

    // 5. Preview Ready -> Applying Edit
    sm.transition('Applying Edit', 'User clicked button and changed padding');
    assert.strictEqual(sm.getState(), 'Applying Edit');

    // Edit finishes -> returns to Preview Ready
    sm.transition('Preview Ready', 'Edit applied in memory AST');
    assert.strictEqual(sm.getState(), 'Preview Ready');

    // 6. Preview Ready -> Implementation Approval
    sm.transition('Implementation Approval', 'User requested commit to host project');
    assert.strictEqual(sm.getState(), 'Implementation Approval');

    // User confirms approval
    sm.updateContext({
      isApprovedForImplementation: true,
    });

    // 7. Implementation Approval -> Building
    sm.transition('Building', 'Triggered shadow worktree build and Vite compiler');
    assert.strictEqual(sm.getState(), 'Building');

    // Building -> Build Success
    sm.transition('Build Success', 'TypeScript compile and tests passed cleanly');
    assert.strictEqual(sm.getState(), 'Build Success');

    // Verify history contains all transitions
    const history = sm.getHistory();
    assert.strictEqual(history.length, 9);
    assert.strictEqual(history[0].fromState, 'Idle');
    assert.strictEqual(history[0].toState, 'Gathering Brief');
    assert.strictEqual(history[history.length - 1].toState, 'Build Success');
  });

  test('Transition guards enforce PRD prerequisites strictly', () => {
    const sm = new AetherStateMachine('Idle');
    sm.transition('Gathering Brief', 'Start');

    // Guard 1: Cannot jump to UX Review if Brief readiness gate is false
    sm.updateContext({ hasBrief: true, isBriefReady: false });
    assert.throws(
      () => {
        sm.transition('UX Review', 'Attempt early review');
      },
      (err: any) => {
        assert.ok(err instanceof InvalidStateTransitionError);
        assert.ok(err.message.includes('readiness gate not passed'));
        return true;
      }
    );

    // Guard 2: Cannot jump to UI Review without selecting UX Direction (BR-02: UX before UI)
    sm.updateContext({ isBriefReady: true });
    sm.transition('UX Review', 'Brief ready');

    assert.throws(
      () => {
        sm.transition('UI Review', 'Skip UX selection');
      },
      (err: any) => {
        assert.ok(err instanceof InvalidStateTransitionError);
        assert.ok(err.message.includes('UX before UI'));
        return true;
      }
    );

    // Guard 3: Cannot jump to Preview Ready without selecting UI Concept
    sm.updateContext({ selectedUxDirectionId: 'ux-1' });
    sm.transition('UI Review', 'UX selected');

    assert.throws(
      () => {
        sm.transition('Preview Ready', 'Skip UI selection');
      },
      (err: any) => {
        assert.ok(err instanceof InvalidStateTransitionError);
        assert.ok(err.message.includes('choosing a UIConcept'));
        return true;
      }
    );

    // Guard 4: Cannot jump to Building without explicit user implementation approval (FR-19 & BR-09)
    sm.updateContext({ selectedUiConceptId: 'ui-1' });
    sm.transition('Preview Ready', 'UI selected');
    sm.transition('Implementation Approval', 'Request commit');

    sm.updateContext({ isApprovedForImplementation: false });
    assert.throws(
      () => {
        sm.transition('Building', 'Attempt unauthorized build');
      },
      (err: any) => {
        assert.ok(err instanceof InvalidStateTransitionError);
        assert.ok(err.message.includes('Implementation approval flag is false'));
        return true;
      }
    );
  });

  test('Illegal non-adjacent state transitions are rejected', () => {
    const sm = new AetherStateMachine('Idle');

    // Cannot jump from Idle directly to Building
    assert.throws(
      () => {
        sm.transition('Building', 'Jump directly to build');
      },
      (err: any) => {
        assert.ok(err instanceof InvalidStateTransitionError);
        assert.ok(err.message.includes('Illegal state transition'));
        return true;
      }
    );
  });

  test('Build failure recovery path to Implementation Approval or Preview Ready', () => {
    const sm = new AetherStateMachine('Building', {
      isApprovedForImplementation: true,
    });

    // Build fails
    sm.transition('Build Failure', 'Vite compiler reported missing dependency');
    assert.strictEqual(sm.getState(), 'Build Failure');

    // Rollback to Preview Ready
    sm.transition('Preview Ready', 'Rollback to last checkpoint');
    assert.strictEqual(sm.getState(), 'Preview Ready');
  });

  test('State transitions are recorded in SQLite ledger audit log', () => {
    const ledger = new StateLedger(':memory:');

    ledger.transitionState('Gathering Brief', 'Started intake session');
    ledger.stateMachine.updateContext({ hasBrief: true, isBriefReady: true });
    ledger.transitionState('UX Review', 'UX alternative generated');

    const recent = ledger.stateRepo.listRecent();
    assert.strictEqual(recent.length, 2);
    assert.strictEqual(recent[0].toState, 'UX Review');
    assert.strictEqual(recent[1].toState, 'Gathering Brief');

    ledger.close();
  });
});
