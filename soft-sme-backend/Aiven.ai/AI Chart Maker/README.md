AI Chart Maker (Gemini Function Calling)

An interactive CLI chat bot that uses Gemini function calling to generate bar, line, and pie charts as PNG files.

What it does
- Takes natural language prompts like “make a bar chart of monthly revenue for Jan–Jun: 10,12,18,15,20,22”.
- Uses function calling to invoke a chart tool with labels/datasets.
- Renders the chart with Chart.js in Node and saves it to ./charts/*.png.

Prerequisites
- Node 18+
- A Gemini API key exported as either GOOGLE_API_KEY or GEMINI_API_KEY.

Setup
1) Install dependencies
   npm install

2) Set your API key
   PowerShell:
   $env:GOOGLE_API_KEY="YOUR_KEY"
   or
   $env:GEMINI_API_KEY="YOUR_KEY"

3) Run the chat
   npm start

   Type prompts like:
   - Make a bar chart of website traffic for Mon–Sun with values 12, 15, 20, 18, 22, 30, 25. Title it Weekly Traffic.
   - Create a pie chart for product share: A 45, B 35, C 20. Save as market_share_2024.
   - Plot a line graph of temperature over hours 1–6 with 20, 21, 23, 25, 24, 22.

4) Optional: one-shot demo
   npm run demo

Output
- Charts are written to ./charts as PNGs. The assistant prints the saved path.

Notes
- Function schema: create_chart(type, labels, datasets, title?, width?, height?, file_name?, colors?, background?)
- For pie charts, only the first dataset is used.
- For multiple series (bar/line), include multiple datasets each with its own data array.

