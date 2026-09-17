/**
 * Regression test for the ideTools Remote wire contract (run: node scripts/test-remote-contract.mjs).
 *
 * A @Remote method must return its PLAIN business value and signal failure by THROWING RemoteError.
 * Returning the { ok, value | error } envelope from the method body double-wraps the result on the
 * wire ({ ok: true, value: { ok, ... } }), so the client sees value.message === undefined — which
 * crashed the whole IDE view when the AI commit-message button rendered it (2026-09-16).
 *
 * These assertions pin the contract for every ideTools method that once returned envelopes.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { IdeTools } from '../lib/index.js'

const execFileP = promisify(execFile)
const REPO = new URL("..", import.meta.url).pathname

function makeCtx(llmChunks) {
  return {
    subprocess: {
      spawn(spec) {
        const mk = (text) => ({ readFrom: () => ({ text }) })
        const collected = { stdout: null, stderr: null }
        const done = execFileP(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, maxBuffer: 64 * 1024 * 1024 })
          .then(({ stdout, stderr }) => { collected.stdout = mk(stdout); collected.stderr = mk(stderr); return { exitCode: 0, signal: null } })
          .catch((err) => { collected.stdout = mk(""); collected.stderr = mk(err.stderr ?? String(err)); return { exitCode: err.code ?? 1, signal: null } })
        return { collected, done }
      },
    },
    llm: { async *stream() {
      yield { type: "block-start", index: 0, blockType: "text" }
      yield { type: "text-delta", index: 0, text: "feat: contract test" }
      yield { type: "block-end", index: 0, block: { type: "text", text: "feat: contract test" } }
      yield { type: "finish", reason: "stop", replayState: null }
    } },
    agentDefaultModel: { currentSelection: () => ({ provider: "mock", model: "mock" }) },
  }
}

let failures = 0
function check(name, ok, detail) {
  if (ok) console.log("  ok  " + name)
  else { failures += 1; console.error("FAIL  " + name + (detail ? " — " + detail : "")) }
}

const svc = Object.create(IdeTools.prototype)
svc.ctx = makeCtx()

// 1. Success returns the PLAIN value — no { ok, value } envelope.
{
  const out = await svc.gitGenerateCommitMessage({ sessionId: "t", workspaceRoot: REPO }, undefined)
  check("gitGenerateCommitMessage returns plain { message }", typeof out === "object" && out !== null && !("ok" in out) && typeof out.message === "string", JSON.stringify(out))
}

// 2. A workspace outside any repo throws RemoteError (no envelope return).
{
  let threw = null
  try { await svc.gitGenerateCommitMessage({ sessionId: "t", workspaceRoot: "/tmp" }, undefined) }
  catch (err) { threw = err }
  check("failure path throws RemoteError", threw instanceof RemoteError && typeof threw.code === "string", String(threw))
  check("RemoteError carries details (wire rpcErrorSchema requires it)", threw instanceof RemoteError && typeof threw.details === "object" && threw.details !== null, String(threw))
}

// 3. hostPlatform returns the plain string.
{
  const out = await svc.hostPlatform({ sessionId: "t", workspaceRoot: REPO }, undefined)
  check("hostPlatform returns plain string", typeof out === "string", JSON.stringify(out))
}

// 4. fileCreate refuses duplicates by throwing (plain-void success exercised implicitly).
{
  let threw = null
  try { await svc.fileCreate({ sessionId: "t", workspaceRoot: REPO }, "package.json", "file", undefined) }
  catch (err) { threw = err }
  check("fileCreate duplicate throws RemoteError(ide-tools/exists)", threw instanceof RemoteError && threw.code === "ide-tools/exists", String(threw))
}

if (failures > 0) { console.error(failures + " contract check(s) failed"); process.exit(1) }
console.log("remote wire contract: all checks passed")