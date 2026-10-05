/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-011)
 * DOM Normalizer & Semantic Element Classifier
 */

import type {
  ComputedStyleSnapshot,
  LayoutBox,
  NormalizedDomNode,
  SemanticRole
} from '../types.js';

export const DEFAULT_COMPUTED_STYLE: ComputedStyleSnapshot = {
  color: '#0f172a',
  backgroundColor: 'transparent',
  fontFamily: 'sans-serif',
  fontSize: '16px',
  fontWeight: '400',
  lineHeight: '24px',
  padding: '0px',
  margin: '0px',
  borderRadius: '0px',
  borderWidth: '0px',
  borderColor: 'transparent',
  boxShadow: 'none',
  display: 'block',
  flexDirection: 'row',
  justifyContent: 'flex-start',
  alignItems: 'stretch',
  gap: '0px',
  opacity: 1,
  zIndex: 0
};

export const DEFAULT_LAYOUT_BOX: LayoutBox = {
  x: 0,
  y: 0,
  width: 100,
  height: 40,
  isVisible: true,
  hasOverflow: false
};

export class DomNormalizer {
  constructor(private readonly maxDepth = 32) {}

  public normalizeFromHtml(html: string): NormalizedDomNode {
    let nodeCounter = 0;

    const parseTag = (
      rawHtml: string,
      parentSelector = '',
      depth = 0
    ): NormalizedDomNode => {
      // Extract opening tag
      const tagMatch = rawHtml.match(/^<([a-zA-Z0-9-]+)([^>]*)>/);
      const rawAttrs = tagMatch ? (tagMatch[2] || '') : '';
      const attributes = this.parseAttributes(rawAttrs);
      const id = attributes['id'] || `node-${nodeCounter++}`;

      if (depth > this.maxDepth) {
        return {
          id,
          tagName: 'div',
          role: 'CONTAINER',
          attributes,
          classes: [],
          textContent: '',
          styles: { ...DEFAULT_COMPUTED_STYLE },
          layout: { ...DEFAULT_LAYOUT_BOX },
          children: [],
          depth,
          selector: `${parentSelector} > div`
        };
      }

      if (!tagMatch) {
        // Plain text node or fallback container
        const text = rawHtml.replace(/<[^>]*>/g, '').trim();
        return {
          id,
          tagName: 'span',
          role: 'PARAGRAPH',
          attributes: {},
          classes: [],
          textContent: text,
          styles: { ...DEFAULT_COMPUTED_STYLE },
          layout: { ...DEFAULT_LAYOUT_BOX },
          children: [],
          depth,
          selector: `${parentSelector} > text`
        };
      }

      const tagName = tagMatch[1]!.toLowerCase();
      const classes = attributes['class'] ? attributes['class'].split(/\s+/).filter(Boolean) : [];

      let selector = tagName;
      if (attributes['id']) {
        selector += `#${attributes['id']}`;
      } else if (classes.length > 0) {
        selector += `.${classes[0]}`;
      }
      const fullSelector = parentSelector ? `${parentSelector} > ${selector}` : selector;

      const role = this.detectSemanticRole(tagName, attributes, classes);

      // Extract inner HTML between opening and corresponding closing tag
      const openTagLen = tagMatch[0].length;
      let innerContent = '';

      // Check self-closing or void elements
      const isVoid = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'].includes(tagName);
      if (!isVoid) {
        const closingTag = `</${tagName}>`;
        const lastIndex = rawHtml.lastIndexOf(closingTag);
        if (lastIndex > openTagLen) {
          innerContent = rawHtml.slice(openTagLen, lastIndex);
        } else {
          innerContent = rawHtml.slice(openTagLen);
        }
      }

      const textContent = innerContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

      // Parse immediate child tags
      const children: NormalizedDomNode[] = [];
      if (innerContent.length > 0 && depth < this.maxDepth) {
        const childTagRegex = /<([a-zA-Z0-9-]+)(?:[^>]*)(?:\/>|>[\s\S]*?<\/\1>)/gi;
        let matches = Array.from(innerContent.matchAll(childTagRegex));

        if (matches.length === 0 && innerContent.includes('<')) {
          const fallbackRegex = /<([a-zA-Z0-9-]+)(?:[^>]*)>[\s\S]*?(?=<[a-zA-Z0-9-]+|$)/gi;
          matches = Array.from(innerContent.matchAll(fallbackRegex));
        }

        if (matches.length > 0) {
          for (const m of matches.slice(0, 50)) { // limit to max 50 children per node
            const childNode = parseTag(m[0], fullSelector, depth + 1);
            children.push(childNode);
          }
        }
      }

      return {
        id,
        tagName,
        role,
        attributes,
        classes,
        textContent,
        styles: { ...DEFAULT_COMPUTED_STYLE },
        layout: { ...DEFAULT_LAYOUT_BOX },
        children,
        depth,
        selector: fullSelector
      };
    };

    const trimmed = (html || '').trim();
    // É44 P2C — ignorer les préfixes non-élément (doctype, commentaires,
    // espaces) avant le premier tag : sans cela, `<!DOCTYPE html>` ne matchait
    // pas l'ancre `^<[a-zA-Z0-9-]` de parseTag et tout le document dégénérait
    // en un seul nœud « texte pur » (span/PARAGRAPH). Rien d'autre n'est
    // retiré : pas de suppression arbitraire de contenu HTML.
    const content = trimmed.replace(/^(?:\s+|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->)+/i, '');
    if (!content) {
      return {
        id: 'node-empty',
        tagName: 'div',
        role: 'CONTAINER',
        attributes: {},
        classes: [],
        textContent: '',
        styles: { ...DEFAULT_COMPUTED_STYLE },
        layout: { ...DEFAULT_LAYOUT_BOX },
        children: [],
        depth: 0,
        selector: 'div'
      };
    }

    return parseTag(content);
  }

