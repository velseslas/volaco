/**
 * VibeCode Studio - File Explorer Types (CORE-003)
 */

import type { EntityId } from '../types/index.js';

export type FileNodeType = 'file' | 'directory';

export interface FileNode {
  path: string;
  name: string;
  type: FileNodeType;
  sizeBytes?: number | undefined;
  hash?: string | undefined;
  updatedAt: Date;
  children?: FileNode[] | undefined;
}

export interface FileContent {
  path: string;
  name: string;
  content: string;
  sizeBytes: number;
  hash?: string | undefined;
  updatedAt: Date;
}

export interface CreateFileInput {
  path: string;
  type: FileNodeType;
  content?: string | undefined;
}

export interface RenameFileInput {
  oldPath: string;
  newPath: string;
}

export interface MoveFileInput {
  oldPath: string;
  newPath: string;
}

export type FileOperationType =
  | 'CREATE_FILE'
  | 'UPDATE_FILE'
  | 'DELETE_FILE'
  | 'CREATE_DIRECTORY'
  | 'DELETE_DIRECTORY'
  | 'MOVE_FILE'
  | 'RENAME_FILE';

export interface FileOperation {
  type: FileOperationType;
  path: string;
  content?: string | undefined;
  newPath?: string | undefined;
}

export interface FileOperationResult {
  operation: FileOperationType;
  path: string;
  newPath?: string | undefined;
  success: boolean;
  node?: FileNode | undefined;
  file?: FileContent | undefined;
  deletedPath?: string | undefined;
  timestamp: Date;
}

export interface ProjectFilesSummary {
  tenantId: EntityId;
  projectId: EntityId;
  totalFiles: number;
  totalDirectories: number;
  treeHash: string;
  currentRevisionId?: string | undefined;
  revisionNumber?: number | undefined;
  tree: FileNode[];
}

