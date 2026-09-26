/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-011)
 * Layout Engine & Interactive Element Profiler
 */

import { canonicalizeLength, compareInteractiveElements } from '../canonical.js';
import type {
  InteractiveElementProfile,
  LayoutBox,
  NormalizedDomNode,
  ViewportDimension
} from '../types.js';

export class LayoutEngine {
  public computeLayoutAndProfiles(
    rootNode: NormalizedDomNode,
    viewport: ViewportDimension
  ): {
    updatedRoot: NormalizedDomNode;
    interactiveElements: readonly InteractiveElementProfile[];
    totalElements: number;
  } {
    let totalElements = 0;
    const interactiveList: InteractiveElementProfile[] = [];

    const computeNodeLayout = (
      node: NormalizedDomNode,
      parentBox: LayoutBox,
      siblingIndex: number
    ): NormalizedDomNode => {
      totalElements++;

      // If runtime layout box already provided and non-default, preserve it
      let layout: LayoutBox = node.layout;
      const isDefaultBox = layout.x === 0 && layout.y === 0 && layout.width === 100 && layout.height === 40;
      if (node.depth === 0) {
        const styleAttr = node.attributes['style'] || '';
        const explicitW = styleAttr.match(/width:\s*(\d+)px/);
        const explicitH = styleAttr.match(/height:\s*(\d+)px/);
        layout = {
          x: 0,
          y: 0,
          width: explicitW && explicitW[1] ? parseInt(explicitW[1], 10) : viewport.width,
          height: explicitH && explicitH[1] ? parseInt(explicitH[1], 10) : viewport.height,
          isVisible: true,
          hasOverflow: false
        };
      } else if (isDefaultBox) {
        const isBlock = node.styles.display === 'block' || node.role === 'CONTAINER' || ['div', 'section', 'header', 'main', 'footer', 'nav', 'article'].includes(node.tagName);
        const styleAttr = node.attributes['style'] || '';
        const explicitW = styleAttr.match(/width:\s*(\d+)px/);
        const explicitH = styleAttr.match(/height:\s*(\d+)px/);

        const width = explicitW && explicitW[1]
          ? parseInt(explicitW[1], 10)
          : isBlock
          ? Math.max(10, parentBox.width - canonicalizeLength(node.styles.margin) * 2)
          : Math.min(parentBox.width, Math.max(20, (node.textContent.length || 5) * 10));

        const height = explicitH && explicitH[1]
          ? parseInt(explicitH[1], 10)
          : node.role === 'BUTTON' || node.role === 'INPUT'
          ? 40
          : node.role === 'HEADING'
          ? 32
          : Math.max(20, node.children.length * 25 || 24);

        const x = parentBox.x + canonicalizeLength(node.styles.margin);
        const y = parentBox.y + (siblingIndex * (height + 8));

        const isVisible = node.styles.opacity > 0 && node.styles.display !== 'none';
        const hasOverflow = y + height > viewport.height || x + width > viewport.width;

        layout = {
          x,
          y,
          width,
          height,
          isVisible,
          hasOverflow
        };
      }

      // Check if interactive
      if (this.isInteractiveElement(node)) {
        const label = this.extractAccessibleLabel(node);
        interactiveList.push({
          nodeId: node.id,
          role: node.role,
          selector: node.selector,
          label,
          bounds: layout,
          hasAccessibleName: label.trim().length > 0,
          isClickable: node.role === 'BUTTON' || node.role === 'LINK' || Boolean(node.attributes['onclick']),
          isFormInput: node.role === 'INPUT'
        });
      }

      // Recursively layout children
      const children = node.children.map((child, idx) =>
        computeNodeLayout(child, layout, idx)
      );

      return {
        ...node,
        layout,
        children
      };
    };

    const rootParentBox: LayoutBox = {
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height,
      isVisible: true,
      hasOverflow: false
    };

    const updatedRoot = computeNodeLayout(rootNode, rootParentBox, 0);
    interactiveList.sort(compareInteractiveElements);

    return {
      updatedRoot,
      interactiveElements: interactiveList,
      totalElements
    };
  }

  public isInteractiveElement(node: NormalizedDomNode): boolean {
    if (node.role === 'BUTTON' || node.role === 'INPUT' || node.role === 'LINK') {
      return true;
    }
    if (node.attributes['onclick'] || node.attributes['href'] || node.attributes['tabindex']) {
      return true;
    }
    const roleAttr = (node.attributes['role'] || '').toLowerCase();
    if (roleAttr === 'button' || roleAttr === 'link' || roleAttr === 'checkbox' || roleAttr === 'menuitem') {
      return true;
    }
    return false;
  }

  public extractAccessibleLabel(node: NormalizedDomNode): string {
    // 1. aria-label
    if (node.attributes['aria-label']) {
      return node.attributes['aria-label'].trim();
    }
    // 2. title attribute
    if (node.attributes['title']) {
      return node.attributes['title'].trim();
    }
    // 3. placeholder for input
    if (node.attributes['placeholder']) {
      return node.attributes['placeholder'].trim();
    }
    // 4. alt for image
    if (node.attributes['alt']) {
      return node.attributes['alt'].trim();
    }
    // 5. text content
    if (node.textContent) {
      return node.textContent.trim().slice(0, 100);
    }
    return '';
  }
}
