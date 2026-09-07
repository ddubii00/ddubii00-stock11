import { cpSync, existsSync } from 'node:fs';

if (!existsSync('.next/standalone/server.js')) throw new Error('Run npm run build first.');
cpSync('public', '.next/standalone/public', { recursive: true });
cpSync('.next/static', '.next/standalone/.next/static', { recursive: true });
console.info('Standalone public assets prepared.');
