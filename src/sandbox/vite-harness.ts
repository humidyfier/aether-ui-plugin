import * as http from 'node:http';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { ShadowWorktree } from './shadow-worktree';

export interface ViteHarnessConfig {
  port: number;
  host?: string;
  enableBridgeInjection?: boolean;
  bridgeWsPort?: number;
  mode?: 'mock_http' | 'live_vite';
}

import { isAllowedOrigin } from '../server/studio-server';

export function getViteSecurityHeaders(origin?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Security-Policy': "frame-ancestors 'self' http://127.0.0.1:* http://localhost:* vscode-webview: file: hermes: *;",
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'X-Content-Type-Options': 'nosniff',
  };
  if (origin && isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return headers;
}

export const VITE_HARNESS_FRAMING_HEADERS = {
  'Content-Security-Policy': "frame-ancestors 'self' http://127.0.0.1:* http://localhost:* vscode-webview: file: hermes: *;",
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'X-Content-Type-Options': 'nosniff',
};

export async function verifyHttpReachable(
  targetUrl: string,
  timeoutMs = 2000
): Promise<{ ok: boolean; status?: number; contentType?: string; error?: string }> {
  try {
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(timeoutMs) });
    const contentType = res.headers.get('content-type') || undefined;
    return {
      ok: res.ok,
      status: res.status,
      contentType,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err.message || String(err),
    };
  }
}

export class ViteHarness {
  private server: http.Server | any = null;
  private port: number;
  private host: string;
  private isRunning = false;
  private worktree: ShadowWorktree;
  private bridgeWsPort: number;
  private mode: 'mock_http' | 'live_vite';

  constructor(worktree: ShadowWorktree, config: ViteHarnessConfig) {
    this.worktree = worktree;
    this.port = config.port;
    // Strict loopback security: bind to 127.0.0.1 by default (never 0.0.0.0)
    const rawHost = config.host || '127.0.0.1';
    this.host = rawHost === '0.0.0.0' ? '127.0.0.1' : rawHost;
    this.bridgeWsPort = config.bridgeWsPort || config.port + 1000;
    this.mode = config.mode || 'mock_http';
  }

  public getPort(): number {
    return this.port;
  }

  public getHost(): string {
    return this.host;
  }

  public getMode(): 'mock_http' | 'live_vite' {
    return this.mode;
  }

  public getPreviewUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  public isServerRunning(): boolean {
    return this.isRunning;
  }

  public getStatus(): 'RUNNING' | 'STOPPED' {
    return this.isRunning ? 'RUNNING' : 'STOPPED';
  }

  /**
   * Returns a custom Vite plugin that injects the Fiber bridge client snippet into HTML head.
   */
  public createAetherBridgePlugin(): any {
    const bridgeWsPort = this.bridgeWsPort;
    return {
      name: 'aether-fiber-bridge-plugin',
      transformIndexHtml(html: string) {
        const snippet = `
    <!-- Aether Runtime Fiber Bridge Injection -->
    <script>
      window.__AETHER_BRIDGE_WS_PORT__ = ${bridgeWsPort};
    </script>
    <script type="module" src="/.aether-runtime/fiber-bridge-client.js"></script>
`;
        if (!html.includes('__AETHER_BRIDGE_WS_PORT__')) {
          return html.replace('</head>', `${snippet}\n  </head>`);
        }
        return html;
      },
    };
  }

  /**
   * Generates or updates vite.config.ts in the shadow worktree.
   */
  public generateViteConfig(): void {
    const configContent = `
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: ${this.port},
    host: '${this.host}',
    strictPort: true,
    headers: {
      'Content-Security-Policy': "frame-ancestors 'self' http://127.0.0.1:* http://localhost:* vscode-webview:;",
      'Access-Control-Allow-Origin': '*',
    },
    hmr: {
      clientPort: ${this.port},
    },
  },
});
`;
    this.worktree.writeCandidateFile('vite.config.ts', configContent.trim());
  }

  /**
   * Injects the client-side Fiber bridge hook tag into index.html if not already present.
   */
  public injectBridgeScriptIntoIndexHtml(): void {
    if (!this.worktree.existsFile('index.html')) {
      return;
    }

    const currentHtml = this.worktree.readFile('index.html');
    const injectionSnippet = `
    <!-- Aether Runtime Fiber Bridge Injection -->
    <script>
      window.__AETHER_BRIDGE_WS_PORT__ = ${this.bridgeWsPort};
    </script>
    <script type="module" src="/.aether-runtime/fiber-bridge-client.js"></script>
    `;

    if (!currentHtml.includes('__AETHER_BRIDGE_WS_PORT__')) {
      const updatedHtml = currentHtml.replace('</head>', `${injectionSnippet}\n  </head>`);
      this.worktree.writeCandidateFile('index.html', updatedHtml);
    }
  }

