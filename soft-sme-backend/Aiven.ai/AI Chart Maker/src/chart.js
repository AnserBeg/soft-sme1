import 'chart.js/auto';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Default color palettes
const PALETTE = [
  '#3366CC', '#DC3912', '#FF9900', '#109618', '#990099',
  '#3B3EAC', '#0099C6', '#DD4477', '#66AA00', '#B82E2E',
  '#316395', '#994499', '#22AA99', '#AAAA11', '#6633CC'
];

function ensureColors(count, baseColors) {
  const colors = baseColors && baseColors.length ? baseColors : PALETTE;
  if (count <= colors.length) return colors.slice(0, count);
  // Extend by repeating if needed
  const out = [];
  while (out.length < count) {
    out.push(...colors);
  }
  return out.slice(0, count);
}

function makeDatasetColors(type, count, provided, datasetIndex = 0) {
  const cols = ensureColors(count, provided);
  const opaque = cols;
  const semi = cols.map(c => `${c}80`); // add alpha
  if (type === 'pie') {
    return { backgroundColor: semi, borderColor: opaque };
  }
  const idx = Math.min(datasetIndex, semi.length - 1);
  return { backgroundColor: semi[idx], borderColor: opaque[idx] };
}

export async function createChart({
  type,
  title,
  labels,
  datasets,
  width = 1000,
  height = 600,
  file_name = undefined,
  colors = [],
  background = '#ffffff'
}) {
  if (!['bar', 'line', 'pie'].includes(type)) {
    throw new Error(`Unsupported chart type: ${type}`);
  }
  if (!Array.isArray(labels) || labels.length === 0) {
    throw new Error('labels must be a non-empty array of strings');
  }
  if (!Array.isArray(datasets) || datasets.length === 0) {
    throw new Error('datasets must be a non-empty array');
  }
  for (const [i, ds] of datasets.entries()) {
    if (!Array.isArray(ds.data) || ds.data.length !== labels.length) {
      throw new Error(`dataset[${i}].data length (${ds.data?.length ?? 'n/a'}) must match labels length (${labels.length})`);
    }
  }

  const chartsDir = resolve('charts');
  if (!existsSync(chartsDir)) mkdirSync(chartsDir, { recursive: true });

  const safeTitle = (file_name || `${type}-${Date.now()}`).replace(/[^a-z0-9-_\.]/gi, '_');
  const outPath = join(chartsDir, `${safeTitle}.png`);

  const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour: background });

  // Build Chart.js config
  const config = {
    type,
    data: {
      labels,
      datasets: datasets.map((ds, idx) => {
        const colorSet = makeDatasetColors(type, labels.length, colors.length ? colors : undefined, idx);
        return {
          label: ds.label ?? `Series ${idx + 1}`,
          data: ds.data,
          borderWidth: 2,
          ...colorSet,
        };
      })
    },
    options: {
      responsive: false,
      plugins: {
        legend: { display: true },
        title: { display: Boolean(title), text: title }
      },
      scales: (type === 'pie') ? undefined : {
        x: { ticks: { maxRotation: 0 } },
        y: { beginAtZero: true }
      }
    }
  };

  const image = await chartJSNodeCanvas.renderToBuffer(config);
  writeFileSync(outPath, image);

  return {
    path: outPath,
    width,
    height,
    type,
    title: title || '',
  };
}
