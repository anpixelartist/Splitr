import type { McpServer, CallToolResult } from '@modelcontextprotocol/server';
import { FirestoreError } from '../firestore';
import { FirebaseAuthError } from '../token';
import { UserFacingError } from '../group';
import type { Session } from '../session';
import { formatDate, formatDay } from '../../../src/lib/money';

export type ToolDeps = { session: Session; now?: () => number };
export type RegisterTool = (server: McpServer, deps: ToolDeps) => void;

/** Read-only tools: safe to call without asking. */
export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export const text = (s: string): CallToolResult => ({ content: [{ type: 'text', text: s }] });
const failure = (s: string): CallToolResult => ({ content: [{ type: 'text', text: s }], isError: true });

/** Runs a tool body and turns expected failures into messages the assistant can relay. */
export async function run(body: () => Promise<string>): Promise<CallToolResult> {
  try {
    return text(await body());
  } catch (err) {
    if (err instanceof UserFacingError) return failure(err.message);
    if (err instanceof FirebaseAuthError) {
      return failure(err.permanent
        ? 'Your Splitr sign-in has expired or was revoked. Disconnect and reconnect Splitr in your assistant\'s connector settings.'
        : err.message);
    }
    if (err instanceof FirestoreError && err.permissionDenied) {
      return failure('Splitr refused this: you don\'t have access to that (only group members can see or change a group\'s data).');
    }
    console.error('[splitr-mcp] tool failed', err);
    return failure('Something went wrong talking to Splitr. Please try again.');
  }
}

/** "24 Oct 2026", never 10/24/2026. */
export const day = (v: string | number) => formatDate(v, 'en-GB');

/** When an expense was spent: its date, or when it was added for older ones. */
export const spentOn = (e: { date?: string; createdAt: string }) => (e.date ? formatDay(e.date, 'en-GB') : day(e.createdAt));

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Tools that save something: the assistant should check with the user first. */
export const WRITES = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
