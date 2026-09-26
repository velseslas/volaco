/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-013)
 * Security Auditor - Vulnerability & Secret Leak Detection
 */

import { randomUUID } from 'node:crypto';
import { maskSecret } from '../../../security/secrets.js';
import type { ApplicationAuditFinding, AuditFileEntry } from '../types.js';

export class SecurityAuditor {
  public audit(files: readonly AuditFileEntry[]): readonly ApplicationAuditFinding[] {
    const findings: ApplicationAuditFinding[] = [];

    for (const file of files) {
      const lines = file.content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const lineNum = i + 1;

        // 1. Check for Hardcoded Secrets & API Keys
        this.checkHardcodedSecrets(file.path, line, lineNum, findings);

        // 2. Check for Dangerous JavaScript Execution (eval, new Function)
        this.checkDangerousExecution(file.path, line, lineNum, findings);

        // 3. Check for XSS Vectors (innerHTML, document.write)
        this.checkXssVectors(file.path, line, lineNum, findings);

        // 4. Check for Path Traversal in static path strings
        this.checkPathTraversal(file.path, line, lineNum, findings);
      }
    }

    return findings;
  }

  private checkHardcodedSecrets(
    filePath: string,
    line: string,
    lineNum: number,
    findings: ApplicationAuditFinding[]
  ): void {
    const secretPatterns = [
      { regex: /sk-[a-zA-Z0-9_-]{20,}/, name: 'Clé API secrète (pattern sk-***)' },
      { regex: /AIza[0-9A-Za-z-_]{35}/, name: 'Clé API Google / Gemini' },
      { regex: /ghp_[a-zA-Z0-9]{36}/, name: 'Token d\'accès GitHub' },
      { regex: /password\s*[:=]\s*['"][^'"]{6,}['"]/i, name: 'Mot de passe en clair codé en dur' },
      { regex: /Bearer\s+eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/i, name: 'Token JWT hardcodé' }
    ];

    for (const pattern of secretPatterns) {
      const match = line.match(pattern.regex);
      if (match) {
        const masked = maskSecret(match[0]);
        findings.push({
          id: `aaf-sec-secret-${randomUUID().slice(0, 8)}`,
          dimension: 'SECURITY',
          severity: 'CRITICAL',
          title: `Secret d'authentification exposé en clair (${pattern.name})`,
          description: `Un secret sensible ou une clé API d'accès a été détecté en clair dans le code source : '${masked}'.`,
          location: { filePath, line: lineNum },
          cause: `Clé d'authentification inscrite directement dans le code plutôt que dans les variables d'environnement.`,
          impact: `Risque d'exfiltration immédiate, compromission de compte et usurpation d'identité en production.`,
          recommendation: `Déplacer immédiatement ce secret dans les variables d'environnement (process.env) et révoquer la clé compromise.`,
          autoRemediable: true,
          suggestedAction: {
            agentDomain: 'SECURITY',
            actionType: 'EXTRACT_ENV_VARIABLE',
            targetPath: filePath,
            description: `Remplacer le secret codé en dur par une variable d'environnement.`
          },
          evidence: [
            {
              source: 'SECURITY_SCANNER',
              detail: `Secret détecté à la ligne ${lineNum}: ${masked}`,
              filePath
            }
          ]
        });
      }
    }
  }

  private checkDangerousExecution(
    filePath: string,
    line: string,
    lineNum: number,
    findings: ApplicationAuditFinding[]
  ): void {
    if (/\beval\s*\(/.test(line)) {
      findings.push({
        id: `aaf-sec-eval-${randomUUID().slice(0, 8)}`,
        dimension: 'SECURITY',
        severity: 'CRITICAL',
        title: `Utilisation interdite de 'eval()'`,
        description: `L'instruction eval() exécute du code dynamique arbitraire avec tous les privilèges du contexte.`,
        location: { filePath, line: lineNum },
        cause: `Évaluation dynamique de chaîne de caractères.`,
        impact: `Vecteur majeur d'injection de code distant (RCE) et contournement total des bacs à sable.`,
        recommendation: `Bannir eval() et utiliser des parseurs typés ou JSON.parse().`,
        autoRemediable: false,
        evidence: [
          {
            source: 'SECURITY_SCANNER',
            detail: `Appel eval() détecté à la ligne ${lineNum}.`,
            filePath
          }
        ]
      });
    }

    if (/\bnew\s+Function\s*\(/.test(line)) {
      findings.push({
        id: `aaf-sec-newfunc-${randomUUID().slice(0, 8)}`,
        dimension: 'SECURITY',
        severity: 'HIGH',
        title: `Construction dynamique via 'new Function()'`,
        description: `L'instanciation de 'new Function()' contourne la compilation statique et permet l'injection de code arbitraire.`,
        location: { filePath, line: lineNum },
        cause: `Instanciation de fonction à partir de code non typé.`,
        impact: `Possibilité d'exécution de payloads malveillants injectés dans les variables.`,
        recommendation: `Remplacer par des fonctions statiques déclarées.`,
        autoRemediable: false,
        evidence: [
          {
            source: 'SECURITY_SCANNER',
            detail: `'new Function()' détecté à la ligne ${lineNum}.`,
            filePath
          }
        ]
      });
    }
  }

  private checkXssVectors(
    filePath: string,
    line: string,
    lineNum: number,
    findings: ApplicationAuditFinding[]
  ): void {
    if (/\.innerHTML\s*=/.test(line) && !line.includes('escapeHtml') && !line.includes('DOMPurify')) {
      findings.push({
        id: `aaf-sec-xss-${randomUUID().slice(0, 8)}`,
        dimension: 'SECURITY',
        severity: 'HIGH',
        title: `Injection HTML non assainie (XSS) via .innerHTML`,
        description: `Assignation directe à .innerHTML sans fonction d'échappement visible.`,
        location: { filePath, line: lineNum },
        cause: `Injection directe de chaînes HTML non assainies dans le DOM.`,
        impact: `Risque d'exécution de scripts malveillants (Cross-Site Scripting) et vol de session.`,
        recommendation: `Utiliser textContent, innerText, ou assainir la chaîne avec DOMPurify avant injection.`,
        autoRemediable: true,
        suggestedAction: {
          agentDomain: 'SECURITY',
          actionType: 'SANITIZE_DOM_ASSIGNMENT',
          targetPath: filePath,
          description: `Remplacer innerHTML par textContent ou assainir avec un sanitizer.`
        },
        evidence: [
          {
            source: 'SECURITY_SCANNER',
            detail: `Assignation innerHTML détectée ligne ${lineNum}.`,
            filePath
          }
        ]
      });
    }

    if (/document\.write\s*\(/.test(line)) {
      findings.push({
        id: `aaf-sec-docwrite-${randomUUID().slice(0, 8)}`,
        dimension: 'SECURITY',
        severity: 'HIGH',
        title: `Utilisation d'API dépréciée et non sécurisée (document.write)`,
        description: `document.write() bloque le parseur HTML et présente des failles d'injection XSS sévères.`,
        location: { filePath, line: lineNum },
        cause: `Écriture synchrone directe dans le flux du document.`,
        impact: `Blocage du rendu et vulnérabilité XSS.`,
        recommendation: `Remplacer par des méthodes modernes de manipulation DOM (createElement / appendChild).`,
        autoRemediable: true,
        suggestedAction: {
          agentDomain: 'UI',
          actionType: 'REPLACE_DOCUMENT_WRITE',
          targetPath: filePath,
          description: `Remplacer document.write par manipulation de nœuds DOM modernes.`
        },
        evidence: [
          {
            source: 'SECURITY_SCANNER',
            detail: `document.write détecté ligne ${lineNum}.`,
            filePath
          }
        ]
      });
    }
  }

  private checkPathTraversal(
    filePath: string,
    line: string,
    lineNum: number,
    findings: ApplicationAuditFinding[]
  ): void {
    if (/\.\.\/\.\.\//.test(line) && (line.includes('fs.') || line.includes('readFile') || line.includes('open('))) {
      findings.push({
        id: `aaf-sec-traversal-${randomUUID().slice(0, 8)}`,
        dimension: 'SECURITY',
        severity: 'HIGH',
        title: `Risque de Path Traversal (..) détecté`,
        description: `Navigation relative vers le haut de l'arborescence (../../) dans une opération de système de fichiers.`,
        location: { filePath, line: lineNum },
        cause: `Résolution de chemin non canonisée pouvant sortir du répertoire racine autorisé.`,
        impact: `Accès non autorisé à des fichiers système ou des secrets hors du workspace.`,
        recommendation: `Canoniser et valider que le chemin résolu demeure strictement à l'intérieur du dossier racine.`,
        autoRemediable: false,
        evidence: [
          {
            source: 'SECURITY_SCANNER',
            detail: `Path traversal potentiel détecté à la ligne ${lineNum}.`,
            filePath
          }
        ]
      });
    }
  }
}
