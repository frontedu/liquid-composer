import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { errorJson, loadRecipeModule, openSession, readIconFile, resolveSources, writeFiles } from './session.mjs';

export async function startMcp(options) {
  const { API_VERSION, APPEARANCES, GUIDE, LayerPatchSchema, OutputSchema, RecipeSchema } = await loadRecipeModule();
  let session;
  let queue = Promise.resolve();

  const getSession = () => {
    session ??= openSession(options).catch((err) => {
      session = undefined;
      throw err;
    });
    return session;
  };

  const text = (value) => ({ type: 'text', text: JSON.stringify(value, null, 2) });
  const image = (data) => ({ type: 'image', data, mimeType: 'image/png' });
  const tool = (fn) => (args) => (queue = queue.then(async () => {
    try {
      return { content: await fn(args, await getSession()) };
    } catch (err) {
      return { isError: true, content: [text(errorJson(err))] };
    }
  }));
  const report = async (s, state, preview = true) => [
    text({ state, warnings: s.drainWarnings(), renderer: s.renderer }),
    ...(preview ? [image(await s.call('render', { size: 512 }))] : []),
  ];

  const server = new McpServer({
    name: 'liquid-composer',
    title: 'Liquid Composer',
    version: String(API_VERSION),
    websiteUrl: 'https://liquid-composer.vercel.app',
    icons: [{ src: 'https://liquid-composer.vercel.app/icon-512.png', mimeType: 'image/png', sizes: ['512x512'] }],
  }, {
    instructions: `Liquid Composer renders Liquid Glass app icons (iOS 27, Icon Composer 2) in headless Chrome. Call liquid_schema once, build the icon with liquid_apply, look at the preview, refine with liquid_update or another liquid_apply, then write files with liquid_export.\n\n${GUIDE}`,
  });

  server.registerTool('liquid_schema', {
    title: 'Recipe schema',
    description: 'JSON Schema of recipes and layer patches, default values (including the Advanced effects keys) and the guide.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, tool(async (_args, s) => [text(await s.call('schema'))]));

  server.registerTool('liquid_apply', {
    title: 'Apply recipe',
    description: 'Replace the icon with a recipe; returns the state and a 512 px preview. src can be a file path (relative to baseDir or the server working directory), inline SVG or a data: URL. outputs are ignored here: write files with liquid_export.',
    inputSchema: { recipe: RecipeSchema, baseDir: z.string().optional().describe('Directory for relative src paths') },
    annotations: { idempotentHint: true, openWorldHint: false },
  }, tool(async ({ recipe, baseDir }, s) => report(s, await s.call('apply', await resolveSources(recipe, resolve(baseDir ?? '.'))))));

  server.registerTool('liquid_update', {
    title: 'Update layer',
    description: 'Change one layer or group by name or id: layout, liquidGlass and fill merge into the current values. Returns the state and a 512 px preview.',
    inputSchema: { layer: z.string().describe('Layer name or id'), patch: LayerPatchSchema, baseDir: z.string().optional() },
    annotations: { openWorldHint: false },
  }, tool(async ({ layer, patch, baseDir }, s) => {
    const [resolved] = (await resolveSources({ layers: [patch] }, resolve(baseDir ?? '.'))).layers;
    return report(s, await s.call('update', layer, resolved));
  }));

  server.registerTool('liquid_render', {
    title: 'Render preview',
    description: 'Render the current icon as a PNG image to look at. Use liquid_export for files and sizes above 1024.',
    inputSchema: {
      size: z.int().min(16).max(1024).default(512),
      mode: z.enum(APPEARANCES).optional().describe('Appearance; defaults to the document appearance'),
      bare: z.boolean().optional().describe('Artwork only, without the squircle'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, tool(async (args, s) => [image(await s.call('render', args)), text({ warnings: s.drainWarnings() })]));

  server.registerTool('liquid_export', {
    title: 'Export files',
    description: 'Write PNG or JPEG renders, the all-appearances zip, or an Icon Composer .icon folder to a directory. Returns the written paths.',
    inputSchema: {
      outputs: z.array(OutputSchema).min(1).default([{}]),
      out: z.string().optional().describe('Directory, created if needed; defaults to the server working directory'),
    },
    annotations: { openWorldHint: false },
  }, tool(async ({ outputs, out }, s) => {
    const files = [];
    for (const output of outputs) files.push(...await writeFiles(await s.call('export', output), resolve(out ?? options.out)));
    return [text({ files, warnings: s.drainWarnings() })];
  }));

  server.registerTool('liquid_state', {
    title: 'Document state',
    description: 'The current document: name, appearance, background and layers top to bottom, without image data.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, tool(async (_args, s) => [text(await s.call('state'))]));

  server.registerTool('liquid_import_icon', {
    title: 'Open .icon',
    description: 'Open an Icon Composer document (.icon folder or zip) from disk, replacing the icon; returns the state and a 512 px preview.',
    inputSchema: { path: z.string(), preview: z.boolean().default(true) },
    annotations: { openWorldHint: false },
  }, tool(async ({ path, preview }, s) => report(s, await s.call('load', await readIconFile(resolve(path))), preview)));

  const shutdown = async () => {
    const open = await session?.catch(() => null);
    await open?.close().catch(() => {});
    process.exit(0);
  };
  process.stdin.on('end', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await server.connect(new StdioServerTransport());
}
