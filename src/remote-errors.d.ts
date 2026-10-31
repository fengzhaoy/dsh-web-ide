/**
 * Declaration-merge this plugin's Remote failure vocabulary into the typert
 * protocol's extensible {@link RemoteErrorDetailsMap}. DSH 0.2.0 narrowed
 * `RemoteError`'s `code` argument to `keyof RemoteErrorDetailsMap`; every
 * owner must declare its own domain codes next to the throwing code, the same
 * pattern `@deepseek-ai/dsh-api-workspace-files` uses for its
 * `workspace-file/*` codes.
 *
 * Every details payload is permissive (all-optional + open index signature):
 * the throw sites across this package pass plain diagnostic objects (`{}` or
 * `{ path }`), and the wire only carries them for client-side messages, so the
 * structural field names document intent without binding every throw site to
 * populate them. This file is type-only: it carries no runtime and is picked
 * up by tsconfig's include:["src"].
 */
import '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** A malformed or empty request argument (empty pattern, bad ref, ...). */
    'ide-tools/bad-request': { readonly [key: string]: unknown }
    /** A workspace-relative path that escapes the workspace root. */
    'ide-tools/bad-path': { readonly path?: string; readonly [key: string]: unknown }
    /** No Session workspace root is available for the call. */
    'ide-tools/no-workspace': { readonly [key: string]: unknown }
    /** The workspace root is not inside a git repository. */
    'ide-tools/not-a-repo': { readonly [key: string]: unknown }
    /** A debug target could not be started. */
    'ide-tools/debug-failed': { readonly [key: string]: unknown }
    /** The debug target never printed an inspector address. */
    'ide-tools/debug-timeout': { readonly [key: string]: unknown }
    /** The debug target exited before the inspector came up. */
    'ide-tools/debug-exited': { readonly [key: string]: unknown }
    /** No debug target with that id is open in the calling Session. */
    'ide-tools/no-such-debug-target': { readonly targetId?: string; readonly [key: string]: unknown }
    /** A git command failed to start or reported a non-zero exit. */
    'ide-tools/git-failed': { readonly [key: string]: unknown }
    /** git checkout failed (conflict, missing ref, dirty tree, ...). */
    'ide-tools/git-checkout-failed': { readonly [key: string]: unknown }
    /** git branch create/delete failed. */
    'ide-tools/git-branch-failed': { readonly [key: string]: unknown }
    /** git fetch failed. */
    'ide-tools/git-fetch-failed': { readonly [key: string]: unknown }
    /** A git invocation exceeded the host's hard time budget and was
     *  terminated (huge repo, network filesystem, stale index.lock). */
    'ide-tools/git-timeout': { readonly [key: string]: unknown }
    /** An inline completion exceeded its (short) deadline. Expected under load;
     *  the client simply shows no ghost text. */
    'ide-tools/inline-timeout': { readonly [key: string]: unknown }
    /** The model call behind an inline completion failed. */
    'ide-tools/llm-failed': { readonly [key: string]: unknown }
    /** The model returned no usable text. */
    'ide-tools/llm-empty': { readonly [key: string]: unknown }
    /** git add / stage failed. */
    'ide-tools/git-stage-failed': { readonly [key: string]: unknown }
    /** git reset HEAD (unstage) failed. */
    'ide-tools/git-unstage-failed': { readonly [key: string]: unknown }
    /** git restore / discard failed. */
    'ide-tools/git-discard-failed': { readonly [key: string]: unknown }
    /** git commit failed. */
    'ide-tools/git-commit-failed': { readonly [key: string]: unknown }
    /** The commit SUCCEEDED but a follow-up pull/push did not — carries the
     *  created hash so the client can report "committed, push failed" instead
     *  of claiming nothing was committed. */
    'ide-tools/git-commit-push-failed': {
      readonly committed?: boolean
      readonly hash?: string
      readonly [key: string]: unknown
    }
    /** git pull/push sync failed. */
    'ide-tools/git-sync-failed': { readonly [key: string]: unknown }
    /** The terminal id is unknown (never opened, or already gone). */
    'ide-tools/no-such-terminal': { readonly terminalId?: string; readonly [key: string]: unknown }
    /** The terminal has already exited. */
    'ide-tools/terminal-exited': { readonly terminalId?: string; readonly [key: string]: unknown }
    /** A file/directory already exists at the target path. */
    'ide-tools/exists': { readonly path?: string; readonly [key: string]: unknown }
    /** A rename failed. */
    'ide-tools/rename-failed': { readonly [key: string]: unknown }
    /** A delete failed. */
    'ide-tools/delete-failed': { readonly [key: string]: unknown }
    /** A create failed. */
    'ide-tools/create-failed': { readonly [key: string]: unknown }
    /** A move (drag & drop) failed. */
    'ide-tools/move-failed': { readonly [key: string]: unknown }
    /** A copy (paste) failed. */
    'ide-tools/copy-failed': { readonly [key: string]: unknown }
    /** Reveal-in-OS-Finder failed. */
    'ide-tools/reveal-failed': { readonly [key: string]: unknown }
    /** A workspace path was not found. */
    'ide-tools/not-found': { readonly path?: string; readonly [key: string]: unknown }
    /** The working tree has no changes to commit. */
    'ide-tools/no-changes': { readonly [key: string]: unknown }
    /** No LLM is configured / available. */
    'ide-tools/llm-unavailable': { readonly [key: string]: unknown }
    /** No model is selected. */
    'ide-tools/no-model': { readonly [key: string]: unknown }
    /** The LLM stream failed. */
    'ide-tools/llm-failed': { readonly [key: string]: unknown }
    /** The LLM returned an empty message. */
    'ide-tools/llm-empty': { readonly [key: string]: unknown }
    /** The call was cancelled. */
    'ide-tools/aborted': { readonly [key: string]: unknown }

    /** The write was refused because the target is not a regular file. */
    'workspace-file-write/not-regular-file': { readonly path?: string; readonly [key: string]: unknown }
    /** The write was refused because the path is outside the workspace. */
    'workspace-file-write/outside-workspace': { readonly path?: string; readonly [key: string]: unknown }
    /** The optimistic version guard detected a stale version. */
    'workspace-file-write/stale-version': { readonly [key: string]: unknown }
    /** The target already exists (createIfAbsent refused). */
    'workspace-file-write/already-exists': { readonly [key: string]: unknown }
    /** The target was not found. */
    'workspace-file-write/not-found': { readonly [key: string]: unknown }
    /** The target content is not decodable text. */
    'workspace-file-write/not-text': { readonly [key: string]: unknown }
    /** The target is too large to write. */
    'workspace-file-write/too-large': { readonly [key: string]: unknown }
    /** Permission was denied. */
    'workspace-file-write/permission-denied': { readonly [key: string]: unknown }
    /** A generic write failure (unmapped fs-seam code). */
    'workspace-file-write/failed': { readonly [key: string]: unknown }
  }
}
