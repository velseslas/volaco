/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Signal Collector - Collects Cross-Disciplinary Signals for Product Opportunities
 */

import type { FeatureFileEntry } from '../types.js';
import type { ApplicationDNA } from '../../dna/types.js';
import type { ApplicationAuditReport, ApplicationAuditFinding } from '../../application-audit/types.js';
import type { ConversationTurn, ArchitecturalDecisionRecord } from '../../conversation-intelligence/types.js';

export interface CollectedSignals {
  readonly filePaths: readonly string[];
  readonly totalFileCount: number;
  readonly detectedRoutes: readonly string[];
  readonly detectedComponents: readonly string[];
  readonly auditFindings: readonly ApplicationAuditFinding[];
  readonly userRequests: readonly { readonly text: string; readonly count: number }[];
  readonly architecturalDecisions: readonly string[];
  readonly stackFramework: string;
  readonly primaryPattern: string;
}

export class SignalCollector {
  public collectSignals(params: {
    readonly files?: readonly FeatureFileEntry[] | undefined;
    readonly dna?: ApplicationDNA | undefined;
    readonly auditReport?: ApplicationAuditReport | undefined;
    readonly conversationHistory?: readonly ConversationTurn[] | undefined;
    readonly existingDecisions?: readonly ArchitecturalDecisionRecord[] | undefined;
  }): CollectedSignals {
    const { files = [], dna, auditReport, conversationHistory = [], existingDecisions = [] } = params;

    // 1. Files & Component Signals
    const filePaths = files.map((f) => f.path);
    const totalFileCount = filePaths.length;

    // Scan file content for routes and components
    const detectedRoutes = new Set<string>();
    const detectedComponents = new Set<string>();

    for (const f of files) {
      // Routes detection
      const routeMatches = f.content.matchAll(/(?:href|path|to)=["'](\/[a-zA-Z0-9_\-\/]+)["']/g);
      for (const m of routeMatches) {
        if (m[1]) detectedRoutes.add(m[1]);
      }

      // Component declaration detection
      const compMatches = f.content.matchAll(/(?:function|const|class)\s+([A-Z][a-zA-Z0-9_]+)\s*(?:=|extends|\()/g);
      for (const cm of compMatches) {
        if (cm[1]) detectedComponents.add(cm[1]);
      }

      // Component from file name (e.g. src/components/SearchBar.js -> SearchBar)
      const baseName = f.path.split(/[\/\\]/).pop()?.replace(/\.[^.]+$/, '');
      if (baseName && /^[A-Z][a-zA-Z0-9_]+$/.test(baseName)) {
        detectedComponents.add(baseName);
      }
    }

    // 2. DNA Integration
    if (dna) {
      for (const comp of dna.components) {
        detectedComponents.add(comp.name);
      }
    }

    // 3. Conversation Turn Signals (Detect repeated user queries/needs)
    const requestFrequency = new Map<string, number>();
    for (const turn of conversationHistory) {
      const msg = turn.userMessage.content.toLowerCase().trim();
      if (msg.length > 3) {
        const count = requestFrequency.get(msg) || 0;
        requestFrequency.set(msg, count + 1);
      }
    }

    const userRequests = Array.from(requestFrequency.entries()).map(([text, count]) => ({
      text,
      count
    }));

    // 4. Decisions Signals
    const architecturalDecisions = existingDecisions.map((d) => d.statement);

    return {
      filePaths,
      totalFileCount,
      detectedRoutes: Array.from(detectedRoutes),
      detectedComponents: Array.from(detectedComponents),
      auditFindings: auditReport ? auditReport.findings : [],
      userRequests,
      architecturalDecisions,
      stackFramework: dna?.stack.framework.name || 'HTML5/ES6',
      primaryPattern: dna?.architecture.primaryPattern.pattern || 'SPA'
    };
  }
}
