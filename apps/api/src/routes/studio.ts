import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  StudioShellService
} from '../../../../packages/core/src/studio/index.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { projectStateService } from './project-state.js';
import { fileExplorerService } from './files.js';
import { workspaceServiceInstance } from './project-state.js';
import type { RequestContext } from '../middleware/auth.js';

export const studioShellService = new StudioShellService(
  projectStore,
  projectStateService,
  fileExplorerService,
  workspaceServiceInstance
);

export async function handleStudioRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url || '/', `http://${host}`);

  // 1. GET /api/v1/projects/:projectId/shell (JSON ViewModel)
  const prefix = '/api/v1/projects/';
  if (req.method === 'GET' && pathname.startsWith(prefix) && pathname.endsWith('/shell')) {
    const afterPrefix = pathname.substring(prefix.length);
    const parts = afterPrefix.split('/');
    const projectId = parts[0];

    if (projectId && parts[1] === 'shell') {
      const viewModel = studioShellService.getShellViewModel(
        context.tenantId,
        projectId,
        context.role,
        requestId
      );

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ shell: viewModel, requestId }));
      return true;
    }
  }

  // 2. GET /shell ou GET /studio ou GET / (Interface HTML interactive CAPP-005)
  if (req.method === 'GET' && (pathname === '/shell' || pathname === '/studio' || pathname === '/index.html' || pathname === '/')) {
    let projectId = url.searchParams.get('projectId');
    if (!projectId) {
      // Trouver le premier projet du tenant ou en créer un par défaut
      const projects = projectStore.listProjects(context.tenantId);
      if (projects.length > 0 && projects[0]) {
        projectId = projects[0].id;
      } else {
        const defaultProj = projectStore.createProject(context.tenantId, 'Mon Projet Studio', 'Projet par défaut Studio Shell');
        projectId = defaultProj.id;
      }
    }

    const html = studioShellService.renderShellHtml(
      context.tenantId,
      projectId,
      context.role,
      requestId
    );

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
    return true;
  }

  return false;
}
