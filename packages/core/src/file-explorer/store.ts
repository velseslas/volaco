/**
 * VibeCode Studio - Virtual File Store (CORE-003)
 */

import { ValidationError } from '../errors.js';
import { computeSha256 } from '../model/revision.js';
import { dataFilePath, readJsonFile, writeJsonFileSync } from '../persistence/json-disk-cache.js';

export const computeFileHash = computeSha256;
import type { FileContent, FileNode, FileNodeType } from './types.js';

interface StoredEntry {
  type: FileNodeType;
  content?: string | undefined;
  updatedAt: Date;
}

function reviveEntry(raw: StoredEntry): StoredEntry {
  return { ...raw, updatedAt: new Date(raw.updatedAt) };
}

export function sanitizePath(inputPath: string): string {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new ValidationError('Le chemin du fichier est obligatoire');
  }

  // Remplacer les antislashs Windows par des slashs
  let normalized = inputPath.replace(/\\/g, '/').trim();

  // Supprimer les slashs au début et à la fin
  normalized = normalized.replace(/^\/+|\/+$/g, '');

  // Sécurité anti-Directory Traversal
  const parts = normalized.split('/');
  for (const part of parts) {
    if (part === '..' || part === '.') {
      throw new ValidationError('Chemin invalide : tentative de navigation relative (..) interdite');
    }
    if (part.includes('\0')) {
      throw new ValidationError('Caractère nul interdit dans le chemin');
    }
  }

  if (normalized.length === 0) {
    throw new ValidationError('Le chemin du fichier ne peut pas être vide');
  }

  return normalized;
}

export class FileStore {
  // Clé: `${tenantId}:${projectId}` -> Map<relativePath, StoredEntry>
  private projectFiles = new Map<string, Map<string, StoredEntry>>();
  private readonly filePath: string | undefined;

