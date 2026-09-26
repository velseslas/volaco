/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-013)
 * Accessibility Auditor - WCAG 2.1 AA Compliance Validation
 */

import { randomUUID } from 'node:crypto';
import { canonicalizeLength } from '../../visual-intelligence/canonical.js';
import type { NormalizedDomNode, VisualSnapshot } from '../../visual-intelligence/types.js';
import { computeContrastRatio } from '../../design-harmony/canonical.js';
import type { ApplicationAuditFinding } from '../types.js';

export class AccessibilityAuditor {
  public audit(snapshots?: readonly VisualSnapshot[]): readonly ApplicationAuditFinding[] {
    const findings: ApplicationAuditFinding[] = [];

    if (!snapshots || snapshots.length === 0) {
      return findings;
    }

    for (const snap of snapshots) {
      // 1. Check Interactive Elements for Missing Accessible Names
      for (const el of snap.interactiveElements) {
        if (!el.hasAccessibleName) {
          findings.push({
            id: `aaf-a11y-label-${randomUUID().slice(0, 8)}`,
            dimension: 'ACCESSIBILITY',
            severity: 'HIGH',
            title: `Contrôle interactif sans libellé accessible (${el.role})`,
            description: `L'élément interactif '${el.selector}' (${el.role}) n'a aucun texte visible ni attribut aria-label.`,
            location: {
              pageRoute: snap.pageRoute,
              selector: el.selector,
              nodeId: el.nodeId
            },
            cause: `Bouton ou icône cliquable dépourvu de texte accessible.`,
            impact: `Inaccessibilité complète pour les utilisateurs de lecteurs d'écran (critère WCAG 4.1.2 Name, Role, Value).`,
            recommendation: `Ajouter un attribut aria-label explicite ou un libellé textuel lisible.`,
            autoRemediable: true,
            suggestedAction: {
              agentDomain: 'UI',
              actionType: 'ADD_ACCESSIBLE_LABEL',
              description: `Ajouter aria-label="${el.role.toLowerCase()}" sur le bouton.`
            },
            evidence: [
              {
                source: 'VISUAL_LAYOUT',
                detail: `Élément ${el.role} avec label vide sur la route ${snap.pageRoute}.`,
                selector: el.selector
              }
            ]
          });
        }

        // 2. Check Mobile Touch Targets (< 40x40px)
        if (snap.viewport.kind === 'MOBILE' && el.bounds.isVisible && (el.bounds.width < 40 || el.bounds.height < 40)) {
          findings.push({
            id: `aaf-a11y-touch-${randomUUID().slice(0, 8)}`,
            dimension: 'ACCESSIBILITY',
            severity: 'MEDIUM',
            title: `Cible tactile mobile exiguë (${el.bounds.width}x${el.bounds.height}px)`,
            description: `La cible tactile de '${el.selector}' mesure moins de 40x40px sur écran mobile.`,
            location: {
              pageRoute: snap.pageRoute,
              selector: el.selector,
              nodeId: el.nodeId
            },
            cause: `Dimensions fixes trop restreintes pour l'usage tactile sur smartphone.`,
            impact: `Difficulté d'interaction pour les utilisateurs sur appareils tactiles (critère WCAG 2.5.5 Target Size).`,
            recommendation: `Augmenter la taille du composant ou son padding pour atteindre au moins 40x40px.`,
            autoRemediable: true,
            suggestedAction: {
              agentDomain: 'UI',
              actionType: 'EXPAND_TOUCH_TARGET',
              description: `Ajouter un padding minimal p-3 pour garantir 40x40px.`
            },
            evidence: [
              {
                source: 'VISUAL_LAYOUT',
                detail: `Dimensions mesurées: ${el.bounds.width}x${el.bounds.height}px sur viewport mobile.`,
                selector: el.selector,
                observedValue: `${el.bounds.width}x${el.bounds.height}px`,
                thresholdValue: '40x40px'
              }
            ]
          });
        }
      }

      // 3. Check WCAG 2.1 AA Text Contrast
      const traverse = (node: NormalizedDomNode, parentBg = '#ffffff') => {
        let currentBg = node.styles.backgroundColor;
        if (!currentBg || currentBg === 'transparent' || currentBg === 'inherit') {
          currentBg = parentBg;
        }

        const fg = node.styles.color;
        if (node.textContent.trim().length > 0 && fg && fg !== 'transparent' && currentBg && currentBg !== 'transparent') {
          const ratio = computeContrastRatio(fg, currentBg);
          const fontSizePx = canonicalizeLength(node.styles.fontSize);
          const isBold = parseInt(node.styles.fontWeight, 10) >= 600 || node.styles.fontWeight === 'bold';
          const isLarge = fontSizePx >= 18 || (fontSizePx >= 14 && isBold);
          const requiredRatio = isLarge ? 3.0 : 4.5;

          if (ratio < requiredRatio && ratio > 1) {
            findings.push({
              id: `aaf-a11y-contrast-${randomUUID().slice(0, 8)}`,
              dimension: 'ACCESSIBILITY',
              severity: 'HIGH',
              title: `Contraste de couleur insuffisant WCAG AA (${ratio}:1)`,
              description: `Le contraste entre le texte '${fg}' et le fond '${currentBg}' est de ${ratio}:1 (seuil requis: ${requiredRatio}:1).`,
              location: {
                pageRoute: snap.pageRoute,
                selector: node.selector,
                nodeId: node.id
              },
              cause: `Couleurs d'avant-plan et d'arrière-plan avec luminance relative trop proche.`,
              impact: `Difficulté ou impossibilité de lecture pour les personnes malvoyantes (critère WCAG 1.4.3 Contrast Minimum).`,
              recommendation: `Assombrir le texte ou éclaircir le fond pour dépasser le ratio de ${requiredRatio}:1.`,
              autoRemediable: true,
              suggestedAction: {
                agentDomain: 'UI',
                actionType: 'FIX_CONTRAST_RATIO',
                description: `Ajuster la nuance de couleur pour atteindre un contraste >= ${requiredRatio}:1.`
              },
              evidence: [
                {
                  source: 'VISUAL_LAYOUT',
                  detail: `Ratio calculé: ${ratio}:1 (requis: ${requiredRatio}:1) pour fg=${fg}, bg=${currentBg}.`,
                  observedValue: `${ratio}:1`,
                  thresholdValue: `${requiredRatio}:1`,
                  selector: node.selector
                }
              ]
            });
          }
        }

        for (const child of node.children) {
          traverse(child, currentBg);
        }
      };

      traverse(snap.rootNode);
    }

    return findings;
  }
}
