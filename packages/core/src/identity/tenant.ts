import type { Tenant, EntityId } from '../types/index.js';
import { ValidationError } from '../errors.js';
import { dataFilePath, readJsonFile, writeJsonFileSync } from '../persistence/json-disk-cache.js';

function reviveTenant(raw: Tenant): Tenant {
  return { ...raw, createdAt: new Date(raw.createdAt) };
}

export class TenantStore {
  private tenants = new Map<EntityId, Tenant>();
  private readonly filePath: string | undefined;

  constructor(options?: { persist?: boolean }) {
    if (options?.persist) {
      this.filePath = dataFilePath('tenants');
      const raw = readJsonFile<Record<string, Tenant>>(this.filePath, {});
      for (const [id, tenant] of Object.entries(raw)) {
        this.tenants.set(id, reviveTenant(tenant));
      }
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    const obj: Record<string, Tenant> = {};
    for (const [id, tenant] of this.tenants.entries()) {
      obj[id] = tenant;
    }
    writeJsonFileSync(this.filePath, obj);
  }

  public createTenant(id: string, name: string, slug: string): Tenant {
    if (!id || !name || !slug) {
      throw new ValidationError('ParamÃ¨tres de tenant invalides (id, name, slug requis)');
    }
    const tenant: Tenant = {
      id,
      name,
      slug,
      createdAt: new Date()
    };
    this.tenants.set(id, tenant);
    this.persist();
    return tenant;
  }

  public getTenant(id: EntityId): Tenant | null {
    return this.tenants.get(id) || null;
  }

  public clear(): void {
    this.tenants.clear();
    this.persist();
  }
}

export const tenantStore = new TenantStore({ persist: true });

