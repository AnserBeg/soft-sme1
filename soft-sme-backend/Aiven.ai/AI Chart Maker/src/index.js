import { GoogleGenAI, FunctionCallingConfigMode, Type } from '@google/genai';
import readline from 'node:readline';
import { createChart } from './chart.js';
import { bold, green, cyan, yellow, dim } from 'colorette';

// Configure the client (reads GOOGLE_API_KEY or GEMINI_API_KEY)
const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey });

// Define function declaration for chart creation
const createChartFunctionDeclaration = {
  name: 'create_chart',
  description: 'Creates a chart image (bar, line, or pie) from labels and datasets and saves it to disk.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      type: {
        type: Type.STRING,
        enum: ['bar', 'line', 'pie'],
        description: 'Type of chart to create.'
      },
      title: {
        type: Type.STRING,
        description: 'Chart title displayed at the top.'
      },
      labels: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'Labels for each category or x-axis tick.'
      },
      datasets: {
        type: Type.ARRAY,
        description: 'One or more data series. For pie, only the first dataset is used.',
        items: {
          type: Type.OBJECT,
          properties: {
            label: { type: Type.STRING, description: 'Series name (ignored for pie if only one dataset).' },
            data: {
              type: Type.ARRAY,
              items: { type: Type.NUMBER },
              description: 'Values aligned with labels. Length must equal labels length.'
            }
          },
          required: ['data']
        }
      },
      width: { type: Type.NUMBER, description: 'Image width in pixels. Default 1000.' },
      height: { type: Type.NUMBER, description: 'Image height in pixels. Default 600.' },
      file_name: { type: Type.STRING, description: 'Optional base filename (without extension). Saved under ./charts.' },
      colors: {
        type: Type.ARRAY,
        description: 'Optional list of hex colors to use for datasets or segments.',
        items: { type: Type.STRING }
      },
      background: { type: Type.STRING, description: 'Background color of the chart. Default #ffffff.' }
    },
    required: ['type', 'labels', 'datasets']
  },
};

const tools = [{ functionDeclarations: [createChartFunctionDeclaration] }];

const toolFunctions = {
  async create_chart(args) {
    return await createChart(args);
  }
};

function makePromptInterface() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return {
    question: (q) => new Promise(res => rl.question(q, res)),
    close: () => rl.close(),
  };
}

async function runChat() {
  if (!apiKey) {
    console.log(yellow('Missing API key. Set environment variable ') + bold('GOOGLE_API_KEY') + yellow(' or ') + bold('GEMINI_API_KEY'));
    process.exit(1);
  }

  console.log(bold(green('AI Chart Maker')) + ' — ' + dim('Type requests like: "make a bar chart of quarterly revenue"'));

  const rl = makePromptInterface();
  let contents = [];

  while (true) {
    const prompt = await rl.question(cyan('\nYou: '));
    if (!prompt.trim()) continue;
    if (['exit', 'quit', 'q'].includes(prompt.trim().toLowerCase())) break;

    contents.push({ role: 'user', parts: [{ text: prompt }] });

    // Outer loop: keep handling function calls until the model returns text
    while (true) {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents,
        config: {
          tools,
          // Let the model decide when to call the function
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
          temperature: 0
        }
      });

      if (response.functionCalls && response.functionCalls.length > 0) {
        // Handle the first function call for simplicity; the SDK can request multiple
        const functionCall = response.functionCalls[0];
        const { name, args } = functionCall;

        if (!toolFunctions[name]) {
          throw new Error(`Unknown function call: ${name}`);
        }

        let toolResult;
        try {
          toolResult = await toolFunctions[name](args);
        } catch (err) {
          toolResult = { error: String(err?.message || err) };
        }

        const functionResponsePart = { name: functionCall.name, response: { result: toolResult } };

        // Add both the model’s function call and our function response into the history
        contents.push({ role: 'model', parts: [{ functionCall }] });
        contents.push({ role: 'user', parts: [{ functionResponse: functionResponsePart }] });

        // If we created a chart, show the path immediately for user feedback
        if (toolResult?.path) {
          console.log(dim(`→ Saved chart to: ${toolResult.path}`));
        }
        // Continue the loop; the model will likely produce final text next iteration
      } else {
        // No function calls — print the model’s answer and break
        console.log(bold('\nAssistant: ') + (response.text || '(no response)'));
        break;
      }
    }
  }

  rl.close();
}

async function runDemo() {
  // One-shot example without interactive loop
  const contents = [
    {
      role: 'user',
      parts: [{ text: 'Create a pie chart of 2024 market share for brands A,B,C as 45,35,20. Save as market_share_2024.' }]
    }
  ];

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents,
    config: { tools, temperature: 0 }
  });

  if (response.functionCalls && response.functionCalls.length) {
    const call = response.functionCalls[0];
    const result = await toolFunctions[call.name](call.args);
    // Send back function response
    const final = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        contents[0],
        { role: 'model', parts: [{ functionCall: call }] },
        { role: 'user', parts: [{ functionResponse: { name: call.name, response: { result } } }] }
      ],
      config: { tools, temperature: 0 }
    });
    console.log(dim(`Saved: ${result.path}`));
    console.log('\n' + final.text);
  } else {
    console.log(response.text);
  }
}

if (process.argv.includes('--demo')) {
  runDemo().catch(err => { console.error(err); process.exit(1); });
} else {
  runChat().catch(err => { console.error(err); process.exit(1); });
}

