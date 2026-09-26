import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import {
  CodeIntelligenceService,
  ApplicationDNAService,
  SemanticCodeGraphService,
  ImpactIntelligenceService,
  runImpactAnalysis,
  compareImpactNodes,
  compareImpactPaths,
  type IReadOnlyFileSource,
  ValidationError,
  ForbiddenError,
  type SemanticCodeGraph,
  type SemanticNode,
  type SemanticEdge,
  type ImpactedNode,
  type ImpactPath
} from '../../../src/index.js';

function computeSha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

class MockFileSource implements IReadOnlyFileSource {
  private files = new Map<string, Record<string, string>>();

  public setFiles(tenantId: string, projectId: string, fileMap: Record<string, string>): void {
    this.files.set(`${tenantId}:${projectId}`, fileMap);
  }

  public getFile(tenantId: string, projectId: string, filePath: string) {
    const pFiles = this.files.get(`${tenantId}:${projectId}`) || {};
    const content = pFiles[filePath];
    if (content === undefined) return null;
    return {
      path: filePath,
      name: filePath.split('/').pop() ?? filePath,
      content,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      hash: computeSha256(content),
      updatedAt: new Date()
    };
  }

  public getAllProjectFiles(tenantId: string, projectId: string): Record<string, string> {
    return this.files.get(`${tenantId}:${projectId}`) || {};
  }

  public computeTreeHash(tenantId: string, projectId: string): string {
    const pFiles = this.files.get(`${tenantId}:${projectId}`) || {};
    const entries = Object.entries(pFiles)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([filePath, content]) => `${filePath}:${computeSha256(content)}`);
    return computeSha256(entries.join('\n'));
  }
}

function buildSyntheticGraph(nodes: SemanticNode[], edges: SemanticEdge[]): SemanticCodeGraph {
  const outgoing: Record<string, string[]> = {};
  const incoming: Record<string, string[]> = {};
  const nodeById: Record<string, string> = {};
  const nodesByKind: Record<string, string[]> = {};
  const nodesByFile: Record<string, string[]> = {};

  for (const n of nodes) {
    nodeById[n.id] = n.id;
    outgoing[n.id] = [];
    incoming[n.id] = [];
    nodesByKind[n.kind] = nodesByKind[n.kind] || [];
    nodesByKind[n.kind]!.push(n.id);
    if (n.filePath) {
      nodesByFile[n.filePath] = nodesByFile[n.filePath] || [];
      nodesByFile[n.filePath]!.push(n.id);
    }
  }

  for (const e of edges) {
    if (outgoing[e.sourceId]) outgoing[e.sourceId]!.push(e.id);
    if (incoming[e.targetId]) incoming[e.targetId]!.push(e.id);
  }

  return {
    schemaVersion: '1.0.0',
    assemblerVersion: '1.0.0',
    tenantId: 'tenant-test',
    projectId: 'project-test',
    treeHash: 'tree-hash-1',
    graphHash: 'graph-hash-1',
    createdAt: new Date().toISOString(),
    durationMs: 5,
    nodes,
    edges,
    indexes: {
      nodeById,
      nodesByKind: nodesByKind as any,
      nodesByFile,
      outgoingEdgesByNode: outgoing,
      incomingEdgesByNode: incoming
    },
    metrics: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodesByKind: {},
      edgesByKind: {},
      isolatedNodeCount: 0,
      maxOutDegree: 0,
      maxInDegree: 0,
      fileNodeCount: 0,
      symbolNodeCount: 0,
      moduleNodeCount: 0,
      layerNodeCount: 0,
      routeNodeCount: 0,
      componentNodeCount: 0,
      importEdgeCount: 0,
      referenceEdgeCount: 0,
      compositionEdgeCount: 0,
      moduleMembershipCount: 0,
      layerMembershipCount: 0
    }
  };
}

