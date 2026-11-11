import { randomUUID } from 'node:crypto';
import { AccessibilityIssue, AuditReport, ViewportProbeIssue } from './audit.model';

export interface StyleNodeInspection {
  uid?: string;
  tagName: string;
  cssText?: string;
  color?: string; // e.g. "#777777"
  backgroundColor?: string; // e.g. "#FFFFFF"
  fontSizePx?: number;
  isBold?: boolean;
  hasAnimation?: boolean;
  isInfiniteAnimation?: boolean;
  hasReducedMotionQuery?: boolean;
  hasOutlineNone?: boolean;
  hasCustomFocusRing?: boolean;
  altText?: string;
  accessibleName?: string;
}

export class AccessibilityChecker {
  /**
   * Calculates WCAG 2.1 relative luminance for an sRGB hex or rgb color.
   */
  public static calculateLuminance(color: string): number {
    const rgb = AccessibilityChecker.parseRgb(color);
    if (!rgb) return 0;

    const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /**
   * Calculates contrast ratio between two colors: (L1 + 0.05) / (L2 + 0.05).
   */
  public static calculateContrastRatio(color1: string, color2: string): number {
    const l1 = AccessibilityChecker.calculateLuminance(color1);
    const l2 = AccessibilityChecker.calculateLuminance(color2);

    const brighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);

    return (brighter + 0.05) / (darker + 0.05);
  }

  public static parseRgb(color: string): { r: number; g: number; b: number } | null {
    const clean = color.trim().toLowerCase();

    // Hex #rgb or #rrggbb
    if (clean.startsWith('#')) {
      const hex = clean.slice(1);
      if (hex.length === 3) {
        return {
          r: parseInt(hex[0] + hex[0], 16),
          g: parseInt(hex[1] + hex[1], 16),
          b: parseInt(hex[2] + hex[2], 16),
        };
      }
      if (hex.length === 6) {
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
        };
      }
    }