  constructor(options?: { persist?: boolean }) {
    if (options?.persist) {
      this.filePath = dataFilePath('files');
      const raw = readJsonFile<Record<string, Record<string, StoredEntry>>>(this.filePath, {});
      for (const [projectKey, entries] of Object.entries(raw)) {
        const map = new Map<string, StoredEntry>();
        for (const [path, entry] of Object.entries(entries)) {
          map.set(path, reviveEntry(entry));
        }
        this.projectFiles.set(projectKey, map);
      }
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    const obj: Record<string, Record<string, StoredEntry>> = {};
    for (const [projectKey, map] of this.projectFiles.entries()) {
      const entries: Record<string, StoredEntry> = {};
      for (const [path, entry] of map.entries()) {
        entries[path] = entry;
      }
      obj[projectKey] = entries;
    }
    writeJsonFileSync(this.filePath, obj);
  }

  private getProjectKey(tenantId: string, projectId: string): string {
    return `${tenantId}:${projectId}`;
  }

  private getOrCreateProjectMap(tenantId: string, projectId: string): Map<string, StoredEntry> {
    const key = this.getProjectKey(tenantId, projectId);
    let map = this.projectFiles.get(key);
    if (!map) {
      map = new Map<string, StoredEntry>();
      // Initialiser avec un index.html par défaut
      map.set('index.html', {
        type: 'file',
        content: '<!DOCTYPE html>\n<html>\n<head><title>App</title></head>\n<body><h1>Hello VibeCode</h1></body>\n</html>',
        updatedAt: new Date()
      });
      this.projectFiles.set(key, map);
      this.persist();
    }
    return map;
  }

  public initializeStandardTree(tenantId: string, projectId: string): FileNode[] {
    const map = this.getOrCreateProjectMap(tenantId, projectId);
    const now = new Date();
    // Arborescence standard d'un projet CAPP-002
    map.set('src', { type: 'directory', updatedAt: now });
    map.set('src/components', { type: 'directory', updatedAt: now });
    map.set('src/pages', { type: 'directory', updatedAt: now });
    map.set('src/App.js', {
      type: 'file',
      content: 'export default function App() {\n  return <div className="app"><h1>My App</h1></div>;\n}\n',
      updatedAt: now
    });
    map.set('public', { type: 'directory', updatedAt: now });
    map.set('public/index.html', {
      type: 'file',
      content: '<!DOCTYPE html>\n<html lang="fr">\n<head>\n  <meta charset="UTF-8">\n  <title>My App</title>\n</head>\n<body>\n  <div id="root"></div>\n</body>\n</html>\n',
      updatedAt: now
    });
    map.set('package.json', {
      type: 'file',
      content: '{\n  "name": "my-app",\n  "version": "0.1.0",\n  "private": true,\n  "dependencies": {\n    "react": "^18.2.0",\n    "react-dom": "^18.2.0"\n  }\n}\n',
      updatedAt: now
    });
    map.set('README.md', {
      type: 'file',
      content: '# My App\n\nProjet VibeCode Studio généré selon CAPP-002.\n',
      updatedAt: now
    });
    this.persist();
    return this.getTree(tenantId, projectId);
  }

  public getFile(tenantId: string, projectId: string, rawPath: string): FileContent | null {
    const path = sanitizePath(rawPath);
    const map = this.getOrCreateProjectMap(tenantId, projectId);
    const entry = map.get(path);
    if (!entry || entry.type !== 'file') {
      return null;
    }

    const content = entry.content ?? '';
    const name = path.split('/').pop() ?? path;

    return {
      path,
      name,
      content,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      hash: computeFileHash(content),
      updatedAt: entry.updatedAt
    };
  }

  public createNode(
    tenantId: string,
    projectId: string,
    rawPath: string,
    type: FileNodeType,
    content?: string
  ): FileNode {
    const path = sanitizePath(rawPath);
    const map = this.getOrCreateProjectMap(tenantId, projectId);

    if (map.has(path)) {
      throw new ValidationError(`L'élément "${path}" existe déjà dans ce projet`);
    }

    // Si c'est un fichier dans un sous-dossier, s'assurer que les dossiers parents sont enregistrés
    const parts = path.split('/');
    if (parts.length > 1) {
      let currentDir = '';
      for (let i = 0; i < parts.length - 1; i++) {
        currentDir = currentDir ? `${currentDir}/${parts[i]}` : (parts[i] ?? '');
        if (!map.has(currentDir)) {
          map.set(currentDir, {
            type: 'directory',
            updatedAt: new Date()
          });
        }
      }
    }

    const now = new Date();
    const storedContent = type === 'file' ? (content ?? '') : undefined;
    map.set(path, {
      type,
      content: storedContent,
      updatedAt: now
    });

    const name = parts.pop() ?? path;
    this.persist();
    return {
      path,
      name,
      type,
      sizeBytes: type === 'file' ? Buffer.byteLength(storedContent ?? '', 'utf8') : undefined,
      hash: type === 'file' ? computeFileHash(storedContent ?? '') : undefined,
      updatedAt: now,
      children: type === 'directory' ? [] : undefined
    };
  }

  public saveFile(
    tenantId: string,
    projectId: string,
    rawPath: string,
    content: string
  ): FileContent {
    const path = sanitizePath(rawPath);
    const map = this.getOrCreateProjectMap(tenantId, projectId);
    const existing = map.get(path);

    if (existing && existing.type === 'directory') {
      throw new ValidationError(`"${path}" est un dossier, impossible d'écrire du contenu de fichier`);
    }

    const now = new Date();
    map.set(path, {
      type: 'file',
      content,
      updatedAt: now
    });

    const name = path.split('/').pop() ?? path;
    this.persist();
    return {
      path,
      name,
      content,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      hash: computeFileHash(content),
      updatedAt: now
    };
  }

  public deleteNode(tenantId: string, projectId: string, rawPath: string): boolean {
    const path = sanitizePath(rawPath);
    const map = this.getOrCreateProjectMap(tenantId, projectId);

    if (!map.has(path)) {
      return false;
    }

    // Supprimer l'élément
    map.delete(path);

    // Si c'était un dossier, supprimer récursivement tous les sous-éléments
    const prefix = `${path}/`;
    for (const key of Array.from(map.keys())) {
      if (key.startsWith(prefix)) {
        map.delete(key);
      }
    }

    this.persist();
    return true;
  }

  public moveNode(
    tenantId: string,
    projectId: string,
    rawOldPath: string,
    rawNewPath: string
  ): FileNode {
    const oldPath = sanitizePath(rawOldPath);
    const newPath = sanitizePath(rawNewPath);

    if (oldPath === newPath) {
      throw new ValidationError('Les chemins source et destination sont identiques');
    }

    const map = this.getOrCreateProjectMap(tenantId, projectId);
    const existing = map.get(oldPath);
    if (!existing) {
      throw new ValidationError(`L'élément source "${oldPath}" n'existe pas`);
    }
    if (map.has(newPath)) {
      throw new ValidationError(`La destination "${newPath}" existe déjà`);
    }

    // Sécurité : interdire le déplacement d'un dossier dans lui-même ou dans l'un de ses descendants
    if (existing.type === 'directory' && newPath.startsWith(`${oldPath}/`)) {
      throw new ValidationError(`Impossible de déplacer le dossier "${oldPath}" dans son propre sous-dossier "${newPath}"`);
    }

    // S'assurer que les dossiers parents de la nouvelle destination existent
    const parts = newPath.split('/');
    if (parts.length > 1) {
      let currentDir = '';
      for (let i = 0; i < parts.length - 1; i++) {
        currentDir = currentDir ? `${currentDir}/${parts[i]}` : (parts[i] ?? '');
        if (!map.has(currentDir)) {
          map.set(currentDir, {
            type: 'directory',
            updatedAt: new Date()
          });
        }
      }
    }

    map.delete(oldPath);
    const now = new Date();
    map.set(newPath, {
      ...existing,
      updatedAt: now
    });

    // Si c'est un dossier, déplacer également les enfants récursivement
    if (existing.type === 'directory') {
      const oldPrefix = `${oldPath}/`;
      for (const [key, val] of Array.from(map.entries())) {
        if (key.startsWith(oldPrefix)) {
          const suffix = key.substring(oldPrefix.length);
          map.delete(key);
          map.set(`${newPath}/${suffix}`, {
            ...val,
            updatedAt: now
          });
        }
      }
    }

    const name = newPath.split('/').pop() ?? newPath;
    this.persist();
    return {
      path: newPath,
      name,
      type: existing.type,
      sizeBytes: existing.type === 'file' ? Buffer.byteLength(existing.content ?? '', 'utf8') : undefined,
      hash: existing.type === 'file' ? computeFileHash(existing.content ?? '') : undefined,
      updatedAt: now
    };
  }

  public renameNode(
    tenantId: string,
    projectId: string,
    rawOldPath: string,
    rawNewPath: string
  ): FileNode {
    return this.moveNode(tenantId, projectId, rawOldPath, rawNewPath);
  }

  public getTree(tenantId: string, projectId: string): FileNode[] {
    const map = this.getOrCreateProjectMap(tenantId, projectId);
    const nodesMap = new Map<string, FileNode>();
    const rootNodes: FileNode[] = [];

    // 1. Créer tous les objets FileNode
    for (const [path, entry] of map.entries()) {
      const name = path.split('/').pop() ?? path;
      const node: FileNode = {
        path,
        name,
        type: entry.type,
        sizeBytes: entry.type === 'file' ? Buffer.byteLength(entry.content ?? '', 'utf8') : undefined,
        hash: entry.type === 'file' ? computeFileHash(entry.content ?? '') : undefined,
        updatedAt: entry.updatedAt,
        children: entry.type === 'directory' ? [] : undefined
      };
      nodesMap.set(path, node);
    }

    // 2. Assembler l'arborescence hiérarchique
    for (const [path, node] of nodesMap.entries()) {
      const lastSlashIndex = path.lastIndexOf('/');
      if (lastSlashIndex === -1) {
        // C'est un élément racine
        rootNodes.push(node);
      } else {
        const parentPath = path.substring(0, lastSlashIndex);
        let parentNode = nodesMap.get(parentPath);
        if (!parentNode) {
          // Créer le parent synthétiquement si non explicitement enregistré
          const parentName = parentPath.split('/').pop() ?? parentPath;
          parentNode = {
            path: parentPath,
            name: parentName,
            type: 'directory',
            updatedAt: new Date(),
            children: []
          };
          nodesMap.set(parentPath, parentNode);
          rootNodes.push(parentNode);
        }
        if (!parentNode.children) {
          parentNode.children = [];
        }
        parentNode.children.push(node);
      }
    }

    // 3. Trier récursivement : dossiers en premier, puis ordre alphabétique
    const sortNodes = (nodes: FileNode[]): FileNode[] => {
      nodes.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      for (const node of nodes) {
        if (node.children && node.children.length > 0) {
          sortNodes(node.children);
        }
      }
      return nodes;
    };

    return sortNodes(rootNodes);
  }

  public computeTreeHash(tenantId: string, projectId: string): string {
    const map = this.getOrCreateProjectMap(tenantId, projectId);
    const fileEntries: string[] = [];
    for (const [path, entry] of map.entries()) {
      if (entry.type === 'file') {
        const h = computeFileHash(entry.content ?? '');
        fileEntries.push(`${path}:${h}`);
      }
    }
    fileEntries.sort();
    return computeFileHash(fileEntries.join('\n'));
  }

  public getAllProjectFiles(tenantId: string, projectId: string): Record<string, string> {
    const map = this.getOrCreateProjectMap(tenantId, projectId);
    const files: Record<string, string> = {};
    for (const [path, entry] of map.entries()) {
      if (entry.type === 'file') {
        files[path] = entry.content ?? '';
      }
    }
    return files;
  }

  public createDirectory(tenantId: string, projectId: string, rawPath: string): FileNode {
    return this.createNode(tenantId, projectId, rawPath, 'directory');
  }

  public deleteDirectory(tenantId: string, projectId: string, rawPath: string): boolean {
    return this.deleteNode(tenantId, projectId, rawPath);
  }

  public clear(): void {
    this.projectFiles.clear();
    this.persist();
  }
}

export const fileStore = new FileStore({ persist: true });
