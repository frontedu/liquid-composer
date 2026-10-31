import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { API_VERSION, GUIDE, LayerPatchSchema, RecipeSchema, encodeRecipe, formatIssues, recipeLayers, sourceType, type Issue, type Recipe } from '../src/agent/recipe.js';

const MAX_BODY = 1024 * 1024;
const MAX_RECIPE = 512 * 1024;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': '*', 'Access-Control-Max-Age': '7200' };

function check(input: unknown): { recipe: Recipe; issues: [] } | { recipe: null; issues: Issue[] } {
  const result = RecipeSchema.safeParse(input);
  if (!result.success) return { recipe: null, issues: formatIssues(result.error.issues) };
  const issues = recipeLayers(result.data)
    .filter(({ layer }) => layer.type !== 'group' && layer.src && sourceType(layer.src) === 'path')
    .map(({ path }) => ({ path: [...path, 'src'].join('.'), message: 'Remote recipes need inline SVG markup or a data: URL; file paths only work with the local CLI and MCP server' }));
  if (JSON.stringify(result.data).length > MAX_RECIPE) issues.push({ path: '(root)', message: `Recipe larger than ${MAX_RECIPE / 1024} KB` });
  return issues.length ? { recipe: null, issues } : { recipe: result.data, issues: [] };
}

function createServer(appUrl: string) {
  const server = new McpServer({
    name: 'liquid-composer',
    title: 'Liquid Composer',
    version: String(API_VERSION),
    websiteUrl: appUrl,
    icons: [{ src: `${appUrl}/icon-512.png`, mimeType: 'image/png', sizes: ['512x512'] }],
  }, {
    instructions: `Liquid Composer designs Liquid Glass app icons (iOS 27, Icon Composer 2). This remote server cannot render: write a recipe, check it with liquid_validate, then call liquid_open and give the user the link; the icon opens in their browser, where they can export PNG, the all-appearances zip or .icon.\n\n${GUIDE}`,
  });
  const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

  server.registerTool('liquid_schema', {
    title: 'Recipe schema',
    description: 'JSON Schema of recipes and layer patches, and the guide.',
    annotations: { title: 'Recipe schema', readOnlyHint: true, openWorldHint: false },
  }, () => json({
    version: API_VERSION,
    guide: GUIDE,
    recipe: z.toJSONSchema(RecipeSchema, { io: 'input' }),
    patch: z.toJSONSchema(LayerPatchSchema, { io: 'input' }),
  }));

  server.registerTool('liquid_validate', {
    title: 'Validate recipe',
    description: 'Check a recipe without opening it; returns ok or the list of issues with their paths.',
    inputSchema: { recipe: z.unknown() },
    annotations: { title: 'Validate recipe', readOnlyHint: true, openWorldHint: false },
  }, ({ recipe }) => {
    const { issues } = check(recipe);
    return json(issues.length ? { ok: false, issues } : { ok: true });
  });

  server.registerTool('liquid_open', {
    title: 'Open in Liquid Composer',
    description: 'Turn a recipe into a link that opens the icon in Liquid Composer. The link carries the recipe in its URL fragment, so opening it does not send the recipe to a server. Images must be inline SVG markup or data: URLs.',
    inputSchema: { recipe: RecipeSchema },
    annotations: { title: 'Open in Liquid Composer', readOnlyHint: true, openWorldHint: false },
  }, ({ recipe }) => {
    const checked = check(recipe);
    if (!checked.recipe) return { ...json({ ok: false, issues: checked.issues }), isError: true };
    return json({ ok: true, url: `${appUrl}/#r=${encodeRecipe(checked.recipe)}` });
  });

  return server;
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST, OPTIONS', ...CORS } });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: MAX_BODY });
    await createServer(new URL(request.url).origin).connect(transport);
    const response = await transport.handleRequest(request);
    for (const [key, value] of Object.entries(CORS)) response.headers.set(key, value);
    return response;
  },
};