    // rgb(r, g, b)
    const rgbMatch = clean.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgbMatch) {
      return {
        r: parseInt(rgbMatch[1], 10),
        g: parseInt(rgbMatch[2], 10),
        b: parseInt(rgbMatch[3], 10),
      };
    }

    return null;
  }

  /**
   * Generates the standard WCAG reduced-motion CSS remediation patch.
   */
  public static getReducedMotionCssPatch(): string {
    return `@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}`;
  }

  /**
   * Audits a list of styled element nodes for WCAG 2.1 AA and reduced-motion compliance (FR-15, BR-15).
   */
  public auditElements(elements: StyleNodeInspection[]): AccessibilityIssue[] {
    const issues: AccessibilityIssue[] = [];

    for (const el of elements) {
      // 1. Reduced Motion Compliance
      if (el.hasAnimation || el.isInfiniteAnimation) {
        if (!el.hasReducedMotionQuery) {
          issues.push({
            id: randomUUID(),
            type: 'REDUCED_MOTION_UNSAFE',
            severity: el.isInfiniteAnimation ? 'CRITICAL' : 'WARNING',
            targetUid: el.uid,
            elementTag: el.tagName,
            message: `Element <${el.tagName}> includes ${el.isInfiniteAnimation ? 'infinite ' : ''}animations without '@media (prefers-reduced-motion: reduce)' accommodation (FR-15, BR-15).`,
            wcagCriterion: 'WCAG 2.2.2 (Pause, Stop, Hide) & 2.3.3 (Animation from Interactions)',
            suggestedFix: `Wrap animations in '@media (prefers-reduced-motion: no-preference)' or inject the Aether reduced-motion remediation CSS patch.`,
          });
        }
      }

      // 2. Color Contrast Verification (WCAG AA)
      if (el.color && el.backgroundColor) {
        const ratio = AccessibilityChecker.calculateContrastRatio(el.color, el.backgroundColor);
        const isLargeText = (el.fontSizePx && el.fontSizePx >= 24) || (el.fontSizePx && el.fontSizePx >= 18.66 && el.isBold);
        const requiredRatio = isLargeText ? 3.0 : 4.5;

        if (ratio < requiredRatio) {
          issues.push({
            id: randomUUID(),
            type: 'LOW_CONTRAST',
            severity: ratio < 3.0 ? 'CRITICAL' : 'WARNING',
            targetUid: el.uid,
            elementTag: el.tagName,
            message: `Color contrast ratio ${ratio.toFixed(2)}:1 between text (${el.color}) and background (${el.backgroundColor}) fails WCAG AA required ${requiredRatio}:1 for ${isLargeText ? 'large' : 'normal'} text.`,
            wcagCriterion: 'WCAG 1.4.3 (Contrast Minimum)',
            measuredValue: `${ratio.toFixed(2)}:1`,
            expectedValue: `>= ${requiredRatio}:1`,
            suggestedFix: `Adjust text color or background lightness to achieve at least ${requiredRatio}:1 contrast ratio.`,
          });
        }
      }

      // 3. Image Alt Attribute Check
      if (el.tagName.toLowerCase() === 'img') {
        if (el.altText === undefined || el.altText === null || el.altText.trim() === '') {
          issues.push({
            id: randomUUID(),
            type: 'MISSING_ALT',
            severity: 'CRITICAL',
            targetUid: el.uid,
            elementTag: el.tagName,
            message: `Image element <img> is missing an accessible 'alt' attribute.`,
            wcagCriterion: 'WCAG 1.1.1 (Non-text Content)',
            suggestedFix: `Provide a descriptive 'alt="Description of image"' or 'alt=""' if purely decorative.`,
          });
        }
      }

      // 4. Interactive Element Labels
      const isInteractive = ['button', 'input', 'select', 'textarea'].includes(el.tagName.toLowerCase());
      if (isInteractive) {
        if (!el.accessibleName || el.accessibleName.trim() === '') {
          issues.push({
            id: randomUUID(),
            type: 'MISSING_LABEL',
            severity: 'CRITICAL',
            targetUid: el.uid,
            elementTag: el.tagName,
            message: `Interactive element <${el.tagName}> has no discernible accessible name or text content.`,
            wcagCriterion: 'WCAG 4.1.2 (Name, Role, Value)',
            suggestedFix: `Add visible text content, an 'aria-label', or associate an external <label>.`,
          });
        }
      }

      // 5. Outline None Focus Check
      if (el.hasOutlineNone && !el.hasCustomFocusRing) {
        issues.push({
          id: randomUUID(),
          type: 'OUTLINE_NONE',
          severity: 'CRITICAL',
          targetUid: el.uid,
          elementTag: el.tagName,
          message: `Focus outline was removed with 'outline: none' without supplying a custom focus indicator (FR-15).`,
          wcagCriterion: 'WCAG 2.4.7 (Focus Visible)',
          suggestedFix: `Provide an accessible custom focus ring, e.g. 'box-shadow: 0 0 0 2px #2563EB; outline: none;'.`,
        });
      }
    }

    return issues;
  }

  /**
   * Compiles a comprehensive AuditReport combining viewport probe and accessibility checks.
   */
  public generateAuditReport(
    viewportIssues: ViewportProbeIssue[],
    accessibilityIssues: AccessibilityIssue[]
  ): AuditReport {
    const allCritical = [
      ...viewportIssues.filter((i) => i.severity === 'CRITICAL'),
      ...accessibilityIssues.filter((i) => i.severity === 'CRITICAL'),
    ];
    const allWarnings = [
      ...viewportIssues.filter((i) => i.severity === 'WARNING'),
      ...accessibilityIssues.filter((i) => i.severity === 'WARNING'),
    ];
    const allSuggestions = [
      ...viewportIssues.filter((i) => i.severity === 'SUGGESTION'),
      ...accessibilityIssues.filter((i) => i.severity === 'SUGGESTION'),
    ];

    const totalIssues = viewportIssues.length + accessibilityIssues.length;
    // Score penalty calculation: Critical = -20 pts, Warning = -5 pts, Suggestion = -2 pts
    const penalty = allCritical.length * 20 + allWarnings.length * 5 + allSuggestions.length * 2;
    const score = Math.max(0, 100 - penalty);
    const passed = allCritical.length === 0;

    let summary = `Audit completed: Score ${score}/100. `;
    if (passed) {
      summary += 'All critical responsiveness and accessibility criteria passed.';
    } else {
      summary += `${allCritical.length} critical violation(s) detected. Fixes required prior to implementation approval (FR-19).`;
    }

    return {
      timestamp: new Date().toISOString(),
      passed,
      score,
      totalIssues,
      criticalCount: allCritical.length,
      warningCount: allWarnings.length,
      suggestionCount: allSuggestions.length,
      viewportIssues,
      accessibilityIssues,
      summary,
    };
  }
}
