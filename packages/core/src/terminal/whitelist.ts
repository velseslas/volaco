/**
 * VibeCode Studio - Command Whitelist & Security Rules (CORE-005)
 *
 * Sécurité du terminal : le principe est qu'aucune commande dépassant une liste
 * fermée de binaires + sous-commandes ne peut passer. La validation a lieu AVANT
 * toute exécution, et le service n'utilise jamais de shell (`execFileSync`), ce
 * qui neutralise les caractères d'injection même s'ils passaient le filtre.
 */

import { ValidationError } from '../errors.js';
import type { AllowedBinary } from './types.js';

export const ALLOWED_BINARIES: readonly AllowedBinary[] = ['pnpm', 'npm', 'node', 'git'] as const;

export const DANGEROUS_PATTERNS = [
  ';',
  '&&',
  '||',
  '|',
  '>',
  '<',
  '`',
  '$(',
  '${',
  '\n',
  '\r',
  '\0'
];

/**
 * Liste explicite des sous-commandes autorisées pour chaque binaire.
 * Toute sous-commande hors de cette liste est rejetée.
 *
 * ⚠️ CE QUI N'EST PAS DANS CETTE LISTE ET POURQUOI :
 *
 * - `npm run` / `pnpm run` : exécutent un script défini dans le `package.json`
 *   du projet. Un `package.json` malicieux (projet de test, repo cloné depuis
 *   GitHub, output d'une génération IA) peut définir `scripts.evil = "rm -rf /"`
 *   et l'exécuter via `npm run evil`. C'est une RCE (Remote Code Execution)
 *   potentielle même en environnement de développement local.
 *
 * - SEC-03 — `npm test` / `npm build` / `npm lint` (et `pnpm …`) : ce sont des
 *   ALIAS de `npm run` (`npm test` ≡ `npm run test` + hooks pre/post). Le
 *   blocage de `run` était donc contournable par une seule sous-commande
 *   autorisée. Retirés de la liste autorisée (ne restent que `--version`).
 *
 * - `npm install` / `pnpm install` / `npm i` : déclenchent les hooks
 *   `preinstall` / `postinstall` des paquets installés. Un paquet npm tiers
 *   peut exécuter du code arbitraire à l'installation sans que tu n'en voies
 *   rien dans la sortie du terminal.
 *
 * - `npm exec` / `pnpm exec` / `pnpm dlx` / `npx` : exécutent un binaire
 *   arbitraire depuis le registre npm. Équivalent à `bash <paquet>`.
 *
 * - `node -e` / `node --eval` / `node -p` / `node --print` : exécutent du
 *   code JavaScript arbitraire passé en argument. Le `node -e` était déjà
 *   bloqué explicitement dans le service ; les autres variantes sont désormais
 *   bloquées à la source (au niveau de la whitelist).
 *
 * - `node -r` / `node --require` : chargent un module arbitraire au démarrage
 *   de Node — équivalent à exécuter le code de ce module.
 *
 * - `node -i` / `node --interactive` : ouvrent un REPL interactif qui
 *   n'a aucun sens dans un terminal web et contourne toute la sécurité.
 */
export const ALLOWED_SUBCOMMANDS: Readonly<Record<AllowedBinary, readonly string[]>> = {
  pnpm: ['--version', '-v'],
  npm:  ['--version', '-v'],
  node: ['--version', '-v'],
  git:  ['status', 'log', 'diff', 'branch', 'show', '--version']
};

/**
 * Sous-commandes explicitement dangereuses, listées séparément pour produire
 * un message d'erreur clair et spécifique (plutôt que le générique "non autorisé").
 * Ceinture + bretelles : même si une de ces sous-commandes apparaissait dans
 * ALLOWED_SUBCOMMANDS par erreur, elle serait quand même rejetée ici.
 */
export const DANGEROUS_SUBCOMMANDS: Readonly<Record<AllowedBinary, readonly string[]>> = {
  pnpm: ['run', 'exec', 'dlx', 'install', 'i', 'add', 'remove', 'uninstall', 'rm', 'test', 'build', 'lint'],
  npm:  ['run', 'exec', 'install', 'i', 'add', 'uninstall', 'rm', 'test', 'build', 'lint'],
  node: ['-e', '--eval', '-p', '--print', '-r', '--require', '-i', '--interactive', '--experimental-network-imports'],
  git:  []
};

export interface ParsedCommand {
  binary: AllowedBinary;
  subcommand?: string | undefined;
  args: string[];
}

export function validateAndParseCommand(rawCommand: string): ParsedCommand {
  if (!rawCommand || typeof rawCommand !== 'string') {
    throw new ValidationError('La commande est obligatoire et doit être une chaîne non vide');
  }

  const trimmed = rawCommand.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('La commande ne peut pas être vide');
  }

  // 1. Détection des caractères d'injection shell dangereux
  for (const pattern of DANGEROUS_PATTERNS) {
    if (trimmed.includes(pattern)) {
      throw new ValidationError(
        `Caractère ou opérateur d'injection interdit détecté : "${pattern}"`
      );
    }
  }

  // 2. Découpage en tokens
  const tokens = trimmed.split(/\s+/).filter(t => t.length > 0);
  const binaryToken = tokens[0];

  if (!binaryToken) {
    throw new ValidationError('Aucun binaire spécifié');
  }

  // 3. Vérification de la présence dans la whitelist
  if (!ALLOWED_BINARIES.includes(binaryToken as AllowedBinary)) {
    throw new ValidationError(
      `Binaire "${binaryToken}" non autorisé. Binaires autorisés : ${ALLOWED_BINARIES.join(', ')}`
    );
  }

  const binary = binaryToken as AllowedBinary;
  const args = tokens.slice(1);
  const subcommand = args[0];

  // 4. Vérification préalable : sous-commande explicitement dangereuse
  //    (message d'erreur clair et spécifique plutôt que "non autorisé").
  const dangerous = DANGEROUS_SUBCOMMANDS[binary];
  if (subcommand && dangerous.includes(subcommand)) {
    throw new ValidationError(
      `Sous-commande "${binary} ${subcommand}" bloquée pour des raisons de sécurité : ` +
      `elle permettrait d'exécuter du code arbitraire défini dans le projet (RCE). ` +
      `Utilise une sous-commande autorisée : ${ALLOWED_SUBCOMMANDS[binary].join(', ')}`
    );
  }

  // 5. Vérification de la sous-commande contre la liste autorisée pour ce binaire
  const allowed = ALLOWED_SUBCOMMANDS[binary];
  if (!subcommand || !allowed.includes(subcommand)) {
    throw new ValidationError(
      `Sous-commande ${binary} "${subcommand ?? ''}" non autorisée. Commandes autorisées : ${allowed.join(', ')}`
    );
  }

  return {
    binary,
    subcommand,
    args
  };
}
