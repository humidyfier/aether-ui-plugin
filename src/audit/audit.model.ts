export type ViewportPreset = 'mobile' | 'tablet' | 'desktop';

export interface ViewportDefinition {
  preset: ViewportPreset;
  width: number;
  height: number;
  name: string;
}

export const STANDARD_VIEWPORTS: Record<ViewportPreset, ViewportDefinition> = {
  mobile: { preset: 'mobile', width: 375, height: 667, name: 'Mobile (375px)' },
  tablet: { preset: 'tablet', width: 768, height: 1024, name: 'Tablet (768px)' },
  desktop: { preset: 'desktop', width: 1280, height: 800, name: 'Desktop (1280px)' },
};

export type IssueSeverity = 'CRITICAL' | 'WARNING' | 'SUGGESTION';

export interface ViewportProbeIssue {
  id: string;
  preset: ViewportPreset;
  type:
    | 'HORIZONTAL_OVERFLOW'
    | 'TOUCH_TARGET_TOO_SMALL'
    | 'TEXT_TRUNCATION'
    | 'UNRESPONSIVE_HIERARCHY';
  severity: IssueSeverity;
  targetUid?: string;
  elementTag?: string;
  message: string;
  measuredValue?: string | number;
  expectedValue?: string | number;
  suggestedFix: string;
}

export interface AccessibilityIssue {
  id: string;
  type:
    | 'REDUCED_MOTION_UNSAFE'
    | 'LOW_CONTRAST'
    | 'MISSING_ALT'
    | 'MISSING_LABEL'
    | 'OUTLINE_NONE';
  severity: IssueSeverity;
  targetUid?: string;
  elementTag?: string;
  message: string;
  wcagCriterion?: string;
  measuredValue?: string;
  expectedValue?: string;
  suggestedFix: string;
}

export interface AuditReport {
  timestamp: string;
  passed: boolean;
  score: number; // 0 - 100
  totalIssues: number;
  criticalCount: number;
  warningCount: number;
  suggestionCount: number;
  viewportIssues: ViewportProbeIssue[];
  accessibilityIssues: AccessibilityIssue[];
  summary: string;
}
