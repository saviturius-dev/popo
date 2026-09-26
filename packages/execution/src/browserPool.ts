import type { Browser, BrowserContext, Page } from 'playwright';

export interface BrowserPoolOptions {
  headless?: boolean;
  artifactsDir?: string;
  slowMo?: number;
}

/**
 * One browser context and one page per run.
 *
 * State has to persist across steps — a message typed in one step is submitted
 * by the next — so pages are keyed by run id and torn down when the run ends.
 */
export class BrowserPool {
  private browser?: Browser;
  private contexts = new Map<string, BrowserContext>();
  private pages = new Map<string, Page>();
  private readonly options: BrowserPoolOptions;

  constructor(options: BrowserPoolOptions = {}) {
    this.options = options;
  }

  async pageFor(runId: string): Promise<Page> {
    const existing = this.pages.get(runId);
    if (existing && !existing.isClosed()) return existing;

    const browser = await this.launch();
    let context = this.contexts.get(runId);
    if (!context) {
      context = await browser.newContext({
        acceptDownloads: true,
        viewport: { width: 1280, height: 900 },
      });
      this.contexts.set(runId, context);
    }
    const page = await context.newPage();
    this.pages.set(runId, page);
    return page;
  }

  async closeRun(runId: string): Promise<void> {
    const context = this.contexts.get(runId);
    this.contexts.delete(runId);
    this.pages.delete(runId);
    await context?.close().catch(() => undefined);
  }

  async close(): Promise<void> {
    this.pages.clear();
    this.contexts.clear();
    await this.browser?.close().catch(() => undefined);
    this.browser = undefined;
  }

  private async launch(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    const { chromium } = await import('playwright');
    this.browser = await chromium.launch({
      headless: this.options.headless ?? true,
      slowMo: this.options.slowMo ?? 0,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    return this.browser;
  }
}
