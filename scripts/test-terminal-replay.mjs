// Regression test for the terminal replay head-trim boundary finder.
//
// Symptom this guards: switching between terminals made the first line show a
// stray '%' (or '[0m', '0;user@host') — the tail of an escape sequence whose
// introducer had been trimmed off the replay log. findSafeReplayStart decides
// where a trimmed chunk may safely be replayed; it must skip such leftovers
// WITHOUT eating ordinary text that merely resembles one.
import assert from 'node:assert/strict'
import { findSafeReplayStart } from '../lib/index.js'

let pass = 0, fail = 0
function check(name, input, expected) {
  const cut = findSafeReplayStart(input)
  const got = input.slice(cut)
  try {
    assert.equal(got, expected)
    pass++
    console.log('PASS ' + name)
  } catch {
    fail++
    console.log('FAIL ' + name + ': 回放=' + JSON.stringify(got) + ' 期望=' + JSON.stringify(expected))
  }
}

const ESC = '\x1b'
const BEL = '\x07'
const ST = ESC + '\\'

// Leftover tails must be skipped so the prompt text survives cleanly.
check('OSC 标题尾部 (BEL 结尾)', '0;user@host' + BEL + '$ ', '$ ')
check('OSC 标题尾部 (ST 结尾)', '0;user@host' + ST + '$ ', '$ ')
check('OSC 只丢 ] 保留 ESC', ESC + '0;title' + BEL + '$ ', '$ ')
check('CSI SGR 尾部', '[0m$ ', '$ ')
check('CSI 带 F 前缀', '[1;1H$ ', '$ ')
check('DCS 尾部 (完整)', 'Pq#0;2;0;0;0' + ST + '$ ', '$ ')
check('DCS 尾部 (丢了 P)', 'q#0;2;0;0;0' + ST + '$ ', '$ ')
check('完整 OSC 从 ESC 起', ESC + ']0;title' + BEL + '$ ', '$ ')
check('完整 CSI 从 ESC 起', ESC + '[38;2;1;2;3m$ ', '$ ')

// Ordinary text must never be eaten by the leftover detector.
check('普通文本含分号', '1;2 test', '1;2 test')
check('普通文本以数字开头', '42 files changed', '42 files changed')
check('普通文本含方括号', '[INFO] build', '[INFO] build')
check('纯文本提示符', 'user@host ~ % ', 'user@host ~ % ')
check('含 % 的文本', '% complete', '% complete')
check('空串', '', '')

console.log('\nSUMMARY pass=' + pass + ' fail=' + fail)
process.exit(fail === 0 ? 0 : 1)
