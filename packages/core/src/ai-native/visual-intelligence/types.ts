/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-011)
 * Visual Intelligence Engine - Data Contracts
 */

export type ViewportKind = 'MOBILE' | 'TABLET' | 'LAPTOP' | 'DESKTOP' | 'DESKTOP_HD' | 'WIDE';

export interface ViewportDimension {
  readonly kind: ViewportKind;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
}

export const STANDARD_VIEWPORTS: Record<ViewportKind, ViewportDimension> = {
  MOBILE: { kind: 'MOBILE', width: 375, height: 667, scale: 1 },
  TABLET: { kind: 'TABLET', width: 768, height: 1024, scale: 1 },
  LAPTOP: { kind: 'LAPTOP', width: 1024, height: 768, scale: 1 },
  DESKTOP: { kind: 'DESKTOP', width: 1280, height: 800, scale: 1 },
  DESKTOP_HD: { kind: 'DESKTOP_HD', width: 1440, height: 900, scale: 1 },
  WIDE: { kind: 'WIDE', width: 1920, height: 1080, scale: 1 }
};

export interface LayoutBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly isVisible: boolean;
  readonly hasOverflow: boolean;
}

export interface ComputedStyleSnapshot {
  readonly color: string;
  readonly backgroundColor: string;
  readonly fontFamily: string;
  readonly fontSize: string;
  readonly fontWeight: string;
  readonly lineHeight: string;
  readonly padding: string;
  readonly margin: string;
  readonly borderRadius: string;
  readonly borderWidth: string;
  readonly borderColor: string;
  readonly boxShadow: string;
  readonly display: string;
  readonly flexDirection: string;
  readonly justifyContent: string;
  readonly alignItems: string;
  readonly gap: string;
  readonly opacity: number;
  readonly zIndex: number;
  /**
   * CDC V8 §7.2 / §7.6 / §7.7 — champs ADDITIFS capturés par le rendu réel
   * (computed styles Chromium) ou le parseur CSS de repli. Optionnels pour
   * préserver les snapshots historiques : un champ absent = preuve absente,
   * jamais une valeur inventée.
   */
  readonly letterSpacing?: string | undefined;
  readonly transitionProperty?: string | undefined;
  readonly transitionDuration?: string | undefined;
  readonly transitionTimingFunction?: string | undefined;
  readonly animationName?: string | undefined;
  readonly animationDuration?: string | undefined;
  readonly animationTimingFunction?: string | undefined;
  readonly maxWidth?: string | undefined;
  readonly gridTemplateColumns?: string | undefined;
  readonly columnGap?: string | undefined;
  readonly rowGap?: string | undefined;
}

export type SemanticRole =
  | 'BUTTON'
  | 'INPUT'
  | 'LINK'
  | 'HEADING'
  | 'PARAGRAPH'
  | 'IMAGE'
  | 'CARD'
  | 'NAVIGATION'
  | 'CONTAINER'
  | 'MODAL'
  | 'FORM'
  | 'OTHER';

export interface NormalizedDomNode {
  readonly id: string;
  readonly tagName: string;
  readonly role: SemanticRole;
  readonly attributes: Record<string, string>;
  readonly classes: readonly string[];
  readonly textContent: string;
  readonly styles: ComputedStyleSnapshot;
  readonly layout: LayoutBox;
  readonly children: readonly NormalizedDomNode[];
  readonly depth: number;
  readonly selector: string;
}

export interface InteractiveElementProfile {
  readonly nodeId: string;
  readonly role: SemanticRole;
  readonly selector: string;
  readonly label: string;
  readonly bounds: LayoutBox;
  readonly hasAccessibleName: boolean;
  readonly isClickable: boolean;
  readonly isFormInput: boolean;
}

export interface VisualSnapshot {
  readonly snapshotId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly pageRoute: string;
  readonly viewport: ViewportDimension;
  readonly rootNode: NormalizedDomNode;
  readonly totalElementsCount: number;
  readonly interactiveElements: readonly InteractiveElementProfile[];
  readonly extractedColors: readonly string[];
  readonly extractedFonts: readonly string[];
  readonly snapshotHash: string;
  readonly capturedAt: string;
  readonly durationMs: number;
  readonly screenshotBase64?: string | undefined;
  /**
   * Provenance des boîtes de layout : RUNTIME quand le rendu Chromium a fourni
   * de vraies getBoundingClientRect, ESTIMATED quand le parseur statique les a
   * dérivées. Le Design Critic baisse sa confiance sur les mesures estimées.
   */
  readonly layoutSource?: 'RUNTIME' | 'ESTIMATED' | undefined;
}

export interface VisualIntelligenceConfig {
  readonly cacheMaxEntries: number;
  readonly defaultViewport: ViewportKind;
  readonly enableVisionLLM: boolean;
  readonly maxDomDepth: number;
}

export interface VisualAnalysisRequest {
  readonly tenantId: string;
  readonly projectId: string;
  readonly pageRoute?: string | undefined;
  readonly htmlContent?: string | undefined;
  readonly cssContent?: string | undefined;
  readonly runtimeDom?: unknown | undefined;
  readonly viewport?: ViewportKind | undefined;
  readonly screenshotBase64?: string | undefined;
  readonly requestId?: string | undefined;
}

export interface MultimodalVisionInsight {
  readonly summary: string;
  readonly detectedAnomalies: readonly string[];
  readonly confidence: number;
  readonly modelUsed: string;
}

export interface VisualAnalysisResult {
  readonly snapshot: VisualSnapshot;
  readonly multimodalInsights?: MultimodalVisionInsight | undefined;
  readonly executionMeta: {
    readonly durationMs: number;
    readonly source: 'RUNTIME_PROBE' | 'HEADLESS_HTML' | 'CACHED';
  };
}
