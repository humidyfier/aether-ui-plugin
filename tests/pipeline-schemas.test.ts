import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import {
  PipelineSchemaValidator,
  validateBriefExtraction,
  validateUXAlternatives,
  validateUIConcepts,
  validateScopedEditPlan,
} from '../src/index';

describe('[UNIT TESTS] Module 4: Strict JSON Schema Contracts', () => {
  describe('Brief Extraction Schema', () => {
    test('Validates compliant ProjectBrief extraction output', () => {
      const validBrief = {
        name: 'OmniDash',
        productContext: 'Enterprise analytics monitoring dashboard for devops teams.',
        targetAudience: [{ role: 'Site Reliability Engineer', devices: ['desktop'] }],
        primaryTasks: [{ id: 'task-1', goal: 'Investigate system alerts' }],
        pagesAndContent: [{ id: 'page-1', route: '/dashboard', purpose: 'Overview' }],
        uxPreferences: { density: 'compact' },
        visualPreferences: { moodWords: ['Clean', 'Technical'] },
        implementationConstraints: { framework: 'react' },
        practicalConstraints: { contentReadiness: 'ready' },
      };

      const res = validateBriefExtraction(validBrief);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.errors.length, 0);
      assert.strictEqual(res.data?.name, 'OmniDash');
    });

    test('Rejects malformed Brief extraction (too short context or missing audience)', () => {
      const invalidBrief = {
        name: 'Broken App',
        productContext: 'Short', // < 10 chars
        targetAudience: [],       // empty array
        primaryTasks: [],
        pagesAndContent: [],
      };

      const res = validateBriefExtraction(invalidBrief);
      assert.strictEqual(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes('productContext')));
      assert.ok(res.errors.some((e) => e.includes('targetAudience')));
    });
  });

  describe('UX Alternatives Schema', () => {
    test('Validates compliant 2 to 3 UX directions', () => {
      const validUx = {
        directions: [
          {
            title: 'Metric-First',
            approach: 'metric-first',
            userTaskFit: 'Surfaces telemetry first.',
            pageStructure: [{ pageId: 'p1', name: 'Home', route: '/', hierarchyLevel: 1, components: ['Grid'] }],
            interactionFlow: [{ step: 1, title: 'Inspect', userAction: 'Click', systemResponse: 'Zoom' }],
            strengths: ['Fast overview'],
            tradeOffs: ['Dense'],
            assumptions: ['User knows metrics'],
          },
          {
            title: 'Alert-First',
            approach: 'alert-first',
            userTaskFit: 'Focuses on critical issues first.',
            pageStructure: [{ pageId: 'p1', name: 'Alerts', route: '/alerts', hierarchyLevel: 1, components: ['List'] }],
            interactionFlow: [{ step: 1, title: 'Filter', userAction: 'Tap', systemResponse: 'Filter' }],
            strengths: ['Clear urgency'],
            tradeOffs: ['Hides normal telemetry'],
            assumptions: ['Alerts are actionable'],
          },
        ],
      };

      const res = validateUXAlternatives(validUx);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.data?.length, 2);
    });

    test('Rejects UX generation with only 1 direction (PRD invariant: 2-3 required)', () => {
      const invalidUx = {
        directions: [
          {
            title: 'Lone Direction',
            approach: 'single',
            userTaskFit: 'Fit',
            pageStructure: [{ pageId: 'p1', name: 'H', route: '/', hierarchyLevel: 1, components: [] }],
            interactionFlow: [{ step: 1, title: 'S', userAction: 'A', systemResponse: 'R' }],
            strengths: ['S'],
            tradeOffs: ['T'],
            assumptions: [],
          },
        ],
      };

      const res = validateUXAlternatives(invalidUx);
      assert.strictEqual(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes('Must provide 2 to 3 UX directions')));
    });
  });

  describe('UI Concepts Schema', () => {
    test('Validates compliant UI concepts and palette/typography requirements', () => {
      const validUi = {
        concepts: [
          {
            name: 'Dark Enterprise',
            styleApproach: 'High-Contrast Dark',
            palette: {
              primary: '#3B82F6',
              secondary: '#64748B',
              background: '#0F172A',
              surface: '#1E293B',
              textPrimary: '#F8FAFC',
              border: '#334155',
            },
            typography: {
              fontFamilySans: 'Inter',
              fontFamilyMono: 'JetBrains Mono',
              scale: { base: '16px' },
              weights: { regular: 400 },
            },
            density: { mode: 'compact', spacingUnit: 4 },
            designTokens: {},
            componentStyles: [],
            responsiveRules: [],
          },
          {
            name: 'Light Technical',
            styleApproach: 'Minimal Light',
            palette: {
              primary: '#2563EB',
              secondary: '#475569',
              background: '#FFFFFF',
              surface: '#F8FAFC',
              textPrimary: '#0F172A',
              border: '#E2E8F0',
            },
            typography: {
              fontFamilySans: 'Inter',
              fontFamilyMono: 'monospace',
              scale: { base: '16px' },
              weights: { regular: 400 },
            },
            density: { mode: 'comfortable', spacingUnit: 4 },
            designTokens: {},
            componentStyles: [],
            responsiveRules: [],
          },
        ],
      };

      const res = validateUIConcepts(validUi);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.data?.length, 2);
    });

    test('Rejects UI concepts with missing primary palette', () => {
      const invalidUi = {
        concepts: [
          {
            name: 'Broken Concept 1',
            styleApproach: 'Test',
            palette: { background: '#FFF' }, // Missing primary!
            typography: {},
            density: { mode: 'compact', spacingUnit: 4 },
          },
          {
            name: 'Broken Concept 2',
            styleApproach: 'Test 2',
            palette: { primary: '#000', background: '#FFF' },
            typography: {},
            density: { mode: 'compact', spacingUnit: 4 },
          },
        ],
      };

      const res = validateUIConcepts(invalidUi);
      assert.strictEqual(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes('palette.primary is required')));
    });
  });

  describe('Scoped Edit Plan Schema', () => {
    test('Validates compliant ScopedEditPlan', () => {
      const validPlan = {
        targetUid: 'aether-btn-login',
        filePath: 'src/Login.tsx',
        scope: 'ELEMENT',
        propertyGroups: ['color', 'spacing'],
        expectedTier: 'TIER_1_DETERMINISTIC',
        rationale: 'Update button styling to primary brand blue with comfortable padding.',
        mutations: [
          {
            type: 'MERGE_CLASSNAMES',
            targetUid: 'aether-btn-login',
            propertyGroup: 'color',
            classesToAdd: 'bg-blue-600 text-white',
          },
        ],
      };

      const res = validateScopedEditPlan(validPlan);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.data?.targetUid, 'aether-btn-login');
    });

    test('Rejects edit plan when mutation targetUid does not match plan targetUid', () => {
      const mismatchedPlan = {
        targetUid: 'target-A',
        filePath: 'src/Card.tsx',
        scope: 'ELEMENT',
        propertyGroups: ['color'],
        rationale: 'Change background',
        mutations: [
          {
            type: 'UPDATE_STYLE',
            targetUid: 'target-B', // MISMATCH!
            propertyGroup: 'color',
            propName: 'backgroundColor',
            propValue: 'red',
          },
        ],
      };

      const res = validateScopedEditPlan(mismatchedPlan);
      assert.strictEqual(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes('does not match plan targetUid')));
    });
  });
});
