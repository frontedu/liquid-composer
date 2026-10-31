import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';

export const REPO = fileURLToPath(new URL('../..', import.meta.url));

const SOURCE_TYPES = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const SWIFTSHADER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const GPU_ARGS = ['--enable-gpu', '--ignore-gpu-blocklist'];

export class AgentError extends Error {
  constructor(code, message, issues) {
    super(message);
    this.code = code;
    this.issues = issues;
  }

  toJSON() {
    return { code: this.code, message: this.message, ...(this.issues && { issues: this.issues }) };
  }
}

export function errorJson(err) {
  return err instanceof AgentError ? err.toJSON() : { code: 'internal', message: err?.message ?? String(err) };
}

let recipeModule;

export async function loadRecipeModule() {
  if (!recipeModule) {
    const { runnerImport } = await import('vite');
    ({ module: recipeModule } = await runnerImport(join(REPO, 'src/agent/recipe.ts'), { root: REPO, configFile: false, logLevel: 'silent' }));
  }
  return recipeModule;
}

export async function checkRecipe(input) {
  const { RecipeSchema, formatIssues } = await loadRecipeModule();
  const result = RecipeSchema.safeParse(input);
  if (result.success) return result.data;
  const issues = formatIssues(result.error.issues);
  throw new AgentError('invalid_input', `Invalid recipe: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`, issues);
}

export async function readJson(file) {
  const text = await readFile(file, 'utf8').catch(() => { throw new AgentError('not_found', `File not found: ${file}`); });
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new AgentError('invalid_json', `${file}: ${err.message}`);
  }
}

// ── Sources ──

export async function resolveSources(recipe, baseDir) {
  const { sourceType } = await loadRecipeModule();
  const resolveLayer = async (layer, path) => {
    if (layer.type === 'group') {
      return { ...layer, layers: await Promise.all((layer.layers ?? []).map((l, i) => resolveLayer(l, `${path}.layers.${i}`))) };
    }
    if (!layer.src || sourceType(layer.src) !== 'path') return layer;
    const file = resolve(baseDir, layer.src);
    const type = SOURCE_TYPES[extname(file).toLowerCase()];
    const fail = (message) => new AgentError('invalid_image', `${path}.src: ${message}`, [{ path: `${path}.src`, message }]);
    if (!type) throw fail(`unsupported file type ${extname(file) || '(none)'}; use svg, png or jpeg`);
    const data = await readFile(file).catch(() => { throw fail(`file not found: ${file}`); });
    return { ...layer, src: `data:${type};base64,${data.toString('base64')}` };
  };
  return { ...recipe, layers: await Promise.all((recipe.layers ?? []).map((l, i) => resolveLayer(l, `layers.${i}`))) };
}

