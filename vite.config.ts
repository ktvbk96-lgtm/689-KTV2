import 'dotenv/config';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';

const API_ROUTE_MAP: Record<string, string> = {
  '/api/sync': '/api/sync.ts',
  '/api/sync/version': '/api/sync/version.ts',
  '/api/health': '/api/health.ts',
  '/api/gas-proxy': '/api/gas-proxy.ts',
  '/api/vercel-blob/token': '/api/vercel-blob/token.ts',
  '/api/vercel-blob/upload': '/api/vercel-blob/upload.ts',
  '/api/upload-image': '/api/upload-image.ts',
};

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function vercelApiDevPlugin(): Plugin {
  return {
    name: 'vercel-api-dev-middleware',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const rawUrl = req.url || '/';
        const parsedUrl = new URL(rawUrl, 'http://localhost:3000');
        const pathname = parsedUrl.pathname;

        // Serve locally saved upload images if any exist in .data/uploads
        if (pathname.startsWith('/uploads/')) {
          const safeName = path.basename(pathname);
          const filePath = path.resolve(process.cwd(), '.data', 'uploads', safeName);
          if (fs.existsSync(filePath)) {
            const ext = path.extname(safeName).toLowerCase();
            const mime =
              ext === '.png'
                ? 'image/png'
                : ext === '.webp'
                ? 'image/webp'
                : ext === '.gif'
                ? 'image/gif'
                : 'image/jpeg';
            res.setHeader('Content-Type', mime);
            fs.createReadStream(filePath).pipe(res);
            return;
          }
        }

        const handlerFile = API_ROUTE_MAP[pathname];
        if (!handlerFile) {
          return next();
        }

        try {
          const query: Record<string, string> = {};
          parsedUrl.searchParams.forEach((v, k) => {
            query[k] = v;
          });

          let parsedBody: any = undefined;
          if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
            const rawBody = await readRequestBody(req);
            if (rawBody) {
              try {
                parsedBody = JSON.parse(rawBody);
              } catch {
                parsedBody = rawBody;
              }
            }
          }

          const vercelReq: any = Object.assign(req, {
            query,
            body: parsedBody,
          });

          const vercelRes: any = Object.assign(res, {
            status(code: number) {
              res.statusCode = code;
              return vercelRes;
            },
            json(payload: any) {
              if (!res.headersSent) {
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
              }
              res.end(JSON.stringify(payload));
              return vercelRes;
            },
            send(payload: any) {
              if (typeof payload === 'object' && payload !== null && !Buffer.isBuffer(payload)) {
                return vercelRes.json(payload);
              }
              res.end(payload);
              return vercelRes;
            },
          });

          const mod = await server.ssrLoadModule(handlerFile);
          if (typeof mod?.default === 'function') {
            await mod.default(vercelReq, vercelRes);
            return;
          }
          res.statusCode = 500;
          res.end(JSON.stringify({ error: `Invalid handler in ${handlerFile}` }));
        } catch (err: any) {
          console.error(`Dev API error for ${pathname}:`, err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
          }
          res.end(JSON.stringify({ success: false, error: err?.message || 'Internal Server Error' }));
        }
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), vercelApiDevPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    define: {
      'process.env.BLOB_READ_WRITE_TOKEN': JSON.stringify(process.env.BLOB_READ_WRITE_TOKEN || ''),
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
