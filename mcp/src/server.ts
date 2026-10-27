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
import { registerAddExpense } from './tools/addExpense';
import { registerRecordPayment } from './tools/recordPayment';
import { registerConfirmPayment, registerRejectPayment } from './tools/decidePayment';

export const TOOLS: RegisterTool[] = [
  registerListGroups,
  registerGroupSummary,
  registerListExpenses,
  registerMyBalances,
  registerPendingPayments,
  registerAddExpense,
  registerRecordPayment,
  registerConfirmPayment,
  registerRejectPayment,
];

const INSTRUCTIONS =
  'Splitr is a bill-splitting app. These tools act as the signed-in user, with the same access they have in the app. ' +
  'Groups are found by name or code; when a name matches several groups, ask the user which one. ' +
  'Amounts are in each group\'s own currency; never add amounts in different currencies together. ' +
  'Before adding an expense or recording, confirming or rejecting a payment, tell the user exactly what will be saved and get their OK. ' +
  'Deleting or editing expenses and groups is only possible in the Splitr app.';

export function buildServer(env: Env, props: Props): McpServer {
  const server = new McpServer({ name: 'splitr', title: 'Splitr', version: '0.2.0' }, { instructions: INSTRUCTIONS });
  const session = createSession(env, props);
  for (const register of TOOLS) register(server, { session });
  return server;
}