  public normalizeFromRuntimeProbe(payload: unknown): NormalizedDomNode {
    if (!payload || typeof payload !== 'object') {
      return this.normalizeFromHtml('');
    }

    const raw = payload as Record<string, unknown>;
    return {
      id: String(raw['id'] || 'probe-root'),
      tagName: String(raw['tagName'] || 'body').toLowerCase(),
      role: (raw['role'] as SemanticRole) || 'CONTAINER',
      attributes: (raw['attributes'] as Record<string, string>) || {},
      classes: Array.isArray(raw['classes']) ? raw['classes'].map(String) : [],
      textContent: String(raw['textContent'] || ''),
      styles: {
        ...DEFAULT_COMPUTED_STYLE,
        ...(typeof raw['styles'] === 'object' && raw['styles'] !== null ? raw['styles'] : {})
      },
      layout: {
        ...DEFAULT_LAYOUT_BOX,
        ...(typeof raw['layout'] === 'object' && raw['layout'] !== null ? raw['layout'] : {})
      },
      children: Array.isArray(raw['children'])
        ? raw['children'].map((c) => this.normalizeFromRuntimeProbe(c))
        : [],
      depth: typeof raw['depth'] === 'number' ? raw['depth'] : 0,
      selector: String(raw['selector'] || 'body')
    };
  }

  public detectSemanticRole(
    tagName: string,
    attributes: Record<string, string>,
    classes: readonly string[]
  ): SemanticRole {
    const classStr = classes.join(' ').toLowerCase();
    const explicitRole = (attributes['role'] || '').toUpperCase();

    if (explicitRole === 'BUTTON' || tagName === 'button' || classStr.includes('btn') || classStr.includes('button')) {
      return 'BUTTON';
    }
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
      return 'INPUT';
    }
    if (tagName === 'a' && (attributes['href'] !== undefined || explicitRole === 'LINK')) {
      return 'LINK';
    }
    if (/^h[1-6]$/.test(tagName) || explicitRole === 'HEADING') {
      return 'HEADING';
    }
    if (tagName === 'p' || tagName === 'span') {
      return 'PARAGRAPH';
    }
    if (tagName === 'img' || tagName === 'svg' || explicitRole === 'IMG') {
      return 'IMAGE';
    }
    if (tagName === 'nav' || tagName === 'header' || explicitRole === 'NAVIGATION') {
      return 'NAVIGATION';
    }
    if (tagName === 'form') {
      return 'FORM';
    }
    if (tagName === 'dialog' || explicitRole === 'DIALOG' || classStr.includes('modal')) {
      return 'MODAL';
    }
    if (tagName === 'article' || classStr.includes('card')) {
      return 'CARD';
    }
    return 'CONTAINER';
  }

  private parseAttributes(rawAttrs: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const attrRegex = /([a-zA-Z0-9-_:]+)(?:=(?:"([^"]*)"|'([^']*)'|([^>\s]+)))?/g;
    for (const m of rawAttrs.matchAll(attrRegex)) {
      const name = m[1]!.toLowerCase();
      const val = m[2] ?? m[3] ?? m[4] ?? '';
      attrs[name] = val;
    }
    return attrs;
  }
}
