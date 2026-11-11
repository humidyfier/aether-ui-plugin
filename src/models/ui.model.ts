/**
 * FR-04 to FR-08: UIConcept & Reference Data Models
 * Enforces 2-3 comparable visual concepts, design tokens, typography,
 * color palettes, density, component styling, responsive behaviors, and source-attributed references.
 */

export interface AttributedReference {
  id: string;
  url?: string;
  title: string;
  sourceName?: string;
  observedQualities: string[];
  sourceStatus: 'accessible' | 'blocked' | 'paywalled' | 'user_provided' | 'cached';
  disclaimer: string;
}

export interface TypographyTokens {
  fontFamilySans: string;
  fontFamilySerif?: string;
  fontFamilyMono: string;
  scale: {
    xs: string;
    sm: string;
    base: string;
    lg: string;
    xl: string;
    '2xl': string;
    '3xl': string;
  };
  weights: {
    regular: number;
    medium: number;
    semibold: number;
    bold: number;
  };
  lineHeights: {
    tight: string;
    normal: string;
    relaxed: string;
  };
}

export interface ColorPaletteTokens {
  primary: string;
  primaryHover?: string;
  secondary: string;
  background: string;
  surface: string;
  surfaceHover?: string;
  textPrimary: string;
  textSecondary: string;
  muted: string;
  border: string;
  accent?: string;
  success: string;
  warning: string;
  error: string;
}

export interface DensityTokens {
  mode: 'compact' | 'comfortable' | 'spacious';
  spacingUnit: number; // e.g. 4px base
  padding: {
    button: string;
    card: string;
    input: string;
  };
  gap: {
    grid: string;
    list: string;
  };
}

export interface ComponentStyleDefinition {
  componentName: 'Button' | 'Card' | 'Input' | 'Modal' | 'Table' | 'Navbar' | string;
  cssProperties: Record<string, string>;
  variants?: Record<string, Record<string, string>>;
}

export interface ResponsiveBehaviorRule {
  breakpoint: 'mobile' | 'tablet' | 'desktop';
  minWidth: number;
  layoutAdjustments: {
    navigation: 'drawer' | 'tabs' | 'sidebar' | 'topbar';
    columns: number;
    whitespaceMultiplier: number;
  };
}

export interface ComparableScreenSample {
  id: string;
  route: string;
  screenName: string;
  description: string;
  mockComponentHierarchy: string[];
  visualHighlights: string[];
}

export interface UIConcept {
  id: string;
  briefId: string;
  uxDirectionId: string;
  name: string;
  styleApproach: string; // e.g., 'Warm Minimal', 'High-Contrast Technical', 'Modern Humanist'
  typography: TypographyTokens;
  palette: ColorPaletteTokens;
  density: DensityTokens;
  designTokens: Record<string, string | number>;
  componentStyles: ComponentStyleDefinition[];
  responsiveRules: ResponsiveBehaviorRule[];
  sampleScreens: ComparableScreenSample[];
  attributedReferences: AttributedReference[];
  isSelected: boolean;
  userOverrides?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}
