/**
 * Regression test for the ideTools Remote wire contract (run: node scripts/test-remote-contract.mjs).
 *
 * A @Remote method must return its PLAIN business value and signal failure by THROWING RemoteError.
 * Returning the { ok, value | error } envelope from the method body double-wraps the result on the
 * wire ({ ok: true, value: { ok, ... } }), so the client sees value.message === undefined — which
 * crashed the whole IDE view when the AI commit-message button rendered it (2026-09-16).
 *
 * These assertions pin the contract for every ideTools method that once returned envelopes, plus
 * the writeFile face (the IDE's save path) that replaced the never-published
 * @deepseek-ai/dsh-api-workspace-files-write package.
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

// 5. An adapter failure arriving as an error-kind finish chunk must surface the REAL cause
//    (ide-tools/llm-failed), never the misleading ide-tools/llm-empty.
{
  const failing = makeCtx()
  failing.llm = { async *stream() {
    yield { type: "finish", reason: { kind: "error", failure: { code: "MISSING_CREDENTIAL", message: "no credential for provider route wb" } } }
  } }
  const s2 = Object.create(IdeTools.prototype)
  s2.ctx = failing
  let threw = null
  try { await s2.gitGenerateCommitMessage({ sessionId: "t", workspaceRoot: REPO }, undefined) } catch (err) { threw = err }
  check("error finish surfaces real cause (llm-failed, not llm-empty)", threw instanceof RemoteError && threw.code === "ide-tools/llm-failed" && threw.message.includes("no credential"), String(threw))
}

// 6. Reasoning-only output under the budget reports the reasoning-specific hint.
{
  const reasoning = makeCtx()
  reasoning.llm = { async *stream() {
    yield { type: "block-start", index: 0, blockType: "reasoning" }
    yield { type: "reasoning-delta", index: 0, text: "thinking..." }
    yield { type: "block-end", index: 0, block: { type: "reasoning", text: "thinking..." } }
    yield { type: "finish", reason: { kind: "max-tokens" } }
  } }
  const s3 = Object.create(IdeTools.prototype)
  s3.ctx = reasoning
  let threw = null
  try { await s3.gitGenerateCommitMessage({ sessionId: "t", workspaceRoot: REPO }, undefined) } catch (err) { threw = err }
  check("reasoning-only output reports budget hint", threw instanceof RemoteError && threw.code === "ide-tools/llm-empty" && threw.message.includes("reasoning"), String(threw))
}

// ---------------------------------------------------------------------------
// writeFile (the IDE's save path)
//
// The real host seam (dsh-fs) is fenced by the deployment's sandbox policy and
// applies the version guard atomically; this in-memory stand-in reproduces the
// seam's OBSERVABLE contract so the plugin's own contribution — path
// confinement, intent forwarding, error-code mapping, plain-value result, and
// the fs/observed 回灌 — can be asserted without a live harness. It never
// touches disk (every path used below is absent from the tree).
function makeFsSeam({ failWith } = {}) {
  const files = new Map()
  const observed = []
  const policies = []
  return {
    files,
    observed,
    policies,
    resolve: async (path) => ({ displayPath: path }),
    writeText: async (target, content, expected, _signal, sandboxPolicy) => {
      policies.push(sandboxPolicy)
      if (failWith !== undefined) {
        const refusal = new Error("seam refused the write")
        refusal.code = failWith
        throw refusal
      }
      const key = target.displayPath
      const current = files.get(key)
      if (expected?.kind === "createIfAbsent" && current !== undefined) {
        const refusal = new Error("already there"); refusal.code = "FS_NOT_OBSERVED"; throw refusal
      }
      if (expected?.kind === "replaceIfVersion" && current?.version !== expected.version) {
        const refusal = new Error("stale version"); refusal.code = "FS_STALE_VERSION"; throw refusal
      }
      const version = "v" + (current === undefined ? 1 : Number(current.version.slice(1)) + 1)
      files.set(key, { content, version })
      return { operation: current === undefined ? "create" : "update", version }
    },
  }
}

/**
 * An IdeTools instance whose ctx carries the seam, an emit spy, and the two
 * host services a write fence is resolved from — reached through `get`, the
 * soft lookup the host code uses (a hard `static inject` here would let an
 * absent service deactivate the whole plugin, which is what this package's
 * install used to do to `dsh web`). The policy stand-in mirrors the real
 * service: a request WITHOUT a session takes the deployment fallback root — the
 * server process's cwd, pointedly not the workspace here — so a test can tell
 * "the Session's own fence was stamped" from "the seam's fallback ran".
 */
