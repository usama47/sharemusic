const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
test('worker retires only ShareMusic caches and never intercepts media, ranges, APIs or failed requests', async () => {
  const handlers = {}, deleted = []; let claimed = false;
  const self = { addEventListener: (event, handler) => handlers[event] = handler, skipWaiting: async () => {}, clients: { claim: async () => { claimed = true; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8'), { self, caches: { keys: async () => ['sharemusic-shell-v1', 'sharemusic-shell-v2', 'another-app'], delete: async name => deleted.push(name) } });
  assert.equal(handlers.fetch, undefined);
  let activation;
  handlers.activate({ waitUntil: promise => { activation = promise; } }); await activation;
  assert.deepEqual(deleted, ['sharemusic-shell-v1', 'sharemusic-shell-v2']); assert(claimed);
});