  /**
   * Starts a preview server (either programmatic live Vite or lightweight mock HTTP server).
   */
  public async start(): Promise<string> {
    if (this.isRunning) {
      return this.getPreviewUrl();
    }

    this.generateViteConfig();
    this.injectBridgeScriptIntoIndexHtml();

    if (this.mode === 'live_vite') {
      try {
        const viteModule: any = await (Function('return import("vite")')());
        const viteServer = await viteModule.createServer({
          root: this.worktree.getWorktreePath(),
          server: {
            port: this.port,
            host: this.host,
            strictPort: true,
            headers: {
              'Content-Security-Policy': "frame-ancestors 'self' http://127.0.0.1:* http://localhost:* vscode-webview:;",
              'Access-Control-Allow-Origin': '*',
            },
            hmr: {
              clientPort: this.port,
            },
          },
          plugins: [this.createAetherBridgePlugin()],
        });
        await viteServer.listen();
        this.server = viteServer;
        this.isRunning = true;
        return this.getPreviewUrl();
      } catch (err: any) {
        // Fallback to mock_http mode gracefully if vite is not found
        console.warn(
          `[ViteHarness] Programmatic Vite start failed (${err.message}). Falling back to mock_http mode.`
        );
        this.mode = 'mock_http';
      }
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        try {
          const origin = req.headers.origin as string | undefined;
          if (origin && !isAllowedOrigin(origin)) {
            res.writeHead(403, {
              ...getViteSecurityHeaders(),
              'Content-Type': 'application/json',
            });
            res.end(JSON.stringify({ error: 'Forbidden: Untrusted cross-origin request rejected' }));
            return;
          }

          if (req.method === 'OPTIONS') {
            res.writeHead(204, getViteSecurityHeaders(origin));
            res.end();
            return;
          }

          const reqUrl = req.url || '/';
          let relativePath = reqUrl.split('?')[0];
          if (relativePath === '/' || relativePath === '') {
            relativePath = 'index.html';
          }
          if (relativePath.startsWith('/')) {
            relativePath = relativePath.slice(1);
          }

          if (this.worktree.existsFile(relativePath)) {
            const content = this.worktree.readFile(relativePath);
            const ext = path.extname(relativePath).toLowerCase();
            const mimeTypes: Record<string, string> = {
              '.html': 'text/html',
              '.js': 'application/javascript',
              '.ts': 'application/typescript',
              '.tsx': 'text/plain',
              '.css': 'text/css',
              '.json': 'application/json',
            };

            res.writeHead(200, {
              ...getViteSecurityHeaders(origin),
              'Content-Type': mimeTypes[ext] || 'text/plain',
            });
            res.end(content);
          } else {
            // SPA fallback: return index.html if available
            if (this.worktree.existsFile('index.html')) {
              const html = this.worktree.readFile('index.html');
              res.writeHead(200, {
                ...getViteSecurityHeaders(origin),
                'Content-Type': 'text/html',
              });
              res.end(html);
            } else {
              res.writeHead(404, {
                ...getViteSecurityHeaders(origin),
                'Content-Type': 'text/plain',
              });
              res.end(`File ${relativePath} not found in sandbox.`);
            }
          }
        } catch (err: any) {
          res.writeHead(500, {
            ...getViteSecurityHeaders(),
            'Content-Type': 'text/plain',
          });
          res.end(`Internal sandbox error: ${err.message}`);
        }
      });

      this.server.listen(this.port, this.host, () => {
        this.isRunning = true;
        resolve(this.getPreviewUrl());
      });

      this.server.on('error', (err: any) => {
        reject(err);
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.server || !this.isRunning) {
      return;
    }

    if (this.mode === 'live_vite' && typeof this.server.close === 'function') {
      try {
        await this.server.close();
      } finally {
        this.isRunning = false;
        this.server = null;
      }
      return;
    }

    return new Promise((resolve) => {
      this.server.close(() => {
        this.isRunning = false;
        this.server = null;
        resolve();
      });
    });
  }
}