function makeWriteService(seam, { mode = "workspace-write", sessionCwd = REPO, live = true } = {}) {
  const emitted = []
  const asked = []
  const svc = Object.create(IdeTools.prototype)
  svc.ctx = {
    ...makeCtx(),
    fs: seam,
    emit: (event, ...args) => { emitted.push([event, ...args]) },
    get(name) {
      if (name === "sessions") {
        return { get(id) { asked.push(id); return live ? { id, header: { cwd: sessionCwd } } : undefined } }
      }
      if (name === "sandboxPolicy") {
        return {
          resolve(request = {}) {
            const session = request.session
            return session === undefined
              ? { mode, workspaceRoot: "/deployment-cwd" }
              : { mode, workspaceRoot: session.header.cwd }
          },
        }
      }
      return undefined
    },
  }
  return { svc, emitted, asked }
}

// 7. A createIfAbsent write returns the plain result and announces the change.
{
  const seam = makeFsSeam()
  const { svc, emitted } = makeWriteService(seam)
  const target = "src/__contract-tmp__.txt"
  const out = await svc.writeFile({ sessionId: "t", workspaceRoot: REPO }, target, "hello\n", { kind: "createIfAbsent" }, undefined)
  check("writeFile returns plain { absolutePath, version, operation, bytes }",
    typeof out === "object" && out !== null && !("ok" in out) && out.operation === "create"
    && out.version === "v1" && out.bytes === 6 && out.absolutePath === REPO + target,
    JSON.stringify(out))
  check("writeFile wrote through the seam", seam.files.get(REPO + target)?.content === "hello\n")
  check("writeFile emits fs/observed so the changes stream sees it",
    emitted.length === 1 && emitted[0][0] === "fs/observed"
    && emitted[0][2]?.kind === "present" && emitted[0][2]?.version === "v1",
    JSON.stringify(emitted))
}

// 8. A stale version guard surfaces as the code the client's conflict prompt opens on.
{
  const seam = makeFsSeam()
  seam.files.set(REPO + "src/__contract-tmp__.txt", { content: "newer", version: "v9" })
  const { svc } = makeWriteService(seam)
  let threw = null
  try {
    await svc.writeFile({ sessionId: "t", workspaceRoot: REPO }, "src/__contract-tmp__.txt", "mine", { kind: "replaceIfVersion", version: "v1" }, undefined)
  } catch (err) { threw = err }
  check("stale tab saves throw RemoteError(workspace-file-write/stale-version)",
    threw instanceof RemoteError && threw.code === "workspace-file-write/stale-version", String(threw))
  check("stale-save error carries details (wire rpcErrorSchema requires it)",
    threw instanceof RemoteError && typeof threw.details === "object" && threw.details !== null, String(threw))
}

// 9. A path outside the workspace is refused before the seam is consulted.
{
  const seam = makeFsSeam()
  const { svc } = makeWriteService(seam)
  let threw = null
  try {
    await svc.writeFile({ sessionId: "t", workspaceRoot: REPO }, "../escape.txt", "x", undefined, undefined)
  } catch (err) { threw = err }
  check("escaping path throws RemoteError(workspace-file-write/outside-workspace)",
    threw instanceof RemoteError && threw.code === "workspace-file-write/outside-workspace", String(threw))
  check("escaping path never reached the seam", seam.files.size === 0)
}

// 10. A directory target is refused (the seam would fail it as a raw EISDIR).
{
  const seam = makeFsSeam()
  const { svc } = makeWriteService(seam)
  let threw = null
  try {
    await svc.writeFile({ sessionId: "t", workspaceRoot: REPO }, "src", "x", undefined, undefined)
  } catch (err) { threw = err }
  check("directory target throws RemoteError(workspace-file-write/not-regular-file)",
    threw instanceof RemoteError && threw.code === "workspace-file-write/not-regular-file", String(threw))
}

