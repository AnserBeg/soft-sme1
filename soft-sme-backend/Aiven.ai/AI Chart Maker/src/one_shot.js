import { GoogleGenAI, FunctionCallingConfigMode, Type } from '@google/genai';
import { createChart } from './chart.js';
import { bold, dim } from 'colorette';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  return null;
}

const typeArg = (getArg('type') || '').toLowerCase();
const rowsPath = getArg('rows');
const title = getArg('title') || '';
const widthArg = getArg('width');
const heightArg = getArg('height');
const hints = getArg('hints') || '';
if (!rowsPath) {
  console.error('Missing --rows <path-to-json-array>');
  process.exit(2);
}

const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('Missing API key. Set GOOGLE_API_KEY or GEMINI_API_KEY');
  process.exit(1);
}

let rows;
try {
  const txt = readFileSync(rowsPath, 'utf-8');
  rows = JSON.parse(txt);
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
} catch (e) {
  console.error('Failed to read rows JSON:', e.message);
  process.exit(2);
}

const ai = new GoogleGenAI({ apiKey });

const createChartFunctionDeclaration = {
  name: 'create_chart',
  description: 'Creates a chart image (bar, line, or pie) from labels and datasets and saves it to disk.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      type: { type: Type.STRING, enum: ['bar','line','pie'] },
      title: { type: Type.STRING },
      labels: { type: Type.ARRAY, items: { type: Type.STRING } },
      datasets: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            label: { type: Type.STRING },
            data: { type: Type.ARRAY, items: { type: Type.NUMBER } }
          },
          required: ['data']
        }
      },
      width: { type: Type.NUMBER },
      height: { type: Type.NUMBER },
      file_name: { type: Type.STRING },
      colors: { type: Type.ARRAY, items: { type: Type.STRING } },
      background: { type: Type.STRING }
    },
    required: ['type','labels','datasets']
  }
};

const tools = [{ functionDeclarations: [createChartFunctionDeclaration] }];
const toolFunctions = { async create_chart(args) { return await createChart(args); } };

async function main() {
  const prompt = [
    'Create a chart from the following JSON rows.\n',
    typeArg ? `Chart type: ${typeArg}.` : 'Chart type: choose the best (bar/line/pie).',
    title ? ` Title: ${title}.` : '',
    '\nRules: Choose the best label column (names/categories/dates) and a numeric value column (hours/amounts/quantities).',
    ' Ensure numbers are formatted to two decimals in the chart labels/tooltip. Use a single dataset unless multiple are obvious.',
    ' Respond by calling create_chart with labels and datasets.\n',
    hints ? `User hints: ${hints}\n` : '',
    'Rows JSON:',
    JSON.stringify(rows).slice(0, 200000) // guard overly large
  ].join('');

  const contents = [{ role: 'user', parts: [{ text: prompt }] }];

  while (true) {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        tools,
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        temperature: 0
      }
    });

    if (response.functionCalls && response.functionCalls.length > 0) {
      const call = response.functionCalls[0];
      const fn = toolFunctions[call.name];
      if (!fn) throw new Error('Unknown function: ' + call.name);
      let result;
      try {
        // enforce only provided options; let the model choose otherwise
        if (typeArg) call.args.type = typeArg;
        if (title && !call.args.title) call.args.title = title;
        if (widthArg && !call.args.width) call.args.width = parseInt(widthArg, 10);
        if (heightArg && !call.args.height) call.args.height = parseInt(heightArg, 10);
        result = await fn(call.args);
      } catch (e) {
        result = { error: String(e?.message || e) };
      }
      contents.push({ role: 'model', parts: [{ functionCall: call }] });
      contents.push({ role: 'user', parts: [{ functionResponse: { name: call.name, response: { result } } }] });
      if (result?.path) {
        console.log('CHART_PATH:' + result.path);
        return;
      }
    } else {
      // No function call; just print text and exit
      console.log(response.text || '');
      return;
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
