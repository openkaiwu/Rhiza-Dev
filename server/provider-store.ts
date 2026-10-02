import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { ProviderData } from './provider-domain';

const emptyData = (): ProviderData => ({ providers: [], models: [], activeModelId: null, updatedAt: new Date().toISOString() });

export class ProviderStore {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly filePath = resolve('var/data/providers.json')) {}

  async read(): Promise<ProviderData> {
    try { return JSON.parse(await readFile(this.filePath, 'utf8')) as ProviderData; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const initial = emptyData();
      await this.write(initial);
      return initial;
    }
  }

  async update(mutator: (data: ProviderData) => ProviderData | Promise<ProviderData>): Promise<ProviderData> {
    let result!: ProviderData;
    const operation = this.queue.then(async () => {
      result = await mutator(structuredClone(await this.read()));
      result.updatedAt = new Date().toISOString();
      await this.write(result);
    });
    // A rejected save belongs to that caller; later commands must still run.
    this.queue = operation.catch(() => undefined);
    await operation;
    return result;
  }

  private async write(data: ProviderData) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(temporary, this.filePath);
  }
}
