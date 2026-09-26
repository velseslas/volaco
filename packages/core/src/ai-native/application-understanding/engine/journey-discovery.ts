/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-008)
 * User Journey Discovery Engine
 */

import type { SemanticCodeGraph, SemanticNode } from '../../semantic-graph/types.js';
import type { SemanticFeature, SemanticUserJourney, UserJourneyStep, UnderstandingEvidence } from '../types.js';
import { calculateConfidence, determineCertainty } from './confidence.js';
import { createEvidence } from './evidence.js';
import { compareJourneys } from './canonical.js';

export function discoverUserJourneys(
  graph: SemanticCodeGraph,
  features: readonly SemanticFeature[]
): readonly SemanticUserJourney[] {
  if (!graph || !graph.nodes || graph.nodes.length === 0) {
    return [];
  }

  const journeys: SemanticUserJourney[] = [];
  const featureIds = new Set(features.map(f => f.featureId));

  // 1. Authentication Journey (if authentication feature discovered)
  if (featureIds.has('feat_authentication')) {
    const authFeat = features.find(f => f.featureId === 'feat_authentication')!;
    const loginComp = authFeat.components.find(c => /login/i.test(c)) || 'LoginPage';
    const evidence: UnderstandingEvidence[] = [
      createEvidence('ROUTE_DECLARATION', 'Auth Route', 'User onboarding & login journey routes'),
      ...authFeat.evidence.slice(0, 3)
    ];

    journeys.push({
      journeyId: 'journey_user_authentication',
      name: 'User Authentication & Onboarding Journey',
      actor: 'ANONYMOUS_USER',
      entryPoints: authFeat.entryPoints.length > 0 ? authFeat.entryPoints : ['/login'],
      steps: [
        {
          stepIndex: 0,
          pageOrRoute: '/login',
          action: 'Navigate to Authentication portal',
          targetComponent: loginComp,
          resultingState: 'LOGIN_FORM_DISPLAYED'
        },
        {
          stepIndex: 1,
          pageOrRoute: '/api/auth/login',
          action: 'Submit credentials for authentication',
          resultingState: 'CREDENTIALS_VERIFIED'
        },
        {
          stepIndex: 2,
          pageOrRoute: '/dashboard',
          action: 'Redirect to authenticated application workspace',
          resultingState: 'AUTHENTICATED_SESSION_ACTIVE'
        }
      ],
      terminalStates: ['AUTHENTICATED', 'AUTH_REJECTED'],
      certainty: authFeat.certainty,
      confidence: authFeat.confidence,
      evidence: evidence.sort((a, b) => a.source.localeCompare(b.source))
    });
  }

  // 2. Checkout & Purchase Journey (if billing/payments feature discovered)
  if (featureIds.has('feat_payments_billing')) {
    const billFeat = features.find(f => f.featureId === 'feat_payments_billing')!;
    const evidence: UnderstandingEvidence[] = [
      createEvidence('ROUTE_DECLARATION', 'Checkout Route', 'E-commerce transactional checkout journey'),
      ...billFeat.evidence.slice(0, 3)
    ];

    journeys.push({
      journeyId: 'journey_checkout_purchase',
      name: 'Product Checkout & Payment Journey',
      actor: 'CUSTOMER',
      entryPoints: billFeat.entryPoints.length > 0 ? billFeat.entryPoints : ['/cart'],
      steps: [
        {
          stepIndex: 0,
          pageOrRoute: '/cart',
          action: 'Review selected items in shopping cart',
          resultingState: 'CART_CONFIRMED'
        },
        {
          stepIndex: 1,
          pageOrRoute: '/checkout',
          action: 'Enter billing details and confirm order',
          resultingState: 'ORDER_PENDING'
        },
        {
          stepIndex: 2,
          pageOrRoute: '/checkout/success',
          action: 'Process transaction and view confirmation',
          resultingState: 'TRANSACTION_SETTLED'
        }
      ],
      terminalStates: ['PAYMENT_SUCCESS', 'PAYMENT_FAILED'],
      certainty: billFeat.certainty,
      confidence: billFeat.confidence,
      evidence: evidence.sort((a, b) => a.source.localeCompare(b.source))
    });
  }

  // 3. Workspace / Dashboard Journey (default primary journey)
  const dashboardFeat = features.find(f => f.featureId === 'feat_dashboard_analytics');
  const mainEntry = graph.nodes.find((n: SemanticNode) => n.kind === 'ENTRY_POINT' || (n.kind === 'ROUTE' && (n.name === '/' || n.name === '/index.html')));
  const mainEntryName = mainEntry ? mainEntry.name : '/';

  const defaultEvidence: UnderstandingEvidence[] = [
    createEvidence('ROUTE_DECLARATION', `Main Entry: ${mainEntryName}`, 'Primary application exploration journey')
  ];
  if (dashboardFeat) defaultEvidence.push(...dashboardFeat.evidence.slice(0, 2));

  journeys.push({
    journeyId: 'journey_primary_exploration',
    name: 'Primary Application Exploration & Navigation',
    actor: 'USER',
    entryPoints: [mainEntryName],
    steps: [
      {
        stepIndex: 0,
        pageOrRoute: mainEntryName,
        action: 'Access application root',
        resultingState: 'APPLICATION_LOADED'
      },
      {
        stepIndex: 1,
        pageOrRoute: '/workspace',
        action: 'Interact with primary application workspace',
        resultingState: 'WORKSPACE_ACTIVE'
      }
    ],
    terminalStates: ['SESSION_IDLE', 'SESSION_TERMINATED'],
    certainty: determineCertainty(calculateConfidence(defaultEvidence)),
    confidence: calculateConfidence(defaultEvidence),
    evidence: defaultEvidence.sort((a, b) => a.source.localeCompare(b.source))
  });

  return journeys.sort(compareJourneys);
}
