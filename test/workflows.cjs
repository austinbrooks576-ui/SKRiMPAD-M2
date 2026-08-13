// workflows.cjs — the retry loops in CI, actually executed.
//
// Two builds have now been lost to a download that had nothing to do with the
// repo: the gradle wrapper fetching its distribution, and Electron's
// postinstall fetching its ~100MB binary. Both are retried now. But a retry
// loop is the classic piece of code that is never exercised — it only runs on
// the bad day, and if it is wrong, the bad day is the day you find out.
//
// So this runs them. Each loop is pulled out of the workflow YAML and executed
// under the exact shell GitHub uses (`bash --noprofile --norc -e -o pipefail`)
// against a stub command that fails on demand. Three paths matter:
//
//   clean       succeeds first try, exits 0
//   flaky       fails twice, recovers, exits 0   ← the whole point
//   dead        fails every time, exits 1        ← must still go red
//
// The `-e` matters. A retry loop written the obvious way dies on its own first
// failure under `set -e` and never retries at all, which looks exactly like a
// working retry until you read the log.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? (pass++, console.log('PASS ' + m + (x ? ' | ' + x : '')))
                            : (fail++, console.log('FAIL ' + m + (x ? ' | ' + x : ''))); };

const ROOT = path.resolve(__dirname, '..');
const WF = path.join(ROOT, '.github', 'workflows');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'skrimwf-'));

// ---- pull the loops out of the YAML ---------------------------------------
// By indentation, not with a YAML library — this test should not need a
// dependency installed to tell you your CI is broken.
function loops(file) {
  const lines = fs.readFileSync(path.join(WF, file), 'utf8').split('\n');
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)run: \|\s*$/.exec(lines[i]);
    if (!m) continue;
    const base = m[1].length;
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (lines[j].trim() === '') { body.push(''); continue; }
      const ind = lines[j].length - lines[j].trimStart().length;
      if (ind <= base) break;
      body.push(lines[j]);
    }
    const text = body.join('\n');
    if (!text.includes('for attempt in')) { i = j - 1; continue; }
    // Strip the block indent, the way YAML does.
    const pad = Math.min(...body.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
    // Which shell does the step run under? Windows runners default to pwsh,
    // where none of this bash is valid, so the step must pin `shell: bash`.
    let shell = null, name = '(unnamed)';
    for (let k = i; k >= 0 && k > i - 25; k--) {
      if (/^\s*- name:/.test(lines[k])) { name = lines[k].replace(/^\s*- name:\s*/, ''); break; }
      const s = /^\s*shell:\s*(\S+)/.exec(lines[k]);
      if (s) shell = s[1];
    }
    found.push({ file, name, shell, run: body.map((l) => l.slice(pad)).join('\n') });
    i = j - 1;
  }
  return found;
}

const all = fs.readdirSync(WF).filter((f) => f.endsWith('.yml')).flatMap(loops);
ok(all.length >= 10, 'every workflow that downloads something retries it', all.length + ' retry loops');

// ---- a command that fails exactly as often as we ask ----------------------
const bin = path.join(TMP, 'bin');
const work = path.join(TMP, 'work');
fs.mkdirSync(bin, { recursive: true });
fs.mkdirSync(path.join(work, 'electron'), { recursive: true });
fs.mkdirSync(path.join(work, 'android'), { recursive: true });

const stub = `#!/usr/bin/env bash
n=$(cat "$FAILS_LEFT_FILE")
if [ "$n" -gt 0 ]; then echo $((n - 1)) > "$FAILS_LEFT_FILE"; echo "stub: transient network failure" >&2; exit 1; fi
exit 0
`;
for (const name of ['npm', 'gradlew']) {
  fs.writeFileSync(path.join(bin, name), stub, { mode: 0o755 });
}
fs.writeFileSync(path.join(work, 'android', 'gradlew'), stub, { mode: 0o755 });
// Instant sleep. The loop backs off 15s/30s — real waits would make this test
// take three minutes to tell us something it knows in three milliseconds.
fs.writeFileSync(path.join(bin, 'sleep'), '#!/usr/bin/env bash\necho "(slept $1)"\n', { mode: 0o755 });

const script = path.join(TMP, 'step.sh');
const fails = path.join(TMP, 'fails');
function runLoop(body, failCount) {
  fs.writeFileSync(script, body);
  fs.writeFileSync(fails, String(failCount));
  try {
    const out = execFileSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', script], {
      cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, FAILS_LEFT_FILE: fails },
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

for (const L of all) {
  const tag = L.file.replace(/\.yml$/, '') + ' › ' + L.name;

  ok(runLoop(L.run, 0).code === 0, tag + ' — a clean run succeeds');

  // THE POINT. Two failures then success must come out green; if `set -e`
  // killed the script on the first failure this is the assertion that catches
  // it, because the stub would never be called a third time.
  const flaky = runLoop(L.run, 2);
  ok(flaky.code === 0, tag + ' — recovers from two failures instead of losing the build');

  // And it must still be capable of failing. A retry loop that swallows a real
  // breakage is worse than no retry at all.
  const dead = runLoop(L.run, 99);
  ok(dead.code === 1, tag + ' — a genuine failure still goes red');
  ok(/failed three times/.test(dead.out), tag + ' — and says why it gave up');

  // The last failure must not announce a retry it will never make. It used to:
  // three attempts printed three "retrying in" lines and slept 45 seconds
  // before quitting, so the log claimed a fourth attempt that never came.
  const announced = (dead.out.match(/retrying in/g) || []).length;
  ok(announced === 2, tag + ' — announces 2 retries, not 3 for a run that only has 3 attempts',
     announced + ' announcements');

  // Windows runners default to pwsh, where `for attempt in 1 2 3; do` is a
  // syntax error. The ubuntu APK jobs already default to bash.
  ok(L.shell === 'bash' || L.file.startsWith('build-apk'),
     tag + ' — runs under bash, not the Windows pwsh default', L.shell || 'runner default');
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
