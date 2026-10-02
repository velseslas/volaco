/**
 * VibeCode Core - Extraction des sections d'un index.html serveur (E40)
 *
 * Le serveur assemble les générations en blocs
 * `<div class="vibe-stitched" data-section="nom">…</div>` (mêmes conventions
 * que conversation.ts). E40 restaure un état depuis l'historique : ce module
 * ré-extrait les sections d'un HTML restauré pour que le Builder puisse
 * reconstruire son canvas (un composant par section, metadata.html = intérieur).
 *
 * Le découpage de bloc réutilise EXACTEMENT la convention serveur (bloc
 * paresseux terminé au prochain data-section, à </body> ou en fin de
 * document) : ce qui est extrait ici est ce que le serveur aurait remplacé.
 */

export interface ServerSection {
  readonly name: string;
  /** Intérieur du wrapper (sans le div data-section), trimé. */
  readonly html: string;
}

export function extractSections(html: string, maxSections = 40): ServerSection[] {
  const out: ServerSection[] = [];
  const re = /<div[^>]*data-section="([^"]{1,40})"[^>]*>([\s\S]*?)(?=<div[^>]*data-section|<\/body>|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null && out.length < maxSections) {
    const name = match[1] ?? '';
    const block = match[2] ?? '';
    // Le bloc paresseux s'arrête AVANT la section suivante / </body> : sa fin
    // est le `</div>` FERMANT du wrapper (le dernier du bloc), suivi d'espaces.
    const closeIdx = block.lastIndexOf('</div>');
    if (name.length === 0 || closeIdx < 0) continue;
    const inner = block.slice(0, closeIdx).trim();
    if (inner.length === 0) continue;
    out.push({ name, html: inner });
  }
  return out;
}