export async function readIconFile(file) {
  const info = await stat(file).catch(() => { throw new AgentError('not_found', `File not found: ${file}`); });
  if (!info.isDirectory()) return { icon: (await readFile(file)).toString('base64'), name: basename(file) };
  const files = {};
  for (const entry of await readdir(file, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = join(entry.parentPath, entry.name);
    files[`${basename(file)}/${relative(file, full).split('\\').join('/')}`] = await readFile(full);
  }
  return { icon: Buffer.from(zipSync(files)).toString('base64'), name: basename(file) };
}

export async function writeFiles(files, outDir) {
  const written = [];
  const put = async (path, data) => {
    const target = resolve(outDir, path);
    if (relative(outDir, target).startsWith('..')) throw new AgentError('invalid_output', `Refusing to write outside ${outDir}: ${path}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
    return target;
  };
  for (const { path, base64 } of files) {
    const data = Buffer.from(base64, 'base64');
    if (!path.endsWith('.icon.zip')) {
      written.push(await put(path, data));
      continue;
    }
    const entries = unzipSync(data);
    for (const [name, bytes] of Object.entries(entries)) if (!name.endsWith('/')) await put(name, bytes);
    const roots = new Set(Object.keys(entries).map((name) => name.split('/')[0]));
    roots.forEach((root) => written.push(resolve(outDir, root)));
  }
  return written;
}

// ── Target and browser ──

async function newestMtime(dir) {
  let newest = 0;
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) newest = Math.max(newest, (await stat(join(entry.parentPath, entry.name))).mtimeMs);
  }
  return newest;
}

async function startTarget(target, warnings) {
  if (/^https?:\/\//i.test(target)) return { url: target, close: async () => {} };
  const vite = await import('vite');
  if (target === 'dev') {
    const server = await vite.createServer({ root: REPO, logLevel: 'silent', server: { host: '127.0.0.1' } });
    await server.listen();
    return { url: server.resolvedUrls.local[0], close: () => server.close() };
  }
  if (target !== 'dist') throw new AgentError('invalid_input', `--target must be dist, dev or a URL, got "${target}"`);
  const built = await stat(join(REPO, 'dist/index.html')).catch(() => null);
  if (!built) throw new AgentError('no_build', 'dist/ not found: run npm run build first, or pass --target dev');
  const checkout = await stat(join(REPO, 'index.html')).catch(() => null);
  if (checkout && await newestMtime(join(REPO, 'src')) > built.mtimeMs) warnings.push('dist/ is older than src/; run npm run build to render with the current code');
  const server = await vite.preview({ root: REPO, configFile: false, logLevel: 'silent', preview: { host: '127.0.0.1' } });
  return { url: server.resolvedUrls.local[0], close: () => server.close() };
}

export async function openSession({ target = 'dist', gpu = false, allowFallback = false } = {}) {
  const { API_VERSION } = await loadRecipeModule();
  const warnings = [];
  const server = await startTarget(target, warnings);
  let browser;
  try {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: gpu ? GPU_ARGS : SWIFTSHADER_ARGS }).catch((err) => {
      throw new AgentError('no_browser', `Could not start Google Chrome (install it, playwright-core uses the system Chrome): ${err.message.split('\n')[0]}`);
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    page.on('console', (msg) => { if (msg.type() === 'warning' || msg.type() === 'error') warnings.push(msg.text()); });
    page.on('pageerror', (err) => warnings.push(err.message));
    const url = new URL(server.url);
    url.searchParams.set('agent', '');
    await page.goto(url.href);
    await page.waitForFunction(() => window.liquidComposer, null, { timeout: 30000 }).catch(() => {
      throw new AgentError('no_agent_api', `${server.url} does not expose window.liquidComposer; rebuild it or check the URL`);
    });
    const version = await page.evaluate(async () => { await window.liquidComposer.ready; return window.liquidComposer.version; });
    if (version !== API_VERSION) throw new AgentError('version_mismatch', `${server.url} speaks agent API v${version}, this CLI speaks v${API_VERSION}`);
    const renderer = await page.evaluate((mode) => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      return { mode, gpu: gl ? gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : null };
    }, gpu ? 'gpu' : 'swiftshader');

    const call = async (method, ...args) => {
      const result = await page.evaluate(async ([m, a]) => {
        try {
          return { ok: true, value: await window.liquidComposer[m](...a) };
        } catch (err) {
          return { ok: false, error: { code: err.code ?? 'internal', message: err.message, issues: err.issues } };
        }
      }, [method, args]);
      if (!result.ok) throw new AgentError(result.error.code, result.error.message, result.error.issues);
      if ((method === 'render' || method === 'export') && !allowFallback) {
        const webgl = await page.evaluate(() => window.liquidComposer.state().webgl);
        if (webgl !== 'active') {
          throw new AgentError('webgl_unavailable', 'WebGL2 is not active, so the Canvas 2D fallback would render without refraction and blur; pass --allow-fallback to accept it');
        }
      }
      return result.value;
    };

    return {
      call,
      renderer,
      drainWarnings: () => warnings.splice(0),
      close: async () => {
        await browser.close();
        await server.close();
      },
    };
  } catch (err) {
    await browser?.close();
    await server.close();
    throw err;
  }
}
