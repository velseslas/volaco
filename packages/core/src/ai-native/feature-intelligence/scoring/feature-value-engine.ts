/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Feature Value Engine - Evaluates Intrinsic Business & User Value
 */

import type { FeatureCategory, FeatureComplexity, FeatureImpactAnalysis } from '../types.js';

export class FeatureValueEngine {
  public computeValueComponents(params: {
    readonly category: FeatureCategory;
    readonly impact: FeatureImpactAnalysis;
    readonly evidenceConfidence: number;
    readonly hasUserRequests: boolean;
    readonly matchesDna: boolean;
  }): {
    readonly businessValue: number;
    readonly userImpact: number;
    readonly strategicAlignment: number;
    readonly architecturalFeasibility: number;
    readonly riskMinimization: number;
  } {
    // 1. Business Value (0-100)
    let businessValue = 70;
    if (params.category === 'USER_NEED' || params.hasUserRequests) {
      businessValue += 15;
    }
    if (params.category === 'FUNCTIONAL_GAP') {
      businessValue += 10;
    }
    if (params.category === 'UX_IMPROVEMENT') {
      businessValue += 5;
    }
    businessValue = Math.min(100, businessValue);

    // 2. User Impact (0-100)
    let userImpact = 65;
    if (params.hasUserRequests) {
      userImpact += 20;
    }
    if (params.category === 'UX_IMPROVEMENT' || params.category === 'FUNCTIONAL_GAP') {
      userImpact += 10;
    }
    userImpact = Math.min(100, userImpact);

    // 3. Strategic Alignment (0-100)
    let strategicAlignment = params.matchesDna ? 85 : 65;
    if (params.category === 'ARCHITECTURE' || params.category === 'DESIGN_HARMONY') {
      strategicAlignment += 10;
    }
    strategicAlignment = Math.min(100, strategicAlignment);

    // 4. Architectural Feasibility (0-100) (inverse de la complexité)
    const feasibilityMap: Record<FeatureComplexity, number> = {
      LOW: 95,
      MEDIUM: 80,
      HIGH: 60,
      VERY_HIGH: 35
    };
    const architecturalFeasibility = feasibilityMap[params.impact.estimatedComplexity] ?? 75;

    // 5. Risk Minimization (0-100)
    const riskMinimization = Math.max(10, Math.min(100, Math.round(100 - params.impact.blastRadiusScore * 0.6)));

    return {
      businessValue,
      userImpact,
      strategicAlignment,
      architecturalFeasibility,
      riskMinimization
    };
  }
}
