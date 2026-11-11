import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import {
  AstSurgeon,
  UserLockRegistry,
  UserLockViolationException,
  QuarantineRegistry,
  CrgAnalyzer,
  SemanticRebaseEngine,
  TieredValidator,
} from '../src/index';

describe('[UNIT TESTS] Module 3: EditTx Engine Primitives & Invariants', () => {
  describe('Unit: AstSurgeon & tailwind-merge (Tier 1)', () => {
    const surgeon = new AstSurgeon();

    test('Merges Tailwind utility classes deterministically via tailwind-merge', () => {
      const code = `<button data-aether-uid="btn-1" className="px-2 py-1 bg-blue-500">Click</button>;`;
      const mutated = surgeon.applyMutation(code, {
        type: 'MERGE_CLASSNAMES',
        targetUid: 'btn-1',
        propertyGroup: 'spacing',
        classesToAdd: 'p-4 bg-green-500',
      });

      // tailwind-merge must resolve px-2 py-1 -> p-4 and bg-blue-500 -> bg-green-500
      assert.ok(mutated.includes('className="p-4 bg-green-500"'));
      assert.strictEqual(mutated.includes('px-2'), false);
    });

    test('Updates inline styles atomically', () => {
      const code = `<div data-aether-uid="card-1">Content</div>;`;
      const mutated = surgeon.applyMutation(code, {
        type: 'UPDATE_STYLE',
        targetUid: 'card-1',
        propertyGroup: 'color',
        propName: 'backgroundColor',
        propValue: '#10B981',
      });

      assert.ok(mutated.includes("backgroundColor: '#10B981'"));
    });

    test('Updates text content cleanly on target node', () => {
      const code = `<h1 data-aether-uid="title-1">Old Title</h1>;`;
      const mutated = surgeon.applyMutation(code, {
        type: 'UPDATE_TEXT',
        targetUid: 'title-1',
        propertyGroup: 'content',
        newText: 'New Dynamic Title',
      });

      assert.ok(mutated.includes('New Dynamic Title'));
    });
  });

  describe('Unit: Granular USER_LOCKED Property Scoping & 1-Click Reset', () => {
    test('Locks specific property group without blocking unrelated properties', () => {
      const registry = new UserLockRegistry();
      registry.lock('btn-submit', 'spacing', 'p-4', 'user_direct_edit');

      assert.strictEqual(registry.isLocked('btn-submit', 'spacing'), true);
      assert.strictEqual(registry.isLocked('btn-submit', 'color'), false); // Unrelated group is free!

      // Spacing change on locked group throws UserLockViolationException
      assert.throws(
        () => {
          registry.assertCompliance('btn-submit', 'spacing', 'p-4', 'p-8');
        },
        (err: any) => {
          assert.ok(err instanceof UserLockViolationException);
          assert.strictEqual(err.propertyGroup, 'spacing');
          return true;
        }
      );

      // Color change on same element passes without restriction
      assert.doesNotThrow(() => {
        registry.assertCompliance('btn-submit', 'color', 'text-white', 'text-black');
      });
    });

    test('Formatting-only immunity: Semantic AST comparison preserves lock when only formatting changes', () => {
      const registry = new UserLockRegistry();
      registry.lock('card-1', 'content', '<h1>Hello World</h1>', 'prompt_constraint');

      const originalCode = `<h1>Hello World</h1>`;
      // Changed whitespace and formatting only
      const formattedCode = `<h1>
        Hello World
      </h1>`;

      // Semantic AST comparison recognizes formatting-only change: lock preserved, no throw!
      assert.doesNotThrow(() => {
        registry.assertCompliance('card-1', 'content', originalCode, formattedCode);
      });

      // Semantic change (altered text) throws violation
      const semanticChangeCode = `<h1>Hello Universe</h1>`;
      assert.throws(() => {
        registry.assertCompliance('card-1', 'content', originalCode, semanticChangeCode);
      });
    });

    test('1-Click auditable reset unlocks property and records audit trail', () => {
      const registry = new UserLockRegistry();
      registry.lock('input-1', 'layout', 'w-full');
      registry.lock('input-1', 'color', 'bg-white');

      assert.strictEqual(registry.getAllLocks().length, 2);

      // Reset specific target
      const resetCount = registry.reset('input-1');
      assert.strictEqual(resetCount, 2);
      assert.strictEqual(registry.isLocked('input-1', 'layout'), false);

      // Audit log records reset
      const logs = registry.getAuditLog();
      assert.strictEqual(logs[logs.length - 1].action, 'RESET');
      assert.strictEqual(logs[logs.length - 1].targetUid, 'input-1');
    });
  });

  describe('Unit: Semantic Rebase Engine (CRG & Conditional Ancestor Verification)', () => {
    const rebaseEngine = new SemanticRebaseEngine();

    test('Disjoint concurrent edit: auto-rebases cleanly onto new host file content', () => {
      const baseCode = `
export const App = () => (
  <div>
    <header data-aether-uid="hdr">Header</header>
    <button data-aether-uid="btn">Old Button</button>
  </div>
);
      `;

      // Host concurrently changed header only
      const hostCode = `
export const App = () => (
  <div>
    <header data-aether-uid="hdr">Brand New Host Header</header>
    <button data-aether-uid="btn">Old Button</button>
  </div>
);
      `;

      // Candidate is modifying the button
      const result = rebaseEngine.analyzeAndRebase({
        targetUid: 'btn',
        targetFilePath: 'src/App.tsx',
        mutation: { type: 'UPDATE_TEXT', targetUid: 'btn', propertyGroup: 'content', newText: 'Candidate Button' },
        revisions: { baseRevision: 'rev-1', currentSlotBRevision: 'rev-1', currentHostRevision: 'rev-2' },
        baseContent: baseCode,
        currentSlotBContent: baseCode,
        currentHostContent: hostCode,
      });

      assert.strictEqual(result.canAutoRebase, true);
      assert.strictEqual(result.requiresConflictReview, false);
      assert.strictEqual(result.conflictingDimensions.length, 0);
    });

    test('Overlapping / conditional ancestor modification: rejects auto-rebase and triggers Conflict', () => {
      const baseCode = `
export const App = () => (
  <div>
    {isLoggedIn && <button data-aether-uid="btn">Action</button>}
  </div>
);
      `;

      // Host changed the conditional wrapper to a different condition
      const hostCode = `
export const App = () => (
  <div>
    {hasAdminPermission && <button data-aether-uid="btn">Action</button>}
  </div>
);
      `;

      const result = rebaseEngine.analyzeAndRebase({
        targetUid: 'btn',
        targetFilePath: 'src/App.tsx',
        mutation: { type: 'UPDATE_TEXT', targetUid: 'btn', propertyGroup: 'content', newText: 'Candidate Action' },
        revisions: { baseRevision: 'rev-1', currentSlotBRevision: 'rev-1', currentHostRevision: 'rev-2' },
        baseContent: baseCode,
        currentSlotBContent: baseCode,
        currentHostContent: hostCode,
      });

      assert.strictEqual(result.canAutoRebase, false);
      assert.strictEqual(result.requiresConflictReview, true);
      assert.ok(result.conflictingDimensions.includes('CONDITIONAL_EXPRESSION_MUTATED'));
    });
  });

  describe('Unit: Tier 3 Proposed Diff (Reviewable Diff without Silent Promotion)', () => {
    const validator = new TieredValidator();

    test('Generates reviewable unified diff and requires user confirmation', () => {
      const orig = `<button className="old-btn">Click</button>`;
      const proposed = `<button className="new-btn px-4 py-2">Click</button>`;

      const result = validator.generateProposedDiff(
        'tx-diff-1',
        'btn-1',
        'src/Button.tsx',
        orig,
        proposed,
        'SHARED_COMPONENT',
        ['Button'],
        ['src/Button.tsx']
      );

      assert.strictEqual(result.tier, 'TIER_3_PROPOSED_DIFF');
      assert.strictEqual(result.userConfirmationRequired, true);
      assert.ok(result.unifiedDiff.includes('old-btn'));
      assert.ok(result.unifiedDiff.includes('new-btn'));
      assert.ok(result.clarificationMessage.includes('SHARED_COMPONENT'));
    });
  });
});
