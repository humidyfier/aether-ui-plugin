import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import {
  ViewportProbe,
  AccessibilityChecker,
  STANDARD_VIEWPORTS,
} from '../src/index';

describe('Module 2 Requirement 4: Viewport Probe & Accessibility Checker (FR-14, FR-15)', () => {
  describe('Viewport Probe (375px, 768px, 1280px)', () => {
    test('Standard viewports are correctly defined (Mobile: 375px, Tablet: 768px, Desktop: 1280px)', () => {
      const probe = new ViewportProbe();
      const vps = probe.getViewports();

      assert.strictEqual(vps.mobile.width, 375);
      assert.strictEqual(vps.tablet.width, 768);
      assert.strictEqual(vps.desktop.width, 1280);
    });

    test('Detects horizontal overflow on mobile viewport (375px)', () => {
      const probe = new ViewportProbe();
      const issues = probe.probeElements('mobile', [
        {
          uid: 'aether-table-1',
          tagName: 'table',
          width: 500, // 500px on 375px viewport!
          height: 200,
          scrollWidth: 500,
          clientWidth: 375,
        },
        {
          uid: 'aether-banner-2',
          tagName: 'div',
          width: 320, // 320px fits cleanly
          height: 100,
        },
      ]);

      assert.strictEqual(issues.length, 1);
      assert.strictEqual(issues[0].type, 'HORIZONTAL_OVERFLOW');
      assert.strictEqual(issues[0].severity, 'CRITICAL');
      assert.strictEqual(issues[0].targetUid, 'aether-table-1');
      assert.ok(issues[0].message.includes('exceeds mobile viewport width (375px)'));
    });

    test('Flags small touch targets on mobile (<48x48px)', () => {
      const probe = new ViewportProbe();
      const issues = probe.probeElements('mobile', [
        {
          uid: 'aether-icon-btn',
          tagName: 'button',
          width: 24, // 24x24 is too small for mobile touch
          height: 24,
          isInteractive: true,
        },
        {
          uid: 'aether-primary-btn',
          tagName: 'button',
          width: 120,
          height: 48, // 48px height passes
          isInteractive: true,
        },
      ]);

      const touchIssues = issues.filter((i) => i.type === 'TOUCH_TARGET_TOO_SMALL');
      assert.strictEqual(touchIssues.length, 1);
      assert.strictEqual(touchIssues[0].targetUid, 'aether-icon-btn');
      assert.strictEqual(touchIssues[0].severity, 'CRITICAL');
      assert.ok(touchIssues[0].message.includes('48x48px'));
    });
  });

  describe('Accessibility Checker & Reduced-Motion Compliance (FR-15, BR-15)', () => {
    test('Reduced-Motion: Flags animations lacking prefers-reduced-motion media query', () => {
      const checker = new AccessibilityChecker();
      const issues = checker.auditElements([
        {
          uid: 'aether-spinner',
          tagName: 'div',
          hasAnimation: true,
          isInfiniteAnimation: true,
          hasReducedMotionQuery: false, // Non-compliant!
        },
        {
          uid: 'aether-hero-motion',
          tagName: 'section',
          hasAnimation: true,
          hasReducedMotionQuery: true, // Compliant!
        },
      ]);

      const motionIssues = issues.filter((i) => i.type === 'REDUCED_MOTION_UNSAFE');
      assert.strictEqual(motionIssues.length, 1);
      assert.strictEqual(motionIssues[0].targetUid, 'aether-spinner');
      assert.strictEqual(motionIssues[0].severity, 'CRITICAL');
      assert.ok(motionIssues[0].message.includes('prefers-reduced-motion'));

      // Provides automated remediation CSS patch
      const patch = AccessibilityChecker.getReducedMotionCssPatch();
      assert.ok(patch.includes('@media (prefers-reduced-motion: reduce)'));
      assert.ok(patch.includes('animation-duration: 0.01ms !important'));
    });

    test('WCAG 2.1 AA Color Contrast calculation and threshold verification', () => {
      // 1. Black on White -> ~21:1 ratio
      const highRatio = AccessibilityChecker.calculateContrastRatio('#000000', '#FFFFFF');
      assert.ok(highRatio > 20);

      // 2. Light grey (#AAAAAA) on White (#FFFFFF) -> ~2.32:1 (Fails 4.5:1)
      const lowRatio = AccessibilityChecker.calculateContrastRatio('#AAAAAA', '#FFFFFF');
      assert.ok(lowRatio < 4.5);

      const checker = new AccessibilityChecker();
      const issues = checker.auditElements([
        {
          uid: 'aether-faint-text',
          tagName: 'p',
          color: '#AAAAAA',
          backgroundColor: '#FFFFFF',
          fontSizePx: 14,
        },
        {
          uid: 'aether-accessible-text',
          tagName: 'p',
          color: '#1F2937',
          backgroundColor: '#FFFFFF',
          fontSizePx: 14,
        },
      ]);

      const contrastIssues = issues.filter((i) => i.type === 'LOW_CONTRAST');
      assert.strictEqual(contrastIssues.length, 1);
      assert.strictEqual(contrastIssues[0].targetUid, 'aether-faint-text');
      assert.ok(contrastIssues[0].message.includes('fails WCAG AA'));
    });

    test('Flags missing image alt attributes and missing interactive labels', () => {
      const checker = new AccessibilityChecker();
      const issues = checker.auditElements([
        {
          uid: 'aether-img-no-alt',
          tagName: 'img',
          altText: undefined,
        },
        {
          uid: 'aether-icon-only-btn',
          tagName: 'button',
          accessibleName: '',
        },
        {
          uid: 'aether-outline-none',
          tagName: 'input',
          accessibleName: 'Search',
          hasOutlineNone: true,
          hasCustomFocusRing: false,
        },
      ]);

      assert.strictEqual(issues.some((i) => i.type === 'MISSING_ALT'), true);
      assert.strictEqual(issues.some((i) => i.type === 'MISSING_LABEL'), true);
      assert.strictEqual(issues.some((i) => i.type === 'OUTLINE_NONE'), true);
    });

    test('Compiles complete AuditReport with scoring and pass/fail status', () => {
      const probe = new ViewportProbe();
      const checker = new AccessibilityChecker();

      const viewportIssues = probe.probeElements('mobile', [
        {
          uid: 'aether-wide-div',
          tagName: 'div',
          width: 450,
          height: 100,
        },
      ]);

      const a11yIssues = checker.auditElements([
        {
          uid: 'aether-unlabeled-btn',
          tagName: 'button',
          accessibleName: '',
        },
      ]);

      const report = checker.generateAuditReport(viewportIssues, a11yIssues);

      assert.strictEqual(report.passed, false); // Failed because critical violations exist
      assert.strictEqual(report.criticalCount, 2);
      assert.strictEqual(report.totalIssues, 2);
      assert.strictEqual(report.score, 60); // 100 - (2 * 20) = 60
      assert.ok(report.summary.includes('Score 60/100'));
    });
  });
});
