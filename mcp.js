// The MCP side of Pitchpad. The customer's own Claude does the thinking and the writing,
// then calls these tools. Pitchpad only stores, validates, calculates and hosts.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  AppError, STATUSES, createProposal, formatMoney, getActivity, getProposal,
  listProposals, publicShape, publishProposal, updateProposal,
} from './proposals.js';
import { getWorkspace } from './auth.js';

const FORMAT_HELP =
  'Text fields support simple formatting: blank line between paragraphs, "## " for a subheading, ' +
  '"- " for bullets, "1. " for numbered steps, **bold** and *italic*. Do not use HTML.';

const section = z.object({
  heading: z.string().max(200).describe('Section heading, for example "Scope of work" or "Timeline".'),
  body: z.string().max(20000).describe(`Section text. ${FORMAT_HELP}`),
});

const lineItem = z.object({
  description: z.string().min(1).max(300).describe('What the client is paying for, for example "Logo design, 3 concepts".'),
  details: z.string().max(1000).optional().describe('Optional one-line clarification shown under the description.'),
  quantity: z.number().min(0).max(1e6).optional().describe('How many units or hours. Defaults to 1.'),
  unit_price: z.number().min(0).max(1e10).describe('Price per unit as a plain number in the proposal currency, for example 45000.'),
});

const editableFields = {
  title: z.string().min(1).max(200).describe('Proposal title, for example "Brand refresh for Meera\'s Bakery".'),
  client_name: z.string().max(200).describe('Name of the person the proposal is for.'),
  client_company: z.string().max(200).describe('Client company, if any.'),
  client_email: z.string().max(200).describe('Client email, if known.'),
  intro: z.string().max(20000).describe(`Opening message to the client. ${FORMAT_HELP}`),
  sections: z.array(section).max(40).describe('Ordered sections of the proposal. When updating, this replaces the whole list.'),
  line_items: z.array(lineItem).max(100).describe('Priced items. Pitchpad calculates all totals. When updating, this replaces the whole list.'),
  currency: z.string().length(3).describe('3-letter currency code like USD, EUR, GBP or INR. Defaults to the business default.'),
  tax_rate: z.number().min(0).max(100).describe('Tax percentage applied after discount, for example 18 for 18% GST.'),
  discount: z.number().min(0).describe('Flat discount amount in the proposal currency.'),
  valid_until: z.string().describe('Date the offer expires, as YYYY-MM-DD.'),
  terms: z.string().max(20000).describe(`Payment and legal terms. Defaults to the business default terms. ${FORMAT_HELP}`),
};

const allOptional = Object.fromEntries(Object.entries(editableFields).map(([k, v]) => [k, v.optional()]));

function ok(text) {
  return { content: [{ type: 'text', text }] };
}

