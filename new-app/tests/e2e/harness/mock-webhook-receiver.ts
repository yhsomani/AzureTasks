import http from 'node:http';
import { AddressInfo } from 'node:net';

export interface WebhookRecord {
  channel: 'teams' | 'slack' | string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: any;
  timestamp: number;
}

export class MockWebhookReceiver {
  private server: http.Server | null = null;
  private port: number = 0;
  private records: WebhookRecord[] = [];
  private failNextStatus: number | null = null;

  public clear(): void {
    this.records = [];
    this.failNextStatus = null;
  }

  public getWebhooks(): WebhookRecord[] {
    return [...this.records];
  }

  public getTeamsWebhooks(): WebhookRecord[] {
    return this.records.filter((r) => r.channel === 'teams' || r.url.includes('/webhook/teams'));
  }

  public getSlackWebhooks(): WebhookRecord[] {
    return this.records.filter((r) => r.channel === 'slack' || r.url.includes('/webhook/slack'));
  }

  public setFailNext(statusCode: number): void {
    this.failNextStatus = statusCode;
  }

  public async waitForWebhook(
    predicate: (rec: WebhookRecord) => boolean,
    timeoutMs = 3000
  ): Promise<WebhookRecord> {
    const existing = this.records.find(predicate);
    if (existing) return existing;

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 50));
      const found = this.records.find(predicate);
      if (found) return found;
    }
    throw new Error(`Timed out waiting for webhook after ${timeoutMs}ms`);
  }

  public async start(): Promise<string> {
    if (this.server) {
      return `http://127.0.0.1:${this.port}`;
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        try {
          await this.handleRequest(req, res);
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err?.message || 'Mock Webhook error' }));
        }
      });

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address() as AddressInfo;
        this.port = addr.port;
        resolve(`http://127.0.0.1:${this.port}`);
      });

      this.server.on('error', reject);
    });
  }

  public async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve, reject) => {
      this.server!.close((err) => {
        this.server = null;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public getBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  public getTeamsUrl(): string {
    return `${this.getBaseUrl()}/webhook/teams`;
  }

  public getSlackUrl(): string {
    return `${this.getBaseUrl()}/webhook/slack`;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const rawUrl = req.url || '/';
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    await new Promise((r) => req.on('end', r));

    const rawBody = Buffer.concat(chunks).toString('utf8');
    let parsedBody: any = rawBody;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      // plain text or form
    }

    let channel = 'generic';
    if (rawUrl.includes('/webhook/teams')) channel = 'teams';
    else if (rawUrl.includes('/webhook/slack')) channel = 'slack';

    const record: WebhookRecord = {
      channel,
      url: rawUrl,
      headers: req.headers,
      body: parsedBody,
      timestamp: Date.now(),
    };
    this.records.push(record);

    if (this.failNextStatus) {
      const code = this.failNextStatus;
      this.failNextStatus = null;
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Webhook delivery failed' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, received: true }));
  }
}
