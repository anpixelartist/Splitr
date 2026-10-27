// Splitr connector: a remote MCP server on Cloudflare Workers.
//
//   /mcp                     MCP (Streamable HTTP), needs an OAuth access token
//   /authorize               consent + "Sign in with Google" page (auth.ts)
//   /oauth/token, /oauth/register, /.well-known/*   served by the OAuth library
//
// Every tool reads and writes Firestore as the signed-in person (see
// firestore.ts), so firestore.rules stay the only source of truth for access.

import { OAuthProvider, GrantType } from '@cloudflare/workers-oauth-provider';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { checkGrantOnRefresh, handleAuthorize, type Env, type Props } from './auth';
import { buildServer } from './server';

type Extra = { env: Env; props: Props };

// Stateless: every request gets a fresh server bound to that request's user.
const mcp = createMcpHandler(ctx => {
  const { env, props } = ctx.authInfo!.extra as Extra; // set by mcpApi below
  return buildServer(env, props);
});

const mcpApi: ExportedHandler<Env> = {
  fetch(request, env, ctx) {
    const props = (ctx as ExecutionContext & { props: Props }).props;
    const extra: Extra = { env, props };
    return mcp.fetch(request as Request, { authInfo: { token: '', clientId: '', scopes: [], extra } });
  },
};

const DAY = 24 * 60 * 60;

// The OAuth provider needs its public URL (for the resource and issuer), which
// is only known from the request: build one per origin and keep it.
const providers = new Map<string, OAuthProvider<Env>>();
function providerFor(origin: string): OAuthProvider<Env> {
  let p = providers.get(origin);
  if (!p) {
    p = new OAuthProvider<Env>({
      apiRoute: '/mcp',
      apiHandler: mcpApi as never,
      defaultHandler: {
        fetch: (request, env) => {
          const { pathname } = new URL(request.url);
          if (pathname === '/authorize') return handleAuthorize(request as Request, env);
          if (pathname === '/' && request.method === 'GET') return new Response('Splitr MCP connector. Add <origin>/mcp as a custom connector in your assistant.\n'.replace('<origin>', origin), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
          return new Response('Not found', { status: 404 });
        },
      },
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/oauth/token',
      clientRegistrationEndpoint: '/oauth/register',
      clientIdMetadataDocumentEnabled: true,
      resourceMetadata: {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        resource_name: 'Splitr',
      },
      // Stay connected while the assistant keeps using it
      refreshTokenTTL: 90 * DAY,
      refreshTokenIdleTTL: 90 * DAY,
      tokenExchangeCallback: async ({ grantType, props, env }) =>
        grantType === GrantType.REFRESH_TOKEN ? checkGrantOnRefresh(env, props as Props) : undefined,
    });
    providers.set(origin, p);
  }
  return p;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return providerFor(new URL(request.url).origin).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
