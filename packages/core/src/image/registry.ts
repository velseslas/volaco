/**
 * VibeCode Core — Image Providers (P4)
 *
 * Interface unique + registry pour la génération d'images, sur le même
 * motif que AIProviderAdapter : chaque connecteur (Pollinations, OpenAI,
 * Stability…) est un adaptateur derrière un registry — le pipeline ne
 * connaît que l'interface.
 *
 * Contrat : generate(prompt) → image binaire + contentType. Le stockage et
 * le référencement dans le projet sont gérés par la couche appelante
 * (FileStore base64 + workspace public → bundle React).
 */

export interface GeneratedImage {
  /** Octets de l'image (jpg/png/webp selon le provider). */
  readonly data: Buffer;
  readonly contentType: string;
}

export interface ImageGenerateOptions {
  readonly width?: number;
  readonly height?: number;
  /** Injection de fetch pour les tests (défaut : fetch global). */
  readonly fetchImpl?: typeof fetch;
}

export interface ImageProvider {
  readonly id: string;
  readonly name: string;
  /** Disponible = tout ce dont il a besoin est configuré (clé, réseau…). */
  isAvailable(): boolean;
  generate(prompt: string, options?: ImageGenerateOptions): Promise<GeneratedImage>;
}

export class ImageProviderRegistry {
  private readonly providers = new Map<string, ImageProvider>();

  public register(provider: ImageProvider): void {
    this.providers.set(provider.id, provider);
  }

  public get(id: string): ImageProvider | undefined {
    return this.providers.get(id);
  }

  /** Premier provider disponible (ordre d'enregistrement). */
  public resolveAvailable(): ImageProvider | undefined {
    for (const p of this.providers.values()) {
      if (p.isAvailable()) return p;
    }
    return undefined;
  }

  public list(): ReadonlyArray<{ id: string; name: string; available: boolean }> {
    return Array.from(this.providers.values()).map((p) => ({ id: p.id, name: p.name, available: p.isAvailable() }));
  }
}

export const imageProviderRegistry = new ImageProviderRegistry();
