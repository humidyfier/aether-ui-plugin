import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import {
  StateLedger,
  evaluateBriefReadiness,
  ProjectBrief,
} from '../src/index';

describe('Requirement 1: ProjectBrief, UXDirection[], UIConcept[] (FR-01 to FR-08)', () => {
  test('FR-01: Evaluates brief readiness gate (passes with purpose & audience)', () => {
    // Incomplete brief
    const incomplete = evaluateBriefReadiness({
      name: 'Empty Project',
      productContext: 'Too short',
    });
    assert.strictEqual(incomplete.isReady, false);
    assert.ok(incomplete.missingFields.length > 0);

    // Complete brief
    const complete = evaluateBriefReadiness({
      name: 'Meal Planner App',
      productContext: 'A full-stack meal planning application for busy families with automated grocery lists.',
      targetAudience: [{ role: 'Busy Parents', devices: ['mobile', 'desktop'] }],
      primaryTasks: [{ id: 'task-1', goal: 'Plan weekly dinners in under 10 minutes' }],
    });
    assert.strictEqual(complete.isReady, true);
    assert.strictEqual(complete.missingFields.length, 0);
  });

  test('FR-01 to FR-08: Full CRUD and state persistence in SQLite ledger', () => {
    const ledger = new StateLedger(':memory:');

    // 1. Create and save ProjectBrief
    const brief = ledger.saveBrief({
      name: 'Meal Planner Pro',
      productContext: 'Comprehensive family meal planning and grocery replenishment engine.',
      targetAudience: [
        { role: 'Working Parents', skillLevel: 'novice', devices: ['mobile'] },
        { role: 'Meal Prep Enthusiast', skillLevel: 'intermediate', devices: ['desktop'] },
      ],
      primaryTasks: [
        { id: 't1', goal: 'Generate balanced 7-day dinner calendar', frequency: 'weekly', urgency: 'high' },
        { id: 't2', goal: 'Consolidate ingredients into instant grocery list', frequency: 'weekly' },
      ],
      pagesAndContent: [
        { id: 'p1', route: '/calendar', purpose: 'Weekly planner view', priority: 'critical' },
        { id: 'p2', route: '/recipes', purpose: 'Recipe discovery & dietary filters', priority: 'high' },
        { id: 'p3', route: '/grocery', purpose: 'Checklist and store aisle grouping', priority: 'high' },
      ],
      uxPreferences: {
        navigationPattern: 'bottom-nav',
        density: 'comfortable',
        emptyStates: 'Friendly prompts with suggested 15-minute recipes',
      },
      visualPreferences: {
        moodWords: ['Warm', 'Approachable', 'Minimal', 'Organized'],
        brandColors: ['#2E7D32', '#F9FBE7', '#1B5E20'],
        avoidList: ['Cluttered tables', 'Flashy gradients'],
      },
      implementationConstraints: {
        framework: 'react',
        libraries: ['tailwind', 'lucide-react'],
        responsiveTargets: ['mobile', 'desktop'],
      },
      practicalConstraints: {
        contentReadiness: 'ready',
        localization: ['en-US'],
      },
      assumptions: [
        { id: 'a1', statement: 'Users shop primarily on weekends', confidence: 'high', validated: true },
      ],
      questions: [
        { id: 'q1', question: 'Should we support pantry inventory sync?', impact: 'medium', answered: false },
      ],
    });

    assert.ok(brief.id);
    assert.strictEqual(brief.version, 1);
    assert.strictEqual(brief.readiness.isReady, true);

    const retrievedBrief = ledger.briefs.findById(brief.id);
    assert.ok(retrievedBrief);
    assert.strictEqual(retrievedBrief?.name, 'Meal Planner Pro');
    assert.strictEqual(retrievedBrief?.pagesAndContent.length, 3);
    assert.strictEqual(retrievedBrief?.visualPreferences.brandColors?.[0], '#2E7D32');

    // 2. FR-02: Generate 2-3 distinct UX alternatives
    const uxAlternatives = ledger.saveUXAlternatives(brief.id, [
      {
        title: 'Week-First Planner',
        approach: 'week-first',
        userTaskFit: 'Places the 7-day schedule front and center with drag-and-drop slots.',
        pageStructure: [
          { pageId: 'pg-1', name: 'Week View', route: '/calendar', hierarchyLevel: 1, components: ['WeeklyGrid', 'MealSlotCard'] },
          { pageId: 'pg-2', name: 'Recipe Drawer', route: '/recipes', hierarchyLevel: 2, components: ['RecipeCard', 'SearchFilter'] },
        ],
        interactionFlow: [
          { step: 1, title: 'Open Week', userAction: 'Tap day slot', systemResponse: 'Expands slot and suggests recipes' },
        ],
        strengths: ['Instant visual overview of entire week', 'Minimizes decision fatigue'],
        tradeOffs: ['Requires screen space, tighter on small mobile viewports'],
        assumptions: ['User plans 5+ meals at once'],
      },
      {
        title: 'Recipe-First Discovery',
        approach: 'recipe-first',
        userTaskFit: 'Browses culinary inspiration first, then assigns chosen meals to upcoming days.',
        pageStructure: [
          { pageId: 'pg-1', name: 'Inspiration Feed', route: '/recipes', hierarchyLevel: 1, components: ['RecipeFeed', 'CategoryChips'] },
          { pageId: 'pg-2', name: 'Meal Schedule', route: '/calendar', hierarchyLevel: 2, components: ['MiniCalendar'] },
        ],
        interactionFlow: [
          { step: 1, title: 'Bookmark Recipe', userAction: 'Swipe right on recipe card', systemResponse: 'Asks which day to assign' },
        ],
        strengths: ['Engaging culinary exploration', 'Better for foodies'],
        tradeOffs: ['Can lead to unbalanced weekly nutrition if not monitored'],
        assumptions: ['User does not have an established meal routine'],
      },
    ]);

    assert.strictEqual(uxAlternatives.length, 2);
    const listedUx = ledger.ux.listByBriefId(brief.id);
    assert.strictEqual(listedUx.length, 2);

    // FR-03: Select UX Direction
    const selectedUx = ledger.selectUXDirection(brief.id, uxAlternatives[0].id, 'Selected week-first for busy parents');
    assert.strictEqual(selectedUx.isSelected, true);
    assert.strictEqual(selectedUx.userNotes, 'Selected week-first for busy parents');

    // Verify other direction is not selected
    const unselectedUx = ledger.ux.findById(uxAlternatives[1].id);
    assert.strictEqual(unselectedUx?.isSelected, false);

    // 3. FR-06 to FR-08: UI Concepts Generation & Comparison
    const uiConcepts = ledger.saveUIConcepts(brief.id, selectedUx.id, [
      {
        name: 'Warm Earthy Minimal',
        styleApproach: 'Warm Minimal',
        typography: {
          fontFamilySans: 'Inter, sans-serif',
          fontFamilyMono: 'JetBrains Mono, monospace',
          scale: { xs: '12px', sm: '14px', base: '16px', lg: '18px', xl: '20px', '2xl': '24px', '3xl': '30px' },
          weights: { regular: 400, medium: 500, semibold: 600, bold: 700 },
          lineHeights: { tight: '1.25', normal: '1.5', relaxed: '1.75' },
        },
        palette: {
          primary: '#2E7D32',
          secondary: '#81C784',
          background: '#F9FBE7',
          surface: '#FFFFFF',
          textPrimary: '#1F2937',
          textSecondary: '#4B5563',
          muted: '#9CA3AF',
          border: '#E5E7EB',
          success: '#10B981',
          warning: '#F59E0B',
          error: '#EF4444',
        },
        density: {
          mode: 'comfortable',
          spacingUnit: 4,
          padding: { button: '10px 18px', card: '16px', input: '10px 14px' },
          gap: { grid: '16px', list: '12px' },
        },
        designTokens: {
          borderRadius: '8px',
          shadowBase: '0 1px 3px rgba(0,0,0,0.1)',
        },
        componentStyles: [
          {
            componentName: 'Button',
            cssProperties: { backgroundColor: '#2E7D32', color: '#FFFFFF', borderRadius: '8px' },
          },
        ],
        responsiveRules: [
          {
            breakpoint: 'mobile',
            minWidth: 320,
            layoutAdjustments: { navigation: 'tabs', columns: 1, whitespaceMultiplier: 0.8 },
          },
        ],
        sampleScreens: [
          {
            id: 'scr-1',
            route: '/calendar',
            screenName: 'Week View',
            description: 'Cards with soft shadows and earthy badges',
            mockComponentHierarchy: ['AppShell', 'WeekGrid', 'MealCard'],
            visualHighlights: ['Rounded corners', 'Muted sage accents'],
          },
        ],
        attributedReferences: [
          {
            id: 'ref-1',
            title: 'Linear Design System',
            url: 'https://linear.app',
            observedQualities: ['Subtle borders', 'Tactile contrast'],
            sourceStatus: 'accessible',
            disclaimer: 'Original interpretation based on high-level design principles, not a copy.',
          },
        ],
      },
      {
        name: 'High-Contrast Clean',
        styleApproach: 'High-Contrast Technical',
        typography: {
          fontFamilySans: 'system-ui, sans-serif',
          fontFamilyMono: 'monospace',
          scale: { xs: '11px', sm: '13px', base: '15px', lg: '18px', xl: '22px', '2xl': '26px', '3xl': '32px' },
          weights: { regular: 400, medium: 500, semibold: 600, bold: 700 },
          lineHeights: { tight: '1.2', normal: '1.4', relaxed: '1.6' },
        },
        palette: {
          primary: '#111827',
          secondary: '#374151',
          background: '#FFFFFF',
          surface: '#F3F4F6',
          textPrimary: '#000000',
          textSecondary: '#4B5563',
          muted: '#6B7280',
          border: '#D1D5DB',
          success: '#059669',
          warning: '#D97706',
          error: '#DC2626',
        },
        density: {
          mode: 'compact',
          spacingUnit: 4,
          padding: { button: '8px 14px', card: '12px', input: '8px 12px' },
          gap: { grid: '12px', list: '8px' },
        },
        designTokens: {
          borderRadius: '4px',
          shadowBase: 'none',
        },
        componentStyles: [
          {
            componentName: 'Button',
            cssProperties: { backgroundColor: '#111827', color: '#FFFFFF', borderRadius: '4px' },
          },
        ],
        responsiveRules: [
          {
            breakpoint: 'mobile',
            minWidth: 320,
            layoutAdjustments: { navigation: 'drawer', columns: 1, whitespaceMultiplier: 0.9 },
          },
        ],
        sampleScreens: [],
        attributedReferences: [],
      },
    ]);

    assert.strictEqual(uiConcepts.length, 2);
    const listedUi = ledger.ui.listByUXDirectionId(selectedUx.id);
    assert.strictEqual(listedUi.length, 2);

    // FR-07: Concept Selection
    const selectedUi = ledger.selectUIConcept(brief.id, uiConcepts[0].id);
    assert.strictEqual(selectedUi.isSelected, true);
    assert.strictEqual(selectedUi.name, 'Warm Earthy Minimal');

    ledger.close();
  });
});
