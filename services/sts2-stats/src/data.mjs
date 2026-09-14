// services/sts2-stats/src/data.mjs — the plugin's bundled Spire Codex data, read from disk, so the service
// judges ids against exactly what the plugin ships.
import { readFileSync } from 'node:fs';
import { createData } from '../../../plugins/sts2-companion/core/data.js';

const DIR = new URL('../../../plugins/sts2-companion/data/', import.meta.url);

export const pluginData = () => createData({ load: async (name) => JSON.parse(readFileSync(new URL(`${name}.json`, DIR))) });
