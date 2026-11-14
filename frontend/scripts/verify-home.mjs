// The homepage is now the scientific planner; keep the original entry command.
process.env.LUNAR_ORACLE_TEST_URL ||= 'http://127.0.0.1:5173/'
await import('./verify-planner.mjs')
