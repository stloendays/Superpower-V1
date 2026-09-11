import { jsonSchemaToCsn } from './schema_converter';
import { chatgptInstructions } from './website_specific_instruction/chatgpt';
import { geminiInstructions } from './website_specific_instruction/gemini';
import { createLogger } from '@extension/shared/lib/logger';

const logger = createLogger('InstructionGeneratorJSON');

export interface InstructionTool {
  name: string;
  schema: string;
  description: string;
}

const BASE_INSTRUCTIONS = `[SuperAssistant Operational Instructions][IMPORTANT]

You are SuperAssistant. Use the MCP tools listed below when they materially help answer the user's request.

Tool-call protocol:
- Emit tool calls only inside fenced \`\`\`jsonl blocks.
- Put exactly one complete tool call in each fenced block.
- A call starts with {"type":"function_call_start","name":"...","call_id":N}.
- Then emit one optional description event and one parameter event per supplied argument.
- End with {"type":"function_call_end","call_id":N}.
- Use monotonically increasing integer call_id values, starting at 1 for a fresh session.
- Include every required parameter. Omit optional parameters unless they are useful.
- Preserve user-supplied parameter values exactly when the user explicitly provides them.
- Objects and arrays must be valid JSON values.
- Never invent a tool, parameter, or function result.
- You may emit up to five independent calls in one response. If a later call depends on an earlier result, stop and wait for that result.
- After emitting tool calls, stop. Continue only after <function_results> are returned.
- Do not print tool-call syntax in reasoning or examples unless actually requesting execution.

Example call shape:
\`\`\`jsonl
{"type":"function_call_start","name":"function_name","call_id":1}
{"type":"description","text":"Short reason for this call"}
{"type":"parameter","key":"parameter_name","value":"value"}
{"type":"function_call_end","call_id":1}
\`\`\`
`;

const CSN_LEGEND = 'Schema notation: o=object, s=string, i=integer, n=number, b=boolean, a[]=array, e[]=enum, r=required, ?=optional.';

const normalizeText = (value: string, maxLength = 320): string => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
};

const formatTool = (tool: InstructionTool): string => {
  const name = normalizeText(tool.name, 120);
  const description = normalizeText(tool.description || '', 320);

  try {
    const parsedSchema = JSON.parse(tool.schema || '{}');
    const compactSchema = jsonSchemaToCsn(parsedSchema);
    const descriptionPart = description ? ` — ${description}` : '';
    return `- ${name}${descriptionPart}\n  schema: ${compactSchema}`;
  } catch (error) {
    logger.warn(`Unable to compact schema for ${tool.name}:`, error);
    const descriptionPart = description ? ` — ${description}` : '';
    return `- ${name}${descriptionPart}\n  schema: unavailable`;
  }
};

export const generateInstructionsJson = (
  tools: InstructionTool[],
  customInstructions?: string,
  customInstructionsEnabled?: boolean,
): string => {
  if (!tools || tools.length === 0) {
    return '# No tools available\n\nConnect to the MCP server to see available tools.';
  }

  const sections: string[] = [BASE_INSTRUCTIONS];

  const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
  if (currentHost.includes('gemini')) sections.push(geminiInstructions.trim());
  if (currentHost.includes('chatgpt')) sections.push(chatgptInstructions.trim());

  sections.push(`## AVAILABLE MCP TOOLS\n${CSN_LEGEND}\n\n${tools.map(formatTool).join('\n')}`);

  if (customInstructionsEnabled && customInstructions?.trim()) {
    sections.push(`<custom_instructions>\n${customInstructions.trim()}\n</custom_instructions>`);
  }

  sections.push('User interaction starts here:');
  return `${sections.filter(Boolean).join('\n\n')}\n`;
};
