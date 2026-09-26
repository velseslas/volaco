/**
 * VibeCode Studio - Studio Shell Types (CAPP-005)
 */

import type { EntityId } from '../types/index.js';
import type { ProjectStateSummary } from '../project-state/types.js';
import type { ProjectFilesSummary } from '../file-explorer/types.js';
import type { WorkspaceSession } from '../workspace/types.js';

export interface StudioPanelConfig {
  visible: boolean;
  widthPercent?: number | undefined;
  heightPercent?: number | undefined;
  title: string;
}

export interface StudioShellLayout {
  title: string;
  panels: {
    fileTree: StudioPanelConfig;
    workspace: StudioPanelConfig;
    projectInfo: StudioPanelConfig;
    statusEvents: StudioPanelConfig;
  };
}

export interface StudioShellViewModel {
  tenantId: EntityId;
  projectId: EntityId;
  userRole: string;
  project: ProjectStateSummary;
  files: ProjectFilesSummary;
  workspace: WorkspaceSession;
  layout: StudioShellLayout;
  serverTime: Date;
}
