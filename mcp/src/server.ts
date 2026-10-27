// The MCP server: Splitr's tools, bound to one signed-in person.

import { McpServer } from '@modelcontextprotocol/server';
import type { Env, Props } from './token';
import { createSession } from './session';
import type { RegisterTool } from './tools/common';
import { registerListGroups } from './tools/listGroups';
import { registerGroupSummary } from './tools/groupSummary';
import { registerListExpenses } from './tools/listExpenses';
import { registerMyBalances } from './tools/myBalances';
import { registerPendingPayments } from './tools/pendingPayments';

export const TOOLS: RegisterTool[] = [
  registerListGroups,
  registerGroupSummary,
  registerListExpenses,
  registerMyBalances,
  registerPendingPayments,
];

const INSTRUCTIONS =
  'Splitr is a bill-splitting app. These tools act as the signed-in user, with the same access they have in the app. ' +
  'Groups are found by name or code; when a name matches several groups, ask the user which one. ' +
  'Amounts are in each group\'s own currency; never add amounts in different currencies together.';

export function buildServer(env: Env, props: Props): McpServer {
  const server = new McpServer({ name: 'splitr', title: 'Splitr', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  const session = createSession(env, props);
  for (const register of TOOLS) register(server, { session });
  return server;
}
