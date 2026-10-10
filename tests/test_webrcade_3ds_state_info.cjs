// Verify the actual patched RetroArch C API with ASan/UBSan and caller frees.
// Usage: node tests/test_webrcade_3ds_state_info.cjs <RetroArch/tasks/task_save.c>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const source = fs.readFileSync(process.argv[2], 'utf8');
const body = source.match(/char\* save_state_info\(void\)\s*\{[\s\S]*?\n\}/)?.[0];
assert(body, 'save_state_info function found');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), '3ds-state-info-'));
try {
  fs.writeFileSync(path.join(dir, 'test.c'), `
#include <assert.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static bool supported = true, fail_data = false;
static unsigned snapshots = 0;
static bool core_info_current_supports_savestate(void) { return supported; }
static size_t core_serialize_size(void) { abort(); }
static void* content_get_serialized_data(size_t* size) {
  snapshots++;
  if (fail_data) return NULL;
  *size = 64;
  return calloc(*size, 1);
}
${body}
int main(void) {
  for (unsigned i = 0; i < 100; i++) {
    unsigned before = snapshots;
    char* info = save_state_info();
    size_t size, pointer; unsigned ok;
    assert(sscanf(info, "%zu|%zu|%u", &size, &pointer, &ok) == 3);
    assert(size == 64 && pointer != 0 && ok == 1 && snapshots == before + 1);
    free((void*)pointer);
    free(info);
  }
  supported = false;
  char* info = save_state_info();
  assert(strcmp(info, "Not supported||0") == 0);
  free(info);
  supported = true; fail_data = true;
  info = save_state_info();
  assert(strcmp(info, "Error writing data||0") == 0);
  free(info);
  return 0;
}
`);
  execFileSync(process.env.CC || 'cc', ['-g', '-fsanitize=address,undefined',
    '-fno-omit-frame-pointer', '-o', path.join(dir, 'test'), path.join(dir, 'test.c')], { stdio: 'inherit' });
  execFileSync(path.join(dir, 'test'), { stdio: 'inherit' });
  console.log('PASS real state-info API: heap ownership, one snapshot, error returns, ASan/UBSan');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
