/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-013)
 * UX Auditor - Ergonomics & Visual Overflow Validation
 */

import { randomUUID } from 'node:crypto';
import type { NormalizedDomNode, VisualSnapshot } from '../../visual-intelligence/types.js';
import type { ApplicationAuditFinding, AuditFileEntry } from '../types.js';

export class UXAuditor {
  public audit(
    files: readonly AuditFileEntry[],
    snapshots?: readonly VisualSnapshot[]
  ): readonly ApplicationAuditFinding[] {
    const findings: ApplicationAuditFinding[] = [];

    // 1. Inspect Visual Snapshots for Layout Overflow
    if (snapshots && snapshots.length > 0) {
      for (const snap of snapshots) {
        const traverse = (node: NormalizedDomNode) => {
          if (node.layout.hasOverflow && node.layout.isVisible) {
            findings.push({
              id: `aaf-ux-overflow-${randomUUID().slice(0, 8)}`,
              dimension: 'UX',
              severity: snap.viewport.kind === 'MOBILE' ? 'HIGH' : 'MEDIUM',
              title: `Débordement d'affichage hors du viewport (${snap.viewport.kind})`,
              description: `L'élément '${node.selector}' déborde des limites de l'écran sur le viewport ${snap.viewport.kind} (${snap.viewport.width}x${snap.viewport.height}px).`,
              location: {
                pageRoute: snap.pageRoute,
                selector: node.selector,
                nodeId: node.id
              },
              cause: `Largeur fixe excessive ou absence de gestion responsive (overflow-x/flex-wrap).`,
              impact: `Apparition d'une barre de défilement horizontale indésirable et expérience utilisateur dégradée.`,
              recommendation: `Appliquer une largeur relative (max-w-full) ou autoriser le retour à la ligne (flex-wrap).`,
              autoRemediable: true,
              suggestedAction: {
                agentDomain: 'UI',
                actionType: 'FIX_RESPONSIVE_OVERFLOW',
                description: `Ajouter max-w-full ou overflow-x-hidden sur l'élément débordant.`
              },
              evidence: [
                {
                  source: 'VISUAL_LAYOUT',
                  detail: `Nœud ${node.id} déborde du viewport ${snap.viewport.width}x${snap.viewport.height}px.`,
                  selector: node.selector
                }
              ]
            });
          }

          for (const child of node.children) {
            traverse(child);
          }
        };

        traverse(snap.rootNode);
      }
    }

    // 2. Inspect Code for Dead Links & Empty Anchors
    for (const file of files) {
      if (file.path.endsWith('.html') || file.path.endsWith('.tsx') || file.path.endsWith('.jsx')) {
        const lines = file.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          // Match <a href="#" or <a href="" without onclick
          if (/<a\s+[^>]*href=["'](?:#|)["'][^>]*>/i.test(line) && !/onclick=/i.test(line)) {
            findings.push({
              id: `aaf-ux-deadlink-${randomUUID().slice(0, 8)}`,
              dimension: 'UX',
              severity: 'LOW',
              title: `Lien mort ou non fonctionnel (href vide ou #)`,
              description: `Un lien hypertexte <a> pointe vers '#' ou une cible vide sans gestionnaire de clic explicite.`,
              location: { filePath: file.path, line: i + 1 },
              cause: `Lien placeholder oublié lors de la conception.`,
              impact: `Rechargement de page ou saut de scroll intempestif au clic de l'utilisateur.`,
              recommendation: `Définir une URL valide ou remplacer la balise <a> par un <button> s'il s'agit d'une action.`,
              autoRemediable: true,
              suggestedAction: {
                agentDomain: 'UI',
                actionType: 'REPLACE_DEAD_LINK',
                targetPath: file.path,
                description: `Remplacer <a href="#"> par un bouton ou une route valide.`
              },
              evidence: [
                {
                  source: 'AST_NODE',
                  detail: `Balise <a> avec href="#" détectée à la ligne ${i + 1}.`,
                  filePath: file.path
                }
              ]
            });
          }
        }
      }
    }

    return findings;
  }
}
