const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const python = path.join(repoRoot, '.venv', 'bin', 'python');
const frontendDir = path.join(repoRoot, 'fe-visualizer');
const seedScript = path.join(repoRoot, 'e2e', 'seed-layout.py');
const sourceDb = path.join(repoRoot, 'streetparade_embeddings.sqlite3');
const runtimeDb = '/tmp/sp26-e2e.sqlite3';
const numpyDir = path.join(repoRoot, 'vectorstore');

module.exports = {
  testDir: '.',
  timeout: 300_000,
  expect: {
    timeout: 60_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5174',
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  webServer: [
    {
      command: [
        python,
        seedScript,
        sourceDb,
        runtimeDb,
        '&&',
        `STREETPARADE_DB=${runtimeDb}`,
        'STREETPARADE_VECTOR_STORE=numpy',
        `STREETPARADE_NUMPY_VECTOR_DIR=${numpyDir}`,
        'ENABLE_SONG_DL_AND_EMBEDINGS=0',
        python,
        '-m',
        'uvicorn',
        'streetparade_embeddings.api:app',
        '--host',
        '127.0.0.1',
        '--port',
        '8000',
      ].join(' '),
      cwd: repoRoot,
      url: 'http://127.0.0.1:8000/health',
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev',
      cwd: frontendDir,
      url: 'http://localhost:5174',
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
};
