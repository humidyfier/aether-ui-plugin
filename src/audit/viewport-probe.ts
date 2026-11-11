import { randomUUID } from 'node:crypto';
import {
  STANDARD_VIEWPORTS,
  ViewportDefinition,
  ViewportPreset,
  ViewportProbeIssue,
} from './audit.model';

export interface ElementLayoutMetric {
  uid: string;
  tagName: string;
  width: number;
  height: number;
  scrollWidth?: number;
  clientWidth?: number;
  isInteractive?: boolean; // button, a, input, select
  cssProperties?: Record<string, string>;
}

export class ViewportProbe {
  private viewports: Record<ViewportPreset, ViewportDefinition>;

  constructor(customViewports?: Record<ViewportPreset, ViewportDefinition>) {
    this.viewports = customViewports || STANDARD_VIEWPORTS;
  }

  public getViewports(): Record<ViewportPreset, ViewportDefinition> {
    return this.viewports;
  }

  /**
   * Probes layout elements against mobile (375px), tablet (768px), and desktop (1280px) viewports.
   */
  public probeElements(
    preset: ViewportPreset,
    elements: ElementLayoutMetric[]
  ): ViewportProbeIssue[] {
    const vp = this.viewports[preset];
    const issues: ViewportProbeIssue[] = [];

    for (const el of elements) {
      // 1. Check Horizontal Overflow
      const hasOverflow =
        (el.scrollWidth && el.clientWidth && el.scrollWidth > el.clientWidth) ||
        el.width > vp.width;

      if (hasOverflow) {
        issues.push({
          id: randomUUID(),
          preset,
          type: 'HORIZONTAL_OVERFLOW',
          severity: 'CRITICAL',
          targetUid: el.uid,
          elementTag: el.tagName,
          message: `Element <${el.tagName}> width (${el.width}px) exceeds ${preset} viewport width (${vp.width}px), causing horizontal scrolling.`,
          measuredValue: `${el.width}px`,
          expectedValue: `<= ${vp.width}px`,
          suggestedFix: `Add 'max-width: 100%;' or 'overflow-x: hidden;' to the container.`,
        });
      }

      // Check fixed CSS widths exceeding viewport
      if (el.cssProperties && el.cssProperties.width) {
        const pxMatch = el.cssProperties.width.match(/^(\d+)px$/);
        if (pxMatch) {
          const pxVal = parseInt(pxMatch[1], 10);
          if (pxVal > vp.width && !el.cssProperties['max-width']) {
            issues.push({
              id: randomUUID(),
              preset,
              type: 'HORIZONTAL_OVERFLOW',
              severity: 'CRITICAL',
              targetUid: el.uid,
              elementTag: el.tagName,
              message: `Element <${el.tagName}> has fixed width '${el.cssProperties.width}' without max-width on ${preset} viewport.`,
              measuredValue: el.cssProperties.width,
              expectedValue: `max-width: 100% or <= ${vp.width}px`,
              suggestedFix: `Replace fixed '${el.cssProperties.width}' with 'max-width: 100%; width: 100%;' for responsive scaling.`,
            });
          }
        }
      }

      // 2. Check Touch Target Sizing (Mobile & Tablet)
      const isTouchViewport = preset === 'mobile' || preset === 'tablet';
      const isInteractive =
        el.isInteractive ||
        ['button', 'a', 'input', 'select', 'textarea'].includes(el.tagName.toLowerCase());

      if (isTouchViewport && isInteractive) {
        const minTargetSize = preset === 'mobile' ? 48 : 44; // WCAG 2.5.5 / Android & iOS HIG
        const isTooSmall = el.width < minTargetSize || el.height < minTargetSize;

        if (isTooSmall) {
          issues.push({
            id: randomUUID(),
            preset,
            type: 'TOUCH_TARGET_TOO_SMALL',
            severity: preset === 'mobile' ? 'CRITICAL' : 'WARNING',
            targetUid: el.uid,
            elementTag: el.tagName,
            message: `Interactive touch target <${el.tagName}> is ${el.width}x${el.height}px, below the ${minTargetSize}x${minTargetSize}px touch target recommendation (FR-14).`,
            measuredValue: `${el.width}x${el.height}px`,
            expectedValue: `>= ${minTargetSize}x${minTargetSize}px`,
            suggestedFix: `Increase padding or set 'min-height: ${minTargetSize}px; min-width: ${minTargetSize}px; display: inline-flex; align-items: center; justify-content: center;'.`,
          });
        }
      }
    }

    return issues;
  }

  /**
   * Runs a complete multi-viewport audit across mobile (375px), tablet (768px), and desktop (1280px).
   */
  public probeAllViewports(
    elementMetricsByPreset: Record<ViewportPreset, ElementLayoutMetric[]>
  ): Record<ViewportPreset, ViewportProbeIssue[]> {
    return {
      mobile: this.probeElements('mobile', elementMetricsByPreset.mobile || []),
      tablet: this.probeElements('tablet', elementMetricsByPreset.tablet || []),
      desktop: this.probeElements('desktop', elementMetricsByPreset.desktop || []),
    };
  }
}