describe('AINT-005 : Impact Intelligence Engine Unit & Integration Tests', () => {

  // =========================================================================
  // BLOC A — TARGET RESOLUTION (6 tests)
  // =========================================================================
  describe('A. Target Resolution', () => {
    const nodeA: SemanticNode = {
      id: 'node:file:src/utils/math.ts',
      kind: 'FILE',
      name: 'math.ts',
      filePath: 'src/utils/math.ts',
      metadata: {},
      evidence: [{ kind: 'AST_SYMBOL', source: 'test', detail: 'file' }]
    };
    const nodeB: SemanticNode = {
      id: 'node:func:add',
      kind: 'FUNCTION',
      name: 'add',
      filePath: 'src/utils/math.ts',
      metadata: {},
      evidence: [{ kind: 'AST_SYMBOL', source: 'test', detail: 'func' }]
    };
    const graph = buildSyntheticGraph([nodeA, nodeB], []);

    it('A.1 doit résoudre une cible par targetNodeIds', () => {
      const res = runImpactAnalysis(graph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['node:func:add']
      });
      assert.strictEqual(res.resolvedTargets.length, 1);
      assert.strictEqual(res.resolvedTargets[0]!.targetNode.id, 'node:func:add');
      assert.strictEqual(res.resolvedTargets[0]!.matchedBy, 'NODE_ID');
    });

    it('A.2 doit résoudre une cible par targetFiles (inclut le fichier et ses symboles)', () => {
      const res = runImpactAnalysis(graph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetFiles: ['src/utils/math.ts']
      });
      assert.strictEqual(res.resolvedTargets.length, 2);
      assert.strictEqual(res.resolvedTargets.some((t) => t.matchedBy === 'FILE_PATH'), true);
    });

    it('A.3 doit résoudre une cible par targetSymbols', () => {
      const res = runImpactAnalysis(graph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetSymbols: ['add']
      });
      assert.strictEqual(res.resolvedTargets.length, 1);
      assert.strictEqual(res.resolvedTargets[0]!.targetNode.name, 'add');
      assert.strictEqual(res.resolvedTargets[0]!.matchedBy, 'SYMBOL_NAME');
    });

    it('A.4 doit supporter plusieurs cibles combinées', () => {
      const res = runImpactAnalysis(graph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['node:file:src/utils/math.ts'],
        targetSymbols: ['add']
      });
      assert.strictEqual(res.resolvedTargets.length, 2);
    });

    it('A.5 doit lever ValidationError si aucune cible n\'est spécifiée', () => {
      assert.throws(
        () => {
          runImpactAnalysis(graph, {
            tenantId: 'tenant-test',
            projectId: 'project-test'
          });
        },
        ValidationError
      );
    });

    it('A.6 doit lever ValidationError si la cible est introuvable', () => {
      assert.throws(
        () => {
          runImpactAnalysis(graph, {
            tenantId: 'tenant-test',
            projectId: 'project-test',
            targetNodeIds: ['non-existent-node']
          });
        },
        ValidationError
      );
    });
  });

  // =========================================================================
  // BLOC B — DIRECT DEPENDENT IMPACT (4 tests)
  // =========================================================================
  describe('B. Direct Dependent Impact', () => {
    const nodeTarget: SemanticNode = {
      id: 'node:func:formatDate',
      kind: 'FUNCTION',
      name: 'formatDate',
      filePath: 'src/utils/date.ts',
      metadata: {},
      evidence: [{ kind: 'AST_SYMBOL', source: 'test', detail: 'decl' }]
    };
    const nodeConsumer: SemanticNode = {
      id: 'node:comp:UserProfile',
      kind: 'COMPONENT',
      name: 'UserProfile',
      filePath: 'src/components/UserProfile.tsx',
      metadata: {},
      evidence: [{ kind: 'AST_SYMBOL', source: 'test', detail: 'decl' }]
    };
    const edge: SemanticEdge = {
      id: 'edge:1',
      kind: 'REFERENCES',
      sourceId: 'node:comp:UserProfile',
      targetId: 'node:func:formatDate',
      evidence: [{ kind: 'SYMBOL_REFERENCE', source: 'test', detail: 'calls formatDate' }],
      metadata: {}
    };
    const graph = buildSyntheticGraph([nodeTarget, nodeConsumer], [edge]);

    it('B.1 doit détecter l\'impact direct sur un consommateur amont (UPSTREAM_DEPENDENTS)', () => {
      const res = runImpactAnalysis(graph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['node:func:formatDate'],
        direction: 'UPSTREAM_DEPENDENTS'
      });

      assert.strictEqual(res.impactedNodes.length, 1);
      assert.strictEqual(res.impactedNodes[0]!.node.id, 'node:comp:UserProfile');
      assert.strictEqual(res.impactedNodes[0]!.depth, 1);
      assert.strictEqual(res.impactedNodes[0]!.isDirect, true);
      assert.strictEqual(res.impactedNodes[0]!.classification, 'BEHAVIORAL');
    });

    it('B.2 doit tracer le plus court chemin (shortestPath) avec détails de l\'arête', () => {
      const res = runImpactAnalysis(graph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['node:func:formatDate']
      });

      const impacted = res.impactedNodes[0]!;
      assert.strictEqual(impacted.shortestPath.length, 1);
      assert.strictEqual(impacted.shortestPath.steps[0]!.fromNodeId, 'node:func:formatDate');
      assert.strictEqual(impacted.shortestPath.steps[0]!.toNodeId, 'node:comp:UserProfile');
      assert.strictEqual(impacted.shortestPath.steps[0]!.edgeKind, 'REFERENCES');
    });

    it('B.3 doit classifier un impact de ROUTE comme direct et prioritaire', () => {
      const nodeRoute: SemanticNode = {
        id: 'node:route:/profile',
        kind: 'ROUTE',
        name: '/profile',
        filePath: 'src/routes.tsx',
        metadata: {},
        evidence: [{ kind: 'ROUTE_DECLARATION', source: 'test', detail: 'route' }]
      };
      const routeEdge: SemanticEdge = {
        id: 'edge:route:1',
        kind: 'ROUTES_TO',
        sourceId: 'node:route:/profile',
        targetId: 'node:comp:UserProfile',
        evidence: [{ kind: 'ROUTE_DECLARATION', source: 'test', detail: 'routes to component' }],
        metadata: {}
      };
      const routeGraph = buildSyntheticGraph([nodeTarget, nodeConsumer, nodeRoute], [edge, routeEdge]);

      const res = runImpactAnalysis(routeGraph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['node:comp:UserProfile']
      });

      const routeImpact = res.impactedNodes.find((n) => n.node.kind === 'ROUTE');
      assert.ok(routeImpact);
      assert.strictEqual(routeImpact.classification, 'BREAKING');
      assert.strictEqual(routeImpact.riskLevel, 'CRITICAL');
    });

    it('B.4 doit propager via les liens de composition de composants (COMPOSES)', () => {
      const childComp: SemanticNode = {
        id: 'node:comp:Button',
        kind: 'COMPONENT',
        name: 'Button',
        metadata: {},
        evidence: [{ kind: 'AST_SYMBOL', source: 'test', detail: 'Button' }]
      };
      const parentComp: SemanticNode = {
        id: 'node:comp:Form',
        kind: 'COMPONENT',
        name: 'Form',
        metadata: {},
        evidence: [{ kind: 'AST_SYMBOL', source: 'test', detail: 'Form' }]
      };
      const composesEdge: SemanticEdge = {
        id: 'e:composes',
        kind: 'COMPOSES',
        sourceId: 'node:comp:Form',
        targetId: 'node:comp:Button',
        evidence: [{ kind: 'COMPONENT_PROPS', source: 'test', detail: 'Form renders Button' }],
        metadata: {}
      };

      const compGraph = buildSyntheticGraph([childComp, parentComp], [composesEdge]);
      const res = runImpactAnalysis(compGraph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['node:comp:Button']
      });

      assert.strictEqual(res.impactedNodes.length, 1);
      assert.strictEqual(res.impactedNodes[0]!.node.id, 'node:comp:Form');
      assert.strictEqual(res.impactedNodes[0]!.shortestPath.steps[0]!.edgeKind, 'COMPOSES');
    });
  });

  // =========================================================================
  // BLOC C — TRANSITIVE IMPACT PROPAGATION (3 tests)
  // =========================================================================
  describe('C. Transitive Impact Propagation', () => {
    // Chain: D -> C -> B -> A (A depends on B, B depends on C, C depends on D)
    const nodeD: SemanticNode = {
      id: 'node:D',
      kind: 'FUNCTION',
      name: 'funcD',
      metadata: {},
      evidence: [{ kind: 'AST_SYMBOL', source: 'test', detail: 'D' }]
    };
    const nodeC: SemanticNode = {
      id: 'node:C',
      kind: 'FUNCTION',
      name: 'funcC',
      metadata: {},
      evidence: [{ kind: 'AST_SYMBOL', source: 'test', detail: 'C' }]
    };
    const nodeB: SemanticNode = {
      id: 'node:B',
      kind: 'FUNCTION',
      name: 'funcB',
      metadata: {},
      evidence: [{ kind: 'AST_SYMBOL', source: 'test', detail: 'B' }]
    };
    const nodeA: SemanticNode = {
      id: 'node:A',
      kind: 'COMPONENT',
      name: 'compA',
      metadata: {},
      evidence: [{ kind: 'AST_SYMBOL', source: 'test', detail: 'A' }]
    };

    const edgeCD: SemanticEdge = {
      id: 'edge:CD',
      kind: 'REFERENCES',
      sourceId: 'node:C',
      targetId: 'node:D',
      evidence: [{ kind: 'SYMBOL_REFERENCE', source: 'test', detail: 'C uses D' }],
      metadata: {}
    };
    const edgeBC: SemanticEdge = {
      id: 'edge:BC',
      kind: 'REFERENCES',
      sourceId: 'node:B',
      targetId: 'node:C',
      evidence: [{ kind: 'SYMBOL_REFERENCE', source: 'test', detail: 'B uses C' }],
      metadata: {}
    };
    const edgeAB: SemanticEdge = {
      id: 'edge:AB',
      kind: 'REFERENCES',
      sourceId: 'node:A',
      targetId: 'node:B',
      evidence: [{ kind: 'SYMBOL_REFERENCE', source: 'test', detail: 'A uses B' }],
      metadata: {}
    };

    const graph = buildSyntheticGraph([nodeD, nodeC, nodeB, nodeA], [edgeCD, edgeBC, edgeAB]);

    it('C.1 doit propager l\'impact sur plusieurs sauts (D -> C=1, B=2, A=3)', () => {
      const res = runImpactAnalysis(graph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['node:D']
      });

      assert.strictEqual(res.impactedNodes.length, 3);
      const impactC = res.impactedNodes.find((n) => n.node.id === 'node:C')!;
      const impactB = res.impactedNodes.find((n) => n.node.id === 'node:B')!;
      const impactA = res.impactedNodes.find((n) => n.node.id === 'node:A')!;

      assert.strictEqual(impactC.depth, 1);
      assert.strictEqual(impactC.isDirect, true);

      assert.strictEqual(impactB.depth, 2);
      assert.strictEqual(impactB.isDirect, false);
      assert.strictEqual(impactB.classification, 'REGRESSION_RISK');

      assert.strictEqual(impactA.depth, 3);
      assert.strictEqual(impactA.isDirect, false);
      assert.strictEqual(impactA.shortestPath.length, 3);
    });

    it('C.2 doit calculer les métriques transitives correctement', () => {
      const res = runImpactAnalysis(graph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['node:D']
      });

      assert.strictEqual(res.metrics.totalImpactedNodes, 3);
      assert.strictEqual(res.metrics.directImpactCount, 1);
      assert.strictEqual(res.metrics.transitiveImpactCount, 2);
      assert.strictEqual(res.metrics.maxDepthReached, 3);
    });

    it('C.3 doit atteindre avec précision une profondeur de 4 dans une chaîne longue', () => {
      const nodeE: SemanticNode = {
        id: 'node:E',
        kind: 'COMPONENT',
        name: 'AppRoot',
        metadata: {},
        evidence: [{ kind: 'AST_SYMBOL', source: 'test', detail: 'AppRoot' }]
      };
      const edgeAE: SemanticEdge = {
        id: 'edge:AE',
        kind: 'COMPOSES',
        sourceId: 'node:E',
        targetId: 'node:A',
        evidence: [{ kind: 'COMPONENT_PROPS', source: 'test', detail: 'App renders A' }],
        metadata: {}
      };
      const deepGraph = buildSyntheticGraph([nodeD, nodeC, nodeB, nodeA, nodeE], [edgeCD, edgeBC, edgeAB, edgeAE]);

      const res = runImpactAnalysis(deepGraph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['node:D'],
        maxDepth: 5
      });

      assert.strictEqual(res.metrics.maxDepthReached, 4);
      const impactE = res.impactedNodes.find((n) => n.node.id === 'node:E');
      assert.ok(impactE);
      assert.strictEqual(impactE.depth, 4);
    });
  });

  // =========================================================================
  // BLOC D — DOWNSTREAM DEPENDENCIES DIRECTION (2 tests)
  // =========================================================================
  describe('D. Downstream Dependencies Direction', () => {
    const nodeA: SemanticNode = {
      id: 'node:A',
      kind: 'COMPONENT',
      name: 'compA',
      metadata: {},
      evidence: [{ kind: 'AST_SYMBOL', source: 'test', detail: 'A' }]
    };
    const nodeB: SemanticNode = {
      id: 'node:B',
      kind: 'FUNCTION',
      name: 'funcB',
      metadata: {},
      evidence: [{ kind: 'AST_SYMBOL', source: 'test', detail: 'B' }]
    };
    const edgeAB: SemanticEdge = {
      id: 'edge:AB',
      kind: 'IMPORTS',
      sourceId: 'node:A',
      targetId: 'node:B',
      evidence: [{ kind: 'AST_IMPORT', source: 'test', detail: 'A imports B' }],
      metadata: {}
    };

    const graph = buildSyntheticGraph([nodeA, nodeB], [edgeAB]);

    it('D.1 direction DOWNSTREAM_DEPENDENCIES doit analyser ce dont la cible dépend', () => {
      const res = runImpactAnalysis(graph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['node:A'],
        direction: 'DOWNSTREAM_DEPENDENCIES'
      });

      assert.strictEqual(res.impactedNodes.length, 1);
      assert.strictEqual(res.impactedNodes[0]!.node.id, 'node:B');
    });

    it('D.2 direction DOWNSTREAM_DEPENDENCIES ne doit pas remonter vers les consommateurs amont', () => {
      const res = runImpactAnalysis(graph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['node:B'],
        direction: 'DOWNSTREAM_DEPENDENCIES'
      });

      assert.strictEqual(res.impactedNodes.length, 0);
    });
  });

  // =========================================================================
  // BLOC E — BIDIRECTIONAL IMPACT (1 test)
  // =========================================================================
  describe('E. Bidirectional Impact', () => {
    const nodeA: SemanticNode = {
      id: 'node:A',
      kind: 'COMPONENT',
      name: 'compA',
      metadata: {},
      evidence: [{ kind: 'AST_SYMBOL', source: 'test', detail: 'A' }]
    };
    const nodeB: SemanticNode = {
      id: 'node:B',
      kind: 'FUNCTION',
      name: 'funcB',
      metadata: {},
      evidence: [{ kind: 'AST_SYMBOL', source: 'test', detail: 'B' }]
    };
    const nodeC: SemanticNode = {
      id: 'node:C',
      kind: 'FUNCTION',
      name: 'funcC',
      metadata: {},
      evidence: [{ kind: 'AST_SYMBOL', source: 'test', detail: 'C' }]
    };
    // A -> B -> C
    const edgeAB: SemanticEdge = {
      id: 'edge:AB',
      kind: 'REFERENCES',
      sourceId: 'node:A',
      targetId: 'node:B',
      evidence: [{ kind: 'SYMBOL_REFERENCE', source: 'test', detail: 'A uses B' }],
      metadata: {}
    };
    const edgeBC: SemanticEdge = {
      id: 'edge:BC',
      kind: 'REFERENCES',
      sourceId: 'node:B',
      targetId: 'node:C',
      evidence: [{ kind: 'SYMBOL_REFERENCE', source: 'test', detail: 'B uses C' }],
      metadata: {}
    };
    const graph = buildSyntheticGraph([nodeA, nodeB, nodeC], [edgeAB, edgeBC]);

    it('E.1 doit collecter à la fois l\'amont et l\'aval avec BIDIRECTIONAL', () => {
      const res = runImpactAnalysis(graph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['node:B'],
        direction: 'BIDIRECTIONAL'
      });

      assert.strictEqual(res.impactedNodes.length, 2);
      const ids = res.impactedNodes.map((n) => n.node.id);
      assert.ok(ids.includes('node:A'));
      assert.ok(ids.includes('node:C'));
    });
  });

  // =========================================================================
  // BLOC F — CYCLES & BOUNDED EXPLORATION (3 tests)
  // =========================================================================
  describe('F. Cycle Handling & Bounded Depth', () => {
    const nodeA: SemanticNode = {
      id: 'node:A',
      kind: 'FILE',
      name: 'a.ts',
      metadata: {},
      evidence: [{ kind: 'AST_SYMBOL', source: 'test', detail: 'A' }]
    };
    const nodeB: SemanticNode = {
      id: 'node:B',
      kind: 'FILE',
      name: 'b.ts',
      metadata: {},
      evidence: [{ kind: 'AST_SYMBOL', source: 'test', detail: 'B' }]
    };
    // Circular: A -> B and B -> A
    const edgeAB: SemanticEdge = {
      id: 'edge:AB',
      kind: 'IMPORTS',
      sourceId: 'node:A',
      targetId: 'node:B',
      evidence: [{ kind: 'AST_IMPORT', source: 'test', detail: 'A imports B' }],
      metadata: {}
    };
    const edgeBA: SemanticEdge = {
      id: 'edge:BA',
      kind: 'IMPORTS',
      sourceId: 'node:B',
      targetId: 'node:A',
      evidence: [{ kind: 'AST_IMPORT', source: 'test', detail: 'B imports A' }],
      metadata: {}
    };
    const graph = buildSyntheticGraph([nodeA, nodeB], [edgeAB, edgeBA]);

    it('F.1 ne doit jamais entrer en boucle infinie en cas de dépendance circulaire', () => {
      const res = runImpactAnalysis(graph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['node:A'],
        maxDepth: 10
      });

      assert.strictEqual(res.impactedNodes.length, 1);
      assert.strictEqual(res.impactedNodes[0]!.node.id, 'node:B');
      assert.ok(res.metrics.circularDependenciesDetected >= 1);
    });

    it('F.2 doit respecter strictement la limite maxDepth spécifiée', () => {
      // Linear chain 1 -> 2 -> 3 -> 4
      const n1: SemanticNode = { id: 'n1', kind: 'FUNCTION', name: 'n1', metadata: {}, evidence: [{ kind: 'AST_SYMBOL', source: 't', detail: '1' }] };
      const n2: SemanticNode = { id: 'n2', kind: 'FUNCTION', name: 'n2', metadata: {}, evidence: [{ kind: 'AST_SYMBOL', source: 't', detail: '2' }] };
      const n3: SemanticNode = { id: 'n3', kind: 'FUNCTION', name: 'n3', metadata: {}, evidence: [{ kind: 'AST_SYMBOL', source: 't', detail: '3' }] };
      const n4: SemanticNode = { id: 'n4', kind: 'FUNCTION', name: 'n4', metadata: {}, evidence: [{ kind: 'AST_SYMBOL', source: 't', detail: '4' }] };

      const e21: SemanticEdge = { id: 'e21', kind: 'REFERENCES', sourceId: 'n2', targetId: 'n1', evidence: [{ kind: 'SYMBOL_REFERENCE', source: 't', detail: '2->1' }], metadata: {} };
      const e32: SemanticEdge = { id: 'e32', kind: 'REFERENCES', sourceId: 'n3', targetId: 'n2', evidence: [{ kind: 'SYMBOL_REFERENCE', source: 't', detail: '3->2' }], metadata: {} };
      const e43: SemanticEdge = { id: 'e43', kind: 'REFERENCES', sourceId: 'n4', targetId: 'n3', evidence: [{ kind: 'SYMBOL_REFERENCE', source: 't', detail: '4->3' }], metadata: {} };

      const linearGraph = buildSyntheticGraph([n1, n2, n3, n4], [e21, e32, e43]);

      const res = runImpactAnalysis(linearGraph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['n1'],
        maxDepth: 2
      });

      assert.strictEqual(res.impactedNodes.length, 2);
      const ids = res.impactedNodes.map((n) => n.node.id);
      assert.ok(ids.includes('n2'));
      assert.ok(ids.includes('n3'));
      assert.strictEqual(ids.includes('n4'), false);
    });

    it('F.3 doit rejeter un maxDepth inférieur à 1 avec ValidationError', () => {
      assert.throws(
        () => {
          runImpactAnalysis(graph, {
            tenantId: 'tenant-test',
            projectId: 'project-test',
            targetNodeIds: ['node:A'],
            maxDepth: 0
          });
        },
        ValidationError
      );
    });
  });

  // =========================================================================
  // BLOC G — CHANGE TYPES (2 tests)
  // =========================================================================
  describe('G. Change Types', () => {
    const nodeA: SemanticNode = {
      id: 'node:A',
      kind: 'FUNCTION',
      name: 'helper',
      metadata: {},
      evidence: [{ kind: 'AST_SYMBOL', source: 'test', detail: 'helper' }]
    };
    const nodeB: SemanticNode = {
      id: 'node:B',
      kind: 'COMPONENT',
      name: 'Card',
      metadata: {},
      evidence: [{ kind: 'AST_SYMBOL', source: 'test', detail: 'Card' }]
    };
    const edge: SemanticEdge = {
      id: 'e:BA',
      kind: 'REFERENCES',
      sourceId: 'node:B',
      targetId: 'node:A',
      evidence: [{ kind: 'SYMBOL_REFERENCE', source: 'test', detail: 'Card uses helper' }],
      metadata: {}
    };
    const graph = buildSyntheticGraph([nodeA, nodeB], [edge]);

    it('G.1 changeType DELETE doit classifier les impacts directs comme BREAKING', () => {
      const res = runImpactAnalysis(graph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['node:A'],
        changeType: 'DELETE'
      });

      assert.strictEqual(res.impactedNodes[0]!.classification, 'BREAKING');
      assert.strictEqual(res.metrics.breakingCount, 1);
    });

    it('G.2 changeType MODIFY sur une fonction doit classifier les impacts directs comme BEHAVIORAL', () => {
      const res = runImpactAnalysis(graph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['node:A'],
        changeType: 'MODIFY'
      });

      assert.strictEqual(res.impactedNodes[0]!.classification, 'BEHAVIORAL');
      assert.strictEqual(res.metrics.behavioralCount, 1);
    });
  });

  // =========================================================================
  // BLOC H — CRITICALITY, RISK FACTORS & SCORING (5 tests)
  // =========================================================================
  describe('H. Criticality, Risk Factors & Scoring', () => {
    it('H.1 doit lever le risque à CRITICAL lorsqu\'une route est affectée', () => {
      const nodeFunc: SemanticNode = { id: 'nf', kind: 'FUNCTION', name: 'f', metadata: {}, evidence: [{ kind: 'AST_SYMBOL', source: 't', detail: 'f' }] };
      const nodeRoute: SemanticNode = { id: 'nr', kind: 'ROUTE', name: '/dashboard', metadata: {}, evidence: [{ kind: 'ROUTE_DECLARATION', source: 't', detail: 'r' }] };
      const edge: SemanticEdge = { id: 'e', kind: 'ROUTES_TO', sourceId: 'nr', targetId: 'nf', evidence: [{ kind: 'ROUTE_DECLARATION', source: 't', detail: 'e' }], metadata: {} };

      const graph = buildSyntheticGraph([nodeFunc, nodeRoute], [edge]);
      const res = runImpactAnalysis(graph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['nf']
      });

      assert.strictEqual(res.overallRisk, 'CRITICAL');
      assert.ok(res.riskFactors.some((f) => f.code === 'ROUTE_IMPACT'));
      assert.strictEqual(res.metrics.routesAffectedCount, 1);
    });

    it('H.2 doit détecter le croisement multi-couches (MULTI_LAYER_CROSSING)', () => {
      const nodeData: SemanticNode = {
        id: 'nd',
        kind: 'FUNCTION',
        name: 'fetchUser',
        metadata: { layer: 'data' },
        evidence: [{ kind: 'AST_SYMBOL', source: 't', detail: 'd' }]
      };
      const nodeUI: SemanticNode = {
        id: 'nu',
        kind: 'COMPONENT',
        name: 'UserView',
        metadata: { layer: 'ui' },
        evidence: [{ kind: 'AST_SYMBOL', source: 't', detail: 'u' }]
      };
      const edge: SemanticEdge = { id: 'e', kind: 'REFERENCES', sourceId: 'nu', targetId: 'nd', evidence: [{ kind: 'SYMBOL_REFERENCE', source: 't', detail: 'call' }], metadata: {} };

      const graph = buildSyntheticGraph([nodeData, nodeUI], [edge]);
      const res = runImpactAnalysis(graph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['nd']
      });

      assert.strictEqual(res.metrics.layersCrossedCount, 2);
      assert.ok(res.riskFactors.some((f) => f.code === 'MULTI_LAYER_CROSSING'));
    });

    it('H.3 doit borner le score global entre 0 et 100', () => {
      const nodeA: SemanticNode = { id: 'na', kind: 'FUNCTION', name: 'a', metadata: {}, evidence: [{ kind: 'AST_SYMBOL', source: 't', detail: 'a' }] };
      const graph = buildSyntheticGraph([nodeA], []);
      const res = runImpactAnalysis(graph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['na']
      });

      assert.ok(res.metrics.overallScore >= 0);
      assert.ok(res.metrics.overallScore <= 100);
      assert.ok(res.overallConfidence >= 0.5);
      assert.ok(res.overallConfidence <= 1.0);
    });

    it('H.4 un nœud feuille isolé doit renvoyer 0 nœuds impactés, un risque LOW et un score de 0', () => {
      const leafNode: SemanticNode = {
        id: 'leaf:1',
        kind: 'FUNCTION',
        name: 'orphanFunction',
        metadata: {},
        evidence: [{ kind: 'AST_SYMBOL', source: 't', detail: 'leaf' }]
      };
      const graph = buildSyntheticGraph([leafNode], []);
      const res = runImpactAnalysis(graph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['leaf:1']
      });

      assert.strictEqual(res.impactedNodes.length, 0);
      assert.strictEqual(res.metrics.totalImpactedNodes, 0);
      assert.strictEqual(res.overallRisk, 'LOW');
      assert.strictEqual(res.metrics.overallScore, 0);
    });

    it('H.5 un fort fan-out (> 5 dépendants) doit déclencher un facteur de risque de fan-out', () => {
      const target: SemanticNode = { id: 't', kind: 'FUNCTION', name: 'coreFunc', metadata: {}, evidence: [{ kind: 'AST_SYMBOL', source: 't', detail: 't' }] };
      const consumers: SemanticNode[] = [];
      const edges: SemanticEdge[] = [];

      for (let i = 1; i <= 6; i++) {
        const c: SemanticNode = { id: `c${i}`, kind: 'FUNCTION', name: `caller${i}`, metadata: {}, evidence: [{ kind: 'AST_SYMBOL', source: 't', detail: `c${i}` }] };
        consumers.push(c);
        edges.push({
          id: `e${i}`,
          kind: 'REFERENCES',
          sourceId: c.id,
          targetId: target.id,
          evidence: [{ kind: 'SYMBOL_REFERENCE', source: 't', detail: 'call' }],
          metadata: {}
        });
      }

      const fanGraph = buildSyntheticGraph([target, ...consumers], edges);
      const res = runImpactAnalysis(fanGraph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['t']
      });

      assert.strictEqual(res.impactedNodes.length, 6);
      assert.ok(res.riskFactors.some((f) => f.code === 'MODERATE_FAN_OUT' || f.code === 'HIGH_FAN_OUT'));
    });
  });

  // =========================================================================
  // BLOC I — STRICT EVIDENCE (NO EVIDENCE -> NO IMPACT) (2 tests)
  // =========================================================================
  describe('I. Strict Evidence', () => {
    it('I.1 une arête dépourvue de preuve ne doit PAS propager l\'impact (NO EVIDENCE -> NO IMPACT)', () => {
      const nodeA: SemanticNode = { id: 'na', kind: 'FUNCTION', name: 'a', metadata: {}, evidence: [{ kind: 'AST_SYMBOL', source: 't', detail: 'a' }] };
      const nodeB: SemanticNode = { id: 'nb', kind: 'FUNCTION', name: 'b', metadata: {}, evidence: [{ kind: 'AST_SYMBOL', source: 't', detail: 'b' }] };
      const emptyEvidenceEdge: SemanticEdge = {
        id: 'e:empty',
        kind: 'REFERENCES',
        sourceId: 'nb',
        targetId: 'na',
        evidence: [], // NO EVIDENCE
        metadata: {}
      };

      const graph = buildSyntheticGraph([nodeA, nodeB], [emptyEvidenceEdge]);
      const res = runImpactAnalysis(graph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['na']
      });

      assert.strictEqual(res.impactedNodes.length, 0);
      assert.strictEqual(res.metrics.totalImpactedNodes, 0);
    });

    it('I.2 tous les nœuds impactés doivent conserver la preuve agrégée de leur chemin', () => {
      const nodeA: SemanticNode = { id: 'na', kind: 'FUNCTION', name: 'a', metadata: {}, evidence: [{ kind: 'AST_SYMBOL', source: 't', detail: 'a' }] };
      const nodeB: SemanticNode = { id: 'nb', kind: 'FUNCTION', name: 'b', metadata: {}, evidence: [{ kind: 'AST_SYMBOL', source: 't', detail: 'b' }] };
      const edge: SemanticEdge = {
        id: 'e',
        kind: 'REFERENCES',
        sourceId: 'nb',
        targetId: 'na',
        evidence: [{ kind: 'SYMBOL_REFERENCE', source: 'src/b.ts', detail: 'calls a()', lineStart: 12 }],
        metadata: {}
      };

      const graph = buildSyntheticGraph([nodeA, nodeB], [edge]);
      const res = runImpactAnalysis(graph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['na']
      });

      assert.strictEqual(res.impactedNodes.length, 1);
      assert.strictEqual(res.impactedNodes[0]!.evidence.length, 1);
      assert.strictEqual(res.impactedNodes[0]!.evidence[0]!.kind, 'SYMBOL_REFERENCE');
    });
  });

  // =========================================================================
  // BLOC J — DETERMINISTIC HASHING & COMPARATORS (4 tests)
  // =========================================================================
  describe('J. Deterministic Hashing & Comparators', () => {
    it('J.1 deux exécutions identiques doivent produire le même impactHash SHA-256', () => {
      const nodeA: SemanticNode = { id: 'na', kind: 'FUNCTION', name: 'a', metadata: {}, evidence: [{ kind: 'AST_SYMBOL', source: 't', detail: 'a' }] };
      const nodeB: SemanticNode = { id: 'nb', kind: 'FUNCTION', name: 'b', metadata: {}, evidence: [{ kind: 'AST_SYMBOL', source: 't', detail: 'b' }] };
      const edge: SemanticEdge = { id: 'e', kind: 'REFERENCES', sourceId: 'nb', targetId: 'na', evidence: [{ kind: 'SYMBOL_REFERENCE', source: 't', detail: 'd' }], metadata: {} };

      const graph = buildSyntheticGraph([nodeA, nodeB], [edge]);

      const res1 = runImpactAnalysis(graph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['na']
      });

      const res2 = runImpactAnalysis(graph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['na']
      });

      assert.strictEqual(res1.impactHash.length, 64);
      assert.strictEqual(res1.impactHash, res2.impactHash);
    });

    it('J.2 les métadonnées volatiles (createdAt, durationMs) ne doivent pas altérer impactHash', () => {
      const nodeA: SemanticNode = { id: 'na', kind: 'FUNCTION', name: 'a', metadata: {}, evidence: [{ kind: 'AST_SYMBOL', source: 't', detail: 'a' }] };
      const graph = buildSyntheticGraph([nodeA], []);

      const res1 = runImpactAnalysis(graph, { tenantId: 'tenant-test', projectId: 'project-test', targetNodeIds: ['na'] }, { startTime: Date.now() - 1000 });
      const res2 = runImpactAnalysis(graph, { tenantId: 'tenant-test', projectId: 'project-test', targetNodeIds: ['na'] }, { startTime: Date.now() });

      assert.notStrictEqual(res1.durationMs, res2.durationMs);
      assert.strictEqual(res1.impactHash, res2.impactHash);
    });

    it('J.3 compareImpactNodes doit trier par profondeur croissante puis classification puis risque', () => {
      const dummyNode: SemanticNode = { id: '1', kind: 'FUNCTION', name: 'f', metadata: {}, evidence: [] };
      const dummyPath: ImpactPath = { steps: [], length: 0 };

      const nDirectBreaking: ImpactedNode = {
        node: dummyNode,
        depth: 1,
        isDirect: true,
        classification: 'BREAKING',
        riskLevel: 'CRITICAL',
        confidence: 1,
        shortestPath: dummyPath,
        allPaths: [],
        reason: '',
        evidence: []
      };
      const nTransitive: ImpactedNode = {
        node: dummyNode,
        depth: 2,
        isDirect: false,
        classification: 'REGRESSION_RISK',
        riskLevel: 'MEDIUM',
        confidence: 0.8,
        shortestPath: dummyPath,
        allPaths: [],
        reason: '',
        evidence: []
      };

      assert.ok(compareImpactNodes(nDirectBreaking, nTransitive) < 0);
      assert.ok(compareImpactNodes(nTransitive, nDirectBreaking) > 0);
    });

    it('J.4 compareImpactPaths doit trier par longueur croissante', () => {
      const p1: ImpactPath = { steps: [{ fromNodeId: 'a', toNodeId: 'b', edgeKind: 'IMPORTS', edgeEvidence: [] }], length: 1 };
      const p2: ImpactPath = { steps: [
        { fromNodeId: 'a', toNodeId: 'b', edgeKind: 'IMPORTS', edgeEvidence: [] },
        { fromNodeId: 'b', toNodeId: 'c', edgeKind: 'IMPORTS', edgeEvidence: [] }
      ], length: 2 };

      assert.ok(compareImpactPaths(p1, p2) < 0);
      assert.ok(compareImpactPaths(p2, p1) > 0);
    });
  });

  // =========================================================================
  // BLOC K — DEEP IMMUTABILITY (1 test)
  // =========================================================================
  describe('K. Deep Immutability', () => {
    it('K.1 le résultat de l\'analyse doit être profondément gelé (deepFreeze)', () => {
      const nodeA: SemanticNode = { id: 'na', kind: 'FUNCTION', name: 'a', metadata: {}, evidence: [{ kind: 'AST_SYMBOL', source: 't', detail: 'a' }] };
      const graph = buildSyntheticGraph([nodeA], []);
      const res = runImpactAnalysis(graph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['na']
      });

      assert.strictEqual(Object.isFrozen(res), true);
      assert.strictEqual(Object.isFrozen(res.metrics), true);
      assert.strictEqual(Object.isFrozen(res.impactedNodes), true);
      assert.strictEqual(Object.isFrozen(res.resolvedTargets), true);

      assert.throws(() => {
        (res as any).tenantId = 'hacked';
      });
    });
  });

  // =========================================================================
  // BLOC L — MINIMAL SUBGRAPH EXTRACTION (1 test)
  // =========================================================================
  describe('L. Minimal Subgraph Extraction', () => {
    it('L.1 doit extraire un impactSubgraph contenant exactement les nœuds cibles, impactés et arêtes traversées', () => {
      const nodeA: SemanticNode = { id: 'na', kind: 'FUNCTION', name: 'a', metadata: {}, evidence: [{ kind: 'AST_SYMBOL', source: 't', detail: 'a' }] };
      const nodeB: SemanticNode = { id: 'nb', kind: 'FUNCTION', name: 'b', metadata: {}, evidence: [{ kind: 'AST_SYMBOL', source: 't', detail: 'b' }] };
      const nodeIsolated: SemanticNode = { id: 'niso', kind: 'FUNCTION', name: 'iso', metadata: {}, evidence: [{ kind: 'AST_SYMBOL', source: 't', detail: 'iso' }] };

      const edge: SemanticEdge = { id: 'e', kind: 'REFERENCES', sourceId: 'nb', targetId: 'na', evidence: [{ kind: 'SYMBOL_REFERENCE', source: 't', detail: 'd' }], metadata: {} };

      const graph = buildSyntheticGraph([nodeA, nodeB, nodeIsolated], [edge]);

      const res = runImpactAnalysis(graph, {
        tenantId: 'tenant-test',
        projectId: 'project-test',
        targetNodeIds: ['na']
      });

      assert.strictEqual(res.impactSubgraph.nodes.length, 2);
      assert.strictEqual(res.impactSubgraph.nodes.some((n) => n.id === 'niso'), false);
      assert.strictEqual(res.impactSubgraph.edges.length, 1);
      assert.strictEqual(res.impactSubgraph.edges[0]!.id, 'e');
    });
  });

  // =========================================================================
  // BLOC M — LRU CACHE & INVALIDATION (3 tests)
  // =========================================================================
  describe('M. LRU Cache & Invalidation', () => {
    it('M.1 ImpactIntelligenceService doit mettre en cache et servir les requêtes répétées', () => {
      const fileSource = new MockFileSource();
      fileSource.setFiles('t1', 'p1', {
        'src/utils.ts': 'export function helper() { return 1; }',
        'src/main.ts': 'import { helper } from "./utils"; export const res = helper();'
      });
      const codeIntel = new CodeIntelligenceService(fileSource);
      const dna = new ApplicationDNAService(codeIntel);
      const semGraph = new SemanticCodeGraphService(codeIntel, dna, fileSource);
      const impactService = new ImpactIntelligenceService(semGraph);

      const req = {
        tenantId: 't1',
        projectId: 'p1',
        targetFiles: ['src/utils.ts']
      };

      const res1 = impactService.analyzeImpact(req, 'OWNER');
      const metrics1 = impactService.getCacheMetrics();
      assert.strictEqual(metrics1.hits, 0);
      assert.strictEqual(metrics1.misses, 1);

      const res2 = impactService.analyzeImpact(req, 'OWNER');
      const metrics2 = impactService.getCacheMetrics();
      assert.strictEqual(metrics2.hits, 1);
      assert.strictEqual(res1.impactHash, res2.impactHash);
    });

    it('M.2 doit invalider le cache lorsque le contenu du projet change (graphHash change)', () => {
      const fileSource = new MockFileSource();
      fileSource.setFiles('t1', 'p1', {
        'src/utils.ts': 'export function helper() { return 1; }',
        'src/main.ts': 'import { helper } from "./utils"; export const res = helper();'
      });
      const codeIntel = new CodeIntelligenceService(fileSource);
      const dna = new ApplicationDNAService(codeIntel);
      const semGraph = new SemanticCodeGraphService(codeIntel, dna, fileSource);
      const impactService = new ImpactIntelligenceService(semGraph);

      const req = {
        tenantId: 't1',
        projectId: 'p1',
        targetFiles: ['src/utils.ts']
      };

      impactService.analyzeImpact(req, 'OWNER');

      // Update file content in FileStore -> treeHash & graphHash will change
      fileSource.setFiles('t1', 'p1', {
        'src/utils.ts': 'export function helper() { return 2; }',
        'src/main.ts': 'import { helper } from "./utils"; export const res = helper();'
      });

      impactService.analyzeImpact(req, 'OWNER');
      const metrics = impactService.getCacheMetrics();
      assert.strictEqual(metrics.misses, 2); // cache miss because graphHash changed
    });

    it('M.3 doit évincer les entrées les plus anciennes quand la capacité max est atteinte (LRU)', () => {
      const fileSource = new MockFileSource();
      fileSource.setFiles('t1', 'p1', {
        'src/a.ts': 'export const a = 1;',
        'src/b.ts': 'export const b = 2;',
        'src/c.ts': 'export const c = 3;'
      });
      const codeIntel = new CodeIntelligenceService(fileSource);
      const dna = new ApplicationDNAService(codeIntel);
      const semGraph = new SemanticCodeGraphService(codeIntel, dna, fileSource);
      // Cache with maxEntries = 2
      const smallCacheService = new ImpactIntelligenceService(semGraph, { cacheMaxEntries: 2 });

      smallCacheService.analyzeImpact({ tenantId: 't1', projectId: 'p1', targetFiles: ['src/a.ts'] }, 'OWNER');
      smallCacheService.analyzeImpact({ tenantId: 't1', projectId: 'p1', targetFiles: ['src/b.ts'] }, 'OWNER');
      assert.strictEqual(smallCacheService.getCacheMetrics().entryCount, 2);

      // Third insert must trigger 1 eviction
      smallCacheService.analyzeImpact({ tenantId: 't1', projectId: 'p1', targetFiles: ['src/c.ts'] }, 'OWNER');
      const m = smallCacheService.getCacheMetrics();
      assert.strictEqual(m.entryCount, 2);
      assert.strictEqual(m.evictions, 1);
    });
  });

  // =========================================================================
  // BLOC N — RBAC & MULTI-TENANCY (3 tests)
  // =========================================================================
  describe('N. RBAC & Multi-Tenancy', () => {
    const fileSource = new MockFileSource();
    fileSource.setFiles('tenant-alpha', 'p1', {
      'src/a.ts': 'export const a = 1;'
    });
    const codeIntel = new CodeIntelligenceService(fileSource);
    const dna = new ApplicationDNAService(codeIntel);
    const semGraph = new SemanticCodeGraphService(codeIntel, dna, fileSource);
    const impactService = new ImpactIntelligenceService(semGraph);

    it('N.1 doit autoriser un VIEWER en lecture (PROJECT_READ)', () => {
      const res = impactService.analyzeImpact(
        {
          tenantId: 'tenant-alpha',
          projectId: 'p1',
          targetFiles: ['src/a.ts']
        },
        'VIEWER'
      );
      assert.ok(res);
      assert.strictEqual(res.tenantId, 'tenant-alpha');
    });

    it('N.2 doit rejeter un rôle non autorisé avec ForbiddenError', () => {
      assert.throws(
        () => {
          impactService.analyzeImpact(
            {
              tenantId: 'tenant-alpha',
              projectId: 'p1',
              targetFiles: ['src/a.ts']
            },
            'UNKNOWN_ROLE' as any
          );
        },
        ForbiddenError
      );
    });

    it('N.3 doit isoler hermétiquement deux locataires distincts', () => {
      fileSource.setFiles('tenant-beta', 'p1', {
        'src/b.ts': 'export const b = 2;'
      });

      const resAlpha = impactService.analyzeImpact(
        { tenantId: 'tenant-alpha', projectId: 'p1', targetFiles: ['src/a.ts'] },
        'OWNER'
      );
      const resBeta = impactService.analyzeImpact(
        { tenantId: 'tenant-beta', projectId: 'p1', targetFiles: ['src/b.ts'] },
        'OWNER'
      );

      assert.strictEqual(resAlpha.tenantId, 'tenant-alpha');
      assert.strictEqual(resBeta.tenantId, 'tenant-beta');
      assert.notStrictEqual(resAlpha.graphHash, resBeta.graphHash);
      assert.notStrictEqual(resAlpha.impactHash, resBeta.impactHash);
    });
  });

  // =========================================================================
  // BLOC O — END-TO-END WITH REAL GRAPH & DIRECT EXECUTION (3 tests)
  // =========================================================================
  describe('O. End-to-End Execution & Direct Graph Analysis', () => {
    const fileSource = new MockFileSource();
    fileSource.setFiles('tenant-prod', 'volaco-app', {
      'src/components/Button.tsx': `
        export interface ButtonProps { label: string; }
        export function Button(props: ButtonProps) { return <button>{props.label}</button>; }
      `,
      'src/components/Header.tsx': `
        import { Button } from './Button';
        export function Header() { return <header><Button label="Click" /></header>; }
      `,
      'src/pages/HomePage.tsx': `
        import { Header } from '../components/Header';
        export function HomePage() { return <div><Header /></div>; }
      `,
      'src/routes.tsx': `
        import { HomePage } from './pages/HomePage';
        export const routes = [{ path: '/', component: HomePage }];
      `
    });

    const codeIntel = new CodeIntelligenceService(fileSource);
    const dna = new ApplicationDNAService(codeIntel);
    const semGraph = new SemanticCodeGraphService(codeIntel, dna, fileSource);
    const impactService = new ImpactIntelligenceService(semGraph);

    it('O.1 doit exécuter l\'analyse d\'impact complète de bout en bout sur le projet', () => {
      const analysis = impactService.analyzeImpact({
        tenantId: 'tenant-prod',
        projectId: 'volaco-app',
        targetFiles: ['src/components/Button.tsx'],
        direction: 'UPSTREAM_DEPENDENTS'
      });

      assert.ok(analysis.impactedNodes.length >= 1);
      assert.ok(analysis.impactSubgraph.nodes.length >= 2);
      assert.strictEqual(analysis.tenantId, 'tenant-prod');
      assert.strictEqual(analysis.projectId, 'volaco-app');
      assert.ok(analysis.impactHash);
    });

    it('O.2 doit supporter la méthode directe analyzeImpactOnGraph', () => {
      const graph = semGraph.buildGraph({
        tenantId: 'tenant-prod',
        projectId: 'volaco-app'
      });

      const analysis = impactService.analyzeImpactOnGraph(graph, {
        targetFiles: ['src/components/Button.tsx']
      });

      assert.ok(analysis);
      assert.strictEqual(analysis.graphHash, graph.graphHash);
      assert.strictEqual(analysis.tenantId, graph.tenantId);
    });

    it('O.3 suppression (DELETE) d\'un fichier consommé doit classifier ses consommateurs comme BREAKING', () => {
      const analysis = impactService.analyzeImpact({
        tenantId: 'tenant-prod',
        projectId: 'volaco-app',
        targetFiles: ['src/pages/HomePage.tsx'],
        changeType: 'DELETE'
      });

      const breakingConsumer = analysis.impactedNodes.find((n) => n.classification === 'BREAKING');
      assert.ok(breakingConsumer);
      assert.strictEqual(analysis.metrics.breakingCount >= 1, true);
    });
  });
});