// 11. Seam refusals map onto the face's own vocabulary (sandbox → outside-workspace).
{
  const { svc } = makeWriteService(makeFsSeam({ failWith: "FS_SANDBOX_DENIED" }))
  let threw = null
  try {
    await svc.writeFile({ sessionId: "t", workspaceRoot: REPO }, "src/__contract-tmp__.txt", "x", undefined, undefined)
  } catch (err) { threw = err }
  check("FS_SANDBOX_DENIED maps to workspace-file-write/outside-workspace",
    threw instanceof RemoteError && threw.code === "workspace-file-write/outside-workspace", String(threw))
}

// 12. An unmapped seam code collapses to a generic failure, never a raw code.
{
  const { svc } = makeWriteService(makeFsSeam({ failWith: "FS_IO_ERROR" }))
  let threw = null
  try {
    await svc.writeFile({ sessionId: "t", workspaceRoot: REPO }, "src/__contract-tmp__.txt", "x", undefined, undefined)
  } catch (err) { threw = err }
  check("FS_IO_ERROR collapses to workspace-file-write/failed",
    threw instanceof RemoteError && threw.code === "workspace-file-write/failed", String(threw))
}

// 13. A missing workspace root is refused with the same code the sibling file ops use.
{
  const { svc } = makeWriteService(makeFsSeam())
  let threw = null
  try {
    await svc.writeFile({ sessionId: "t", workspaceRoot: "" }, "a.txt", "x", undefined, undefined)
  } catch (err) { threw = err }
  check("missing workspace root throws RemoteError(ide-tools/no-workspace)",
    threw instanceof RemoteError && threw.code === "ide-tools/no-workspace", String(threw))
}

// 14. The write is stamped with the SESSION's fence, never the seam's fallback.
//
// The seam's own fallback is the deployment root — the cwd of the `dsh web`
// process. A server launched outside the workspace denied every save with
// "file access denied under workspace-write mode" until the save path resolved
// a policy per call (2026-09-17), so both halves are pinned: the standing mode
// comes from the policy service, and the boundary is the Session's directory.
{
  const seam = makeFsSeam()
  const { svc, asked } = makeWriteService(seam)
  const scope = { sessionId: "sess-1", workspaceRoot: REPO }
  await svc.writeFile(scope, "src/__contract-tmp__.txt", "x", undefined, undefined)
  const stamped = seam.policies[0]
  check("write stamps the Session's own fence",
    stamped?.mode === "workspace-write" && stamped?.workspaceRoot === REPO,
    JSON.stringify(seam.policies))
  check("write never falls back to the deployment root",
    stamped?.workspaceRoot !== "/deployment-cwd", JSON.stringify(stamped))
  check("the fence is resolved for the calling Session", asked.join(",") === "sess-1", asked.join(","))
}

// 15. A session standing at read-only keeps its fence: the refusal is the
// seam's, and this face reports it rather than widening the mode to make a save
// succeed. (The code is the seam's single denial code for both boundaries.)
{
  const seam = makeFsSeam({ failWith: "FS_SANDBOX_DENIED" })
  const { svc } = makeWriteService(seam, { mode: "read-only" })
  let threw = null
  try {
    await svc.writeFile({ sessionId: "s", workspaceRoot: REPO }, "src/__contract-tmp__.txt", "x", undefined, undefined)
  } catch (err) { threw = err }
  check("a read-only Session's refusal is reported, not overridden",
    seam.policies[0]?.mode === "read-only"
    && threw instanceof RemoteError && threw.code === "workspace-file-write/outside-workspace",
    JSON.stringify(seam.policies) + " / " + String(threw))
}

// 16. A save racing a reconnect (Session no longer live) still fences against
// the host-derived scope root instead of the deployment root.
{
  const seam = makeFsSeam()
  const { svc } = makeWriteService(seam, { live: false })
  await svc.writeFile({ sessionId: "gone", workspaceRoot: REPO }, "src/__contract-tmp__.txt", "x", undefined, undefined)
  check("a dead Session falls back to the host-derived workspace root",
    seam.policies[0]?.workspaceRoot === REPO && seam.policies[0]?.mode === "workspace-write",
    JSON.stringify(seam.policies))
}

if (failures > 0) { console.error(failures + " contract check(s) failed"); process.exit(1) }
console.log("remote wire contract: all checks passed")
