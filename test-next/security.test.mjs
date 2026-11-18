import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { safeInternalLink } from '../lib/security.js';

test('PHP-compatible bcrypt hashes authenticate', async () => {
  const hash = await bcrypt.hash('SIPRINT test password', 4);
  const phpStyleHash = hash.replace(/^\$2[ab]\$/, '$2y$');
  assert.equal(await bcrypt.compare('SIPRINT test password', phpStyleHash), true);
  assert.equal(await bcrypt.compare('incorrect password', phpStyleHash), false);
});

test('internal notification links reject external and malformed URLs', () => {
  assert.equal(safeInternalLink('/dokumen'), true);
  assert.equal(safeInternalLink('/admin/antrean?status=menunggu'), true);
  assert.equal(safeInternalLink('//example.com'), false);
  assert.equal(safeInternalLink('https://example.com'), false);
  assert.equal(safeInternalLink('/\\example.com'), false);
});