function fail(err) {
  const message = err instanceof AppError ? err.message : 'Pitchpad could not complete that request.';
  if (!(err instanceof AppError)) console.error(err);
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function summary(p, baseUrl) {
  const shape = publicShape(p, baseUrl);
  const lines = [
    `${p.code} "${p.title}" for ${p.client_name || 'an unnamed client'}${p.client_company ? ` (${p.client_company})` : ''}`,
    `Status: ${p.status}. Total: ${formatMoney(p.totals.total, p.currency)} (subtotal ${formatMoney(p.totals.subtotal, p.currency)}, discount ${formatMoney(p.totals.discount, p.currency)}, tax ${formatMoney(p.totals.tax, p.currency)}).`,
    `Owner can review and edit it here: ${shape.edit_url}`,
    p.status === 'draft'
      ? 'It is a draft, so the client link is not live yet. The owner can publish it from Pitchpad, or ask you to publish it.'
      : `Client link (live, always shows the latest version): ${shape.client_url}`,
  ];
  return lines.join('\n');
}

export function buildMcpServer(workspaceId, baseUrl) {
  const server = new McpServer(
    { name: 'pitchpad', version: '1.0.0' },
    {
      instructions:
        'Pitchpad stores client proposals for a small business. You write the proposal; Pitchpad saves it, ' +
        'calculates totals, lets the owner edit it, and hosts a live link the client can accept. ' +
        'Call get_business_profile first to learn the business name, defaults and how the owner likes to write. ' +
        'Before changing an existing proposal, call get_proposal so you work from the latest version, because the owner may have edited it. ' +
        'Always share the edit link with the user after creating or changing a proposal.',
    },
  );

  server.registerTool(
    'get_business_profile',
    {
      title: 'Get business profile',
      description: 'Returns the business name, contact details, default currency, tax rate, default terms, and the owner\'s writing notes. Read this before writing a proposal.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const ws = await getWorkspace(workspaceId);
        const recent = await listProposals(workspaceId, { limit: 5 });
        return ok(JSON.stringify({
          business_name: ws.business_name,
          business_email: ws.business_email,
          business_address: ws.business_address,
          default_currency: ws.default_currency,
          default_tax_rate: ws.default_tax_rate,
          default_terms: ws.default_terms,
          writing_notes: ws.writing_notes || 'No notes yet. Write in a clear, warm, professional voice.',
          recent_proposals: recent.map((p) => ({ id: p.id, code: p.code, title: p.title, client: p.client_name, status: p.status })),
        }, null, 2));
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    'create_proposal',
    {
      title: 'Create proposal',
      description:
        'Saves a new client proposal in Pitchpad as a draft and returns its edit link. Write the full proposal: a short intro, ' +
        'sections such as scope, deliverables, timeline and what is not included, and priced line items. ' +
        'Pitchpad calculates subtotal, discount, tax and total, so never put totals in the text.',
      inputSchema: { ...allOptional, title: editableFields.title, client_name: editableFields.client_name },
    },
    async (args) => {
      try {
        const ws = await getWorkspace(workspaceId);
        const p = await createProposal(ws, args, 'claude');
        return ok(`Created.\n${summary(p, baseUrl)}\nProposal id: ${p.id}`);
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    'update_proposal',
    {
      title: 'Update proposal',
      description:
        'Changes fields of an existing proposal. Only send the fields you want to change. sections and line_items replace the ' +
        'whole list, so send the complete new list based on get_proposal. Accepted proposals are locked.',
      inputSchema: { proposal_id: z.string().describe('The proposal id from create_proposal or list_proposals.'), ...allOptional },
    },
    async ({ proposal_id, ...changes }) => {
      try {
        const p = await updateProposal(workspaceId, proposal_id, changes, 'claude');
        return ok(`Saved. The owner's editor and the client link now show this version.\n${summary(p, baseUrl)}`);
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    'get_proposal',
    {
      title: 'Get proposal',
      description: 'Returns the full, current content of one proposal, including edits the owner made in Pitchpad, its status, totals and recent activity.',
      inputSchema: { proposal_id: z.string().describe('The proposal id.') },
      annotations: { readOnlyHint: true },
    },
    async ({ proposal_id }) => {
      try {
        const p = await getProposal(workspaceId, proposal_id);
        return ok(JSON.stringify({ ...publicShape(p, baseUrl), activity: await getActivity(p.id, 15) }, null, 2));
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    'list_proposals',
    {
      title: 'List proposals',
      description: 'Lists proposals in this workspace, newest first, with status and total. Use it to find a proposal id.',
      inputSchema: {
        status: z.enum(STATUSES).optional().describe('Only show proposals with this status.'),
        limit: z.number().int().min(1).max(100).optional().describe('How many to return. Defaults to 25.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ status, limit }) => {
      try {
        const rows = await listProposals(workspaceId, { status, limit: limit ?? 25 });
        if (!rows.length) return ok(status ? `No ${status} proposals.` : 'No proposals yet.');
        return ok(JSON.stringify(rows.map((p) => ({
          id: p.id,
          code: p.code,
          title: p.title,
          client: p.client_name,
          status: p.status,
          total: formatMoney(p.totals.total, p.currency),
          updated_at: p.updated_at,
          last_edited_by: p.last_edited_by,
        })), null, 2));
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    'publish_proposal',
    {
      title: 'Publish proposal',
      description:
        'Makes the client link live so the client can read and accept the proposal. Only call this when the user clearly asks ' +
        'to publish or share it. Pitchpad does not email anyone; give the client link to the user.',
      inputSchema: { proposal_id: z.string().describe('The proposal id.') },
    },
    async ({ proposal_id }) => {
      try {
        const p = await publishProposal(workspaceId, proposal_id, 'claude');
        return ok(`Published.\n${summary(p, baseUrl)}`);
      } catch (e) { return fail(e); }
    },
  );

  return server;
}
