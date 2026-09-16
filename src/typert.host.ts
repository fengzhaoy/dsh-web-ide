/* Hand-written in the @deepseek-ai/dsh-typert-generator host-face format (see
 * dsh-api-workspace-files/lib/typert.host.js). The typert loader validates every
 * field: strict zod v4 codecs, lookup parameter reusing the read API's
 * workspaceFileScope, cancellation on the trailing signal. */
import { z } from 'zod'

const _ide_tools_ideTools_search_parameter_0$schema = z.intersection(z.string(), z.unknown())
const _ide_tools_ideTools_search_parameter_1$schema = z.object({
  'pattern': z.string().readonly(),
  'include': z.string().optional(),
  'path': z.string().optional(),
  'caseSensitive': z.boolean().readonly(),
})
const _ide_tools_ideTools_search_result$schema = z.object({
  'matches': z.array(z.object({
    'path': z.string().readonly(),
    'lineNumber': z.number().readonly(),
    'line': z.string().readonly(),
  }).readonly()).readonly(),
  'truncated': z.boolean().readonly(),
  'totalMatches': z.number().readonly(),
}).readonly()

const _ide_tools_ideTools_terminalOpen_parameter_1$schema = z.object({
  'cols': z.number().readonly(),
  'rows': z.number().readonly(),
  'command': z.string().optional(),
}).readonly()
const _ide_tools_ideTools_terminalOpen_result$schema = z.object({
  'terminalId': z.string().readonly(),
  'pid': z.number().readonly(),
}).readonly()

const _ide_tools_ideTools_terminalWrite_parameter_2$schema = z.string()
const _ide_tools_ideTools_terminalWrite_result$schema = z.void()

const _ide_tools_ideTools_terminalSignal_parameter_2$schema = z.union([
  z.literal('SIGINT'),
  z.literal('SIGTERM'),
  z.literal('SIGKILL'),
  z.literal('SIGTSTP'),
  z.literal('SIGHUP'),
])
const _ide_tools_ideTools_terminalSignal_result$schema = z.void()

const _ide_tools_ideTools_terminalTerminate_parameter_1$schema = z.string()
const _ide_tools_ideTools_terminalTerminate_result$schema = z.void()

const _ide_tools_ideTools_terminalOutput_parameter_1$schema = z.string()
const _ide_tools_ideTools_terminalOutput_result$schema = z.object({
  'data': z.string().readonly(),
  'exit': z.boolean().readonly(),
}).readonly()

const _ide_tools_ideTools_gitStatus_result$schema = z.object({
  'notARepo': z.boolean().readonly(),
  'branch': z.string().nullable().readonly(),
  'upstream': z.string().nullable().readonly(),
  'ahead': z.number().readonly(),
  'behind': z.number().readonly(),
  'detached': z.boolean().readonly(),
  'entries': z.array(z.object({
    'path': z.string().readonly(),
    'oldPath': z.string().optional(),
    'statusCode': z.string().readonly(),
    'kind': z.union([
      z.literal('modified'), z.literal('added'), z.literal('deleted'),
      z.literal('renamed'), z.literal('untracked'), z.literal('ignored'),
      z.literal('conflicted'), z.literal('unmodified'),
    ]).readonly(),
  }).readonly()).readonly(),
  'clean': z.boolean().readonly(),
}).readonly()

const _ide_tools_ideTools_gitBranches_result$schema = z.object({
  'notARepo': z.boolean().readonly(),
  'branches': z.array(z.object({
    'name': z.string().readonly(),
    'current': z.boolean().readonly(),
    'upstream': z.string().optional(),
    'ahead': z.number().optional(),
    'behind': z.number().optional(),
    'lastCommit': z.string().optional(),
    'lastCommitDate': z.string().optional(),
  }).readonly()).readonly(),
  'current': z.string().nullable().readonly(),
}).readonly()

const _ide_tools_ideTools_gitDiff_parameter_1$schema = z.string()
const _ide_tools_ideTools_gitDiff_parameter_2$schema = z.union([
  z.literal('unstaged'), z.literal('staged'), z.literal('head'),
])
const _ide_tools_ideTools_gitDiff_result$schema = z.object({
  'empty': z.boolean().readonly(),
  'diff': z.string().readonly(),
  'oldContent': z.string().readonly(),
  'newContent': z.string().readonly(),
  'oldPath': z.string().readonly(),
  'newPath': z.string().readonly(),
  'language': z.string().readonly(),
  'contentType': z.union([z.literal('text'), z.literal('image')]).optional().readonly(),
  'imageBase64': z.string().optional().readonly(),
}).readonly()

const _ide_tools_ideTools_gitCommit_parameter_1$schema = z.string()
const _ide_tools_ideTools_gitCommit_parameter_2$schema = z.object({
  'amend': z.boolean().optional().readonly(),
  'signoff': z.boolean().optional().readonly(),
  'push': z.boolean().optional().readonly(),
  'sync': z.boolean().optional().readonly(),
}).readonly()
const _ide_tools_ideTools_gitCommit_result$schema = z.object({
  'committed': z.boolean().readonly(),
  'hash': z.string().optional().readonly(),
  'pushed': z.boolean().optional().readonly(),
}).readonly()
const _ide_tools_ideTools_gitStageAll_result$schema = z.void()
const _ide_tools_ideTools_gitStage_parameter_1$schema = z.string()
const _ide_tools_ideTools_gitStage_result$schema = z.void()
const _ide_tools_ideTools_gitDiscard_parameter_1$schema = z.object({
  'path': z.string().readonly(),
  'oldPath': z.string().optional(),
  'kind': z.union([
    z.literal('modified'), z.literal('added'), z.literal('deleted'),
    z.literal('renamed'), z.literal('untracked'), z.literal('ignored'),
    z.literal('conflicted'), z.literal('unmodified'),
  ]).readonly(),
}).readonly()
const _ide_tools_ideTools_gitDiscard_result$schema = z.void()
const _ide_tools_ideTools_fileRename_parameter_1$schema = z.string()
const _ide_tools_ideTools_fileRename_parameter_2$schema = z.string()
const _ide_tools_ideTools_fileRename_result$schema = z.void()
const _ide_tools_ideTools_fileDelete_parameter_1$schema = z.string()
const _ide_tools_ideTools_fileDelete_parameter_2$schema = z.union([
  z.literal('file'), z.literal('directory'),
])
const _ide_tools_ideTools_fileDelete_result$schema = z.void()
const _ide_tools_ideTools_fileCreate_parameter_1$schema = z.string()
const _ide_tools_ideTools_fileCreate_parameter_2$schema = z.union([
  z.literal('file'), z.literal('directory'),
])
const _ide_tools_ideTools_fileCreate_result$schema = z.void()
const _ide_tools_ideTools_fileReveal_parameter_1$schema = z.string()
const _ide_tools_ideTools_fileReveal_result$schema = z.void()
const _ide_tools_ideTools_hostPlatform_result$schema = z.string()
const _ide_tools_ideTools_gitSync_parameter_1$schema = z.union([
  z.literal('sync'),
  z.literal('publish'),
])
const _ide_tools_ideTools_gitSync_result$schema = z.object({
  'pushed': z.boolean().readonly(),
}).readonly()
const _ide_tools_ideTools_gitGenerateCommitMessage_result$schema = z.object({
  'message': z.string().readonly(),
}).readonly()

const _scope_parameter = (method: string, index: number, typeSymbol: string) => ({
  name: 'workspaceFileScope',
  wire: 'workspaceFileScopeId',
  source: 'lookup',
  lookup: 'workspaceFileScope',
  codec: {
    mode: 'strict',
    typeSymbol,
    schema: _ide_tools_ideTools_search_parameter_0$schema,
  },
})

export const TYPERT = {
  package: '@zhaoyang10/dsh-client-ui-ide',
  face: 'host',
  schemas: [
  ],
  invocations: [
    {
      id: '@zhaoyang10/dsh-client-ui-ide#ideTools/search',
      service: 'ideTools',
      namespace: 'ideTools',
      method: 'search',
      invocation: { kind: 'direct' },
      parameters: [
        _scope_parameter('search', 0, '@deepseek-ai/dsh-session/types#SessionId'),
        {
          name: 'query',
          wire: 'query',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/search:query',
            schema: _ide_tools_ideTools_search_parameter_1$schema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: '@zhaoyang10/dsh-client-ui-ide/types#IdeSearchResult',
        schema: _ide_tools_ideTools_search_result$schema,
      },
      sourceLocation: { file: 'src/index.ts', line: 119, column: 3 },
    },
    {
      id: '@zhaoyang10/dsh-client-ui-ide#ideTools/terminalOpen',
      service: 'ideTools',
      namespace: 'ideTools',
      method: 'terminalOpen',
      invocation: { kind: 'direct' },
      parameters: [
        _scope_parameter('terminalOpen', 0, '@deepseek-ai/dsh-session/types#SessionId'),
        {
          name: 'spec',
          wire: 'spec',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/terminalOpen:spec',
            schema: _ide_tools_ideTools_terminalOpen_parameter_1$schema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: '@zhaoyang10/dsh-client-ui-ide/types#IdeTerminalOpenResult',
        schema: _ide_tools_ideTools_terminalOpen_result$schema,
      },
      sourceLocation: { file: 'src/index.ts', line: 150, column: 3 },
    },
    {
      id: '@zhaoyang10/dsh-client-ui-ide#ideTools/terminalWrite',
      service: 'ideTools',
      namespace: 'ideTools',
      method: 'terminalWrite',
      invocation: { kind: 'direct' },
      parameters: [
        _scope_parameter('terminalWrite', 0, '@deepseek-ai/dsh-session/types#SessionId'),
        {
          name: 'terminalId',
          wire: 'terminalId',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/terminalWrite:terminalId',
            schema: _ide_tools_ideTools_terminalWrite_parameter_2$schema,
          },
        },
        {
          name: 'data',
          wire: 'data',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/terminalWrite:data',
            schema: _ide_tools_ideTools_terminalWrite_parameter_2$schema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/terminalWrite:result',
        schema: _ide_tools_ideTools_terminalWrite_result$schema,
      },
      sourceLocation: { file: 'src/index.ts', line: 199, column: 3 },
    },
    {
      id: '@zhaoyang10/dsh-client-ui-ide#ideTools/terminalSignal',
      service: 'ideTools',
      namespace: 'ideTools',
      method: 'terminalSignal',
      invocation: { kind: 'direct' },
      parameters: [
        _scope_parameter('terminalSignal', 0, '@deepseek-ai/dsh-session/types#SessionId'),
        {
          name: 'terminalId',
          wire: 'terminalId',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/terminalSignal:terminalId',
            schema: _ide_tools_ideTools_terminalWrite_parameter_2$schema,
          },
        },
        {
          name: 'signalName',
          wire: 'signalName',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/terminalSignal:signalName',
            schema: _ide_tools_ideTools_terminalSignal_parameter_2$schema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/terminalSignal:result',
        schema: _ide_tools_ideTools_terminalSignal_result$schema,
      },
      sourceLocation: { file: 'src/index.ts', line: 219, column: 3 },
    },
    {
      id: '@zhaoyang10/dsh-client-ui-ide#ideTools/terminalTerminate',
      service: 'ideTools',
      namespace: 'ideTools',
      method: 'terminalTerminate',
      invocation: { kind: 'direct' },
      parameters: [
        _scope_parameter('terminalTerminate', 0, '@deepseek-ai/dsh-session/types#SessionId'),
        {
          name: 'terminalId',
          wire: 'terminalId',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/terminalTerminate:terminalId',
            schema: _ide_tools_ideTools_terminalTerminate_parameter_1$schema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/terminalTerminate:result',
        schema: _ide_tools_ideTools_terminalTerminate_result$schema,
      },
      sourceLocation: { file: 'src/index.ts', line: 233, column: 3 },
    },
    {
      id: '@zhaoyang10/dsh-client-ui-ide#ideTools/terminalOutput',
      service: 'ideTools',
      namespace: 'ideTools',
      method: 'terminalOutput',
      mode: 'stream',
      invocation: { kind: 'direct' },
      parameters: [
        _scope_parameter('terminalOutput', 0, '@deepseek-ai/dsh-session/types#SessionId'),
        {
          name: 'terminalId',
          wire: 'terminalId',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/terminalOutput:terminalId',
            schema: _ide_tools_ideTools_terminalOutput_parameter_1$schema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: '@zhaoyang10/dsh-client-ui-ide/types#IdeTerminalOutputFrame',
        schema: _ide_tools_ideTools_terminalOutput_result$schema,
      },
      sourceLocation: { file: 'src/index.ts', line: 247, column: 3 },
    },
    {
      id: '@zhaoyang10/dsh-client-ui-ide#ideTools/gitStatus',
      service: 'ideTools',
      namespace: 'ideTools',
      method: 'gitStatus',
      invocation: { kind: 'direct' },
      parameters: [
        _scope_parameter('gitStatus', 0, '@deepseek-ai/dsh-session/types#SessionId'),
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: '@zhaoyang10/dsh-client-ui-ide/types#GitStatusResult',
        schema: _ide_tools_ideTools_gitStatus_result$schema,
      },
      sourceLocation: { file: 'src/index.ts', line: 430, column: 3 },
    },
    {
      id: '@zhaoyang10/dsh-client-ui-ide#ideTools/gitBranches',
      service: 'ideTools',
      namespace: 'ideTools',
      method: 'gitBranches',
      invocation: { kind: 'direct' },
      parameters: [
        _scope_parameter('gitBranches', 0, '@deepseek-ai/dsh-session/types#SessionId'),
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: '@zhaoyang10/dsh-client-ui-ide/types#GitBranchesResult',
        schema: _ide_tools_ideTools_gitBranches_result$schema,
      },
      sourceLocation: { file: 'src/index.ts', line: 480, column: 3 },
    },
    {
      id: '@zhaoyang10/dsh-client-ui-ide#ideTools/gitDiff',
      service: 'ideTools',
      namespace: 'ideTools',
      method: 'gitDiff',
      invocation: { kind: 'direct' },
      parameters: [
        _scope_parameter('gitDiff', 0, '@deepseek-ai/dsh-session/types#SessionId'),
        {
          name: 'path',
          wire: 'path',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/gitDiff:path',
            schema: _ide_tools_ideTools_gitDiff_parameter_1$schema,
          },
        },
        {
          name: 'kind',
          wire: 'kind',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/gitDiff:kind',
            schema: _ide_tools_ideTools_gitDiff_parameter_2$schema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: '@zhaoyang10/dsh-client-ui-ide/types#GitDiffResult',
        schema: _ide_tools_ideTools_gitDiff_result$schema,
      },
      sourceLocation: { file: 'src/index.ts', line: 510, column: 3 },
    },
    {
      id: '@zhaoyang10/dsh-client-ui-ide#ideTools/gitCommit',
      service: 'ideTools',
      namespace: 'ideTools',
      method: 'gitCommit',
      invocation: { kind: 'direct' },
      parameters: [
        _scope_parameter('gitCommit', 0, '@deepseek-ai/dsh-session/types#SessionId'),
        {
          name: 'message',
          wire: 'message',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/gitCommit:message',
            schema: _ide_tools_ideTools_gitCommit_parameter_1$schema,
          },
        },
        {
          name: 'options',
          wire: 'options',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/gitCommit:options',
            schema: _ide_tools_ideTools_gitCommit_parameter_2$schema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: '@zhaoyang10/dsh-client-ui-ide/types#GitCommitResult',
        schema: _ide_tools_ideTools_gitCommit_result$schema,
      },
      sourceLocation: { file: 'src/index.ts', line: 636, column: 3 },
    },
    {
      id: '@zhaoyang10/dsh-client-ui-ide#ideTools/gitStageAll',
      service: 'ideTools',
      namespace: 'ideTools',
      method: 'gitStageAll',
      invocation: { kind: 'direct' },
      parameters: [
        _scope_parameter('gitStageAll', 0, '@deepseek-ai/dsh-session/types#SessionId'),
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: '@zhaoyang10/dsh-client-ui-ide/types#GitStageAllResult',
        schema: _ide_tools_ideTools_gitStageAll_result$schema,
      },
      sourceLocation: { file: 'src/index.ts', line: 636, column: 3 },
    },
    {
      id: '@zhaoyang10/dsh-client-ui-ide#ideTools/gitStage',
      service: 'ideTools',
      namespace: 'ideTools',
      method: 'gitStage',
      invocation: { kind: 'direct' },
      parameters: [
        _scope_parameter('gitStage', 0, '@deepseek-ai/dsh-session/types#SessionId'),
        {
          name: 'path',
          wire: 'path',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/gitStage:path',
            schema: _ide_tools_ideTools_gitStage_parameter_1$schema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: '@zhaoyang10/dsh-client-ui-ide/types#GitStageResult',
        schema: _ide_tools_ideTools_gitStage_result$schema,
      },
      sourceLocation: { file: 'src/index.ts', line: 700, column: 3 },
    },
    {
      id: '@zhaoyang10/dsh-client-ui-ide#ideTools/gitDiscard',
      service: 'ideTools',
      namespace: 'ideTools',
      method: 'gitDiscard',
      invocation: { kind: 'direct' },
      parameters: [
        _scope_parameter('gitDiscard', 0, '@deepseek-ai/dsh-session/types#SessionId'),
        {
          name: 'entry',
          wire: 'entry',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/gitDiscard:entry',
            schema: _ide_tools_ideTools_gitDiscard_parameter_1$schema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: '@zhaoyang10/dsh-client-ui-ide/types#GitDiscardResult',
        schema: _ide_tools_ideTools_gitDiscard_result$schema,
      },
      sourceLocation: { file: 'src/index.ts', line: 723, column: 3 },
    },
    {
      id: '@zhaoyang10/dsh-client-ui-ide#ideTools/fileRename',
      service: 'ideTools',
      namespace: 'ideTools',
      method: 'fileRename',
      invocation: { kind: 'direct' },
      parameters: [
        _scope_parameter('fileRename', 0, '@deepseek-ai/dsh-session/types#SessionId'),
        {
          name: 'path',
          wire: 'path',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/fileRename:path',
            schema: _ide_tools_ideTools_fileRename_parameter_1$schema,
          },
        },
        {
          name: 'newName',
          wire: 'newName',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/fileRename:newName',
            schema: _ide_tools_ideTools_fileRename_parameter_2$schema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: '@zhaoyang10/dsh-client-ui-ide/types#FileRenameResult',
        schema: _ide_tools_ideTools_fileRename_result$schema,
      },
      sourceLocation: { file: 'src/index.ts', line: 746, column: 3 },
    },
    {
      id: '@zhaoyang10/dsh-client-ui-ide#ideTools/fileDelete',
      service: 'ideTools',
      namespace: 'ideTools',
      method: 'fileDelete',
      invocation: { kind: 'direct' },
      parameters: [
        _scope_parameter('fileDelete', 0, '@deepseek-ai/dsh-session/types#SessionId'),
        {
          name: 'path',
          wire: 'path',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/fileDelete:path',
            schema: _ide_tools_ideTools_fileDelete_parameter_1$schema,
          },
        },
        {
          name: 'kind',
          wire: 'kind',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/fileDelete:kind',
            schema: _ide_tools_ideTools_fileDelete_parameter_2$schema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: '@zhaoyang10/dsh-client-ui-ide/types#FileDeleteResult',
        schema: _ide_tools_ideTools_fileDelete_result$schema,
      },
      sourceLocation: { file: 'src/index.ts', line: 792, column: 3 },
    },
    {
      id: '@zhaoyang10/dsh-client-ui-ide#ideTools/fileCreate',
      service: 'ideTools',
      namespace: 'ideTools',
      method: 'fileCreate',
      invocation: { kind: 'direct' },
      parameters: [
        _scope_parameter('fileCreate', 0, '@deepseek-ai/dsh-session/types#SessionId'),
        {
          name: 'path',
          wire: 'path',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/fileCreate:path',
            schema: _ide_tools_ideTools_fileCreate_parameter_1$schema,
          },
        },
        {
          name: 'kind',
          wire: 'kind',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/fileCreate:kind',
            schema: _ide_tools_ideTools_fileCreate_parameter_2$schema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: '@zhaoyang10/dsh-client-ui-ide/types#FileCreateResult',
        schema: _ide_tools_ideTools_fileCreate_result$schema,
      },
      sourceLocation: { file: 'src/index.ts', line: 838, column: 3 },
    },
    {
      id: '@zhaoyang10/dsh-client-ui-ide#ideTools/fileReveal',
      service: 'ideTools',
      namespace: 'ideTools',
      method: 'fileReveal',
      invocation: { kind: 'direct' },
      parameters: [
        _scope_parameter('fileReveal', 0, '@deepseek-ai/dsh-session/types#SessionId'),
        {
          name: 'path',
          wire: 'path',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/fileReveal:path',
            schema: _ide_tools_ideTools_fileReveal_parameter_1$schema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: '@zhaoyang10/dsh-client-ui-ide/types#FileRevealResult',
        schema: _ide_tools_ideTools_fileReveal_result$schema,
      },
      sourceLocation: { file: 'src/index.ts', line: 902, column: 3 },
    },
    {
      id: '@zhaoyang10/dsh-client-ui-ide#ideTools/hostPlatform',
      service: 'ideTools',
      namespace: 'ideTools',
      method: 'hostPlatform',
      invocation: { kind: 'direct' },
      parameters: [
        _scope_parameter('hostPlatform', 0, '@deepseek-ai/dsh-session/types#SessionId'),
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: '@zhaoyang10/dsh-client-ui-ide/types#HostPlatformResult',
        schema: _ide_tools_ideTools_hostPlatform_result$schema,
      },
      sourceLocation: { file: 'src/index.ts', line: 950, column: 3 },
    },
    {
      id: '@zhaoyang10/dsh-client-ui-ide#ideTools/gitSync',
      service: 'ideTools',
      namespace: 'ideTools',
      method: 'gitSync',
      invocation: { kind: 'direct' },
      parameters: [
        _scope_parameter('gitSync', 0, '@deepseek-ai/dsh-session/types#SessionId'),
        {
          name: 'action',
          wire: 'action',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@zhaoyang10/dsh-client-ui-ide#ideTools/gitSync:action',
            schema: _ide_tools_ideTools_gitSync_parameter_1$schema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: '@zhaoyang10/dsh-client-ui-ide/types#GitSyncResult',
        schema: _ide_tools_ideTools_gitSync_result$schema,
      },
      sourceLocation: { file: 'src/index.ts', line: 986, column: 3 },
    },
    {
      id: '@zhaoyang10/dsh-client-ui-ide#ideTools/gitGenerateCommitMessage',
      service: 'ideTools',
      namespace: 'ideTools',
      method: 'gitGenerateCommitMessage',
      invocation: { kind: 'direct' },
      parameters: [
        _scope_parameter('gitGenerateCommitMessage', 0, '@deepseek-ai/dsh-session/types#SessionId'),
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: '@zhaoyang10/dsh-client-ui-ide/types#GitGenerateCommitMessageResult',
        schema: _ide_tools_ideTools_gitGenerateCommitMessage_result$schema,
      },
      sourceLocation: { file: 'src/index.ts', line: 636, column: 3 },
    },
  ],
  model: {
    services: [
      {
        description: 'Host-backed IDE conveniences: workspace grep and interactive terminals.',
        summary: 'Host-backed IDE conveniences: workspace grep and interactive terminals.',
        tags: [],
        jsDoc: '/** Host-backed IDE conveniences: workspace grep and interactive terminals. */',
        key: 'ideTools',
        exportName: 'IdeTools',
        members: [
          {
            kind: 'method',
            name: 'search',
            signature: "@Remote async search( workspaceFileScope: WorkspaceFileScope, query: { pattern: string; include?: string; path?: string; caseSensitive: boolean }, signal: AbortSignal, ): Promise<IdeSearchResult>",
            summary: 'Grep the workspace via the shared ripgrep machinery.',
            jsDoc: '/** Grep the workspace via the shared ripgrep machinery. */',
          },
          {
            kind: 'method',
            name: 'terminalOpen',
            signature: "@Remote async terminalOpen( workspaceFileScope: WorkspaceFileScope, spec: { cols: number; rows: number; command?: string }, signal: AbortSignal, ): Promise<IdeTerminalOpenResult>",
            summary: 'Spawn one interactive login shell in the workspace root.',
            jsDoc: '/** Spawn one interactive login shell in the workspace root. */',
          },
          {
            kind: 'method',
            name: 'terminalWrite',
            signature: "@Remote async terminalWrite( workspaceFileScope: WorkspaceFileScope, terminalId: string, data: string, signal: AbortSignal, ): Promise<void>",
            summary: 'Deliver one base64 input chunk to the terminal.',
            jsDoc: '/** Deliver one base64 input chunk to the terminal. */',
          },
          {
            kind: 'method',
            name: 'terminalSignal',
            signature: "@Remote async terminalSignal( workspaceFileScope: WorkspaceFileScope, terminalId: string, signalName: 'SIGINT' | 'SIGTERM' | 'SIGKILL' | 'SIGTSTP' | 'SIGHUP', signal: AbortSignal, ): Promise<void>",
            summary: 'Signal the terminal foreground process group.',
            jsDoc: '/** Signal the terminal foreground process group. */',
          },
          {
            kind: 'method',
            name: 'terminalTerminate',
            signature: "@Remote async terminalTerminate( workspaceFileScope: WorkspaceFileScope, terminalId: string, signal: AbortSignal, ): Promise<void>",
            summary: 'Terminate the whole terminal session.',
            jsDoc: '/** Terminate the whole terminal session. */',
          },
          {
            kind: 'method',
            name: 'terminalOutput',
            signature: "@Remote({ mode: 'stream' }) async *terminalOutput( workspaceFileScope: WorkspaceFileScope, terminalId: string, signal: AbortSignal, ): AsyncGenerator<IdeTerminalOutputFrame, void, void>",
            summary: "Stream one terminal's output: replay log first, then live frames.",
            jsDoc: "/** Stream one terminal's output: replay log first, then live frames. */",
          },
          {
            kind: 'method',
            name: 'gitStatus',
            signature: "@Remote async gitStatus( workspaceFileScope: WorkspaceFileScope, signal: AbortSignal, ): Promise<GitStatusResult>",
            summary: "Snapshot the workspace's git status (branch, ahead/behind, changed files).",
            jsDoc: "/** Snapshot the workspace's git status (branch, ahead/behind, changed files). */",
          },
          {
            kind: 'method',
            name: 'gitBranches',
            signature: "@Remote async gitBranches( workspaceFileScope: WorkspaceFileScope, signal: AbortSignal, ): Promise<GitBranchesResult>",
            summary: 'List local branches with ahead/behind and last-commit metadata.',
            jsDoc: '/** List local branches with ahead/behind and last-commit metadata. */',
          },
          {
            kind: 'method',
            name: 'gitDiff',
            signature: "@Remote async gitDiff( workspaceFileScope: WorkspaceFileScope, path: string, kind: 'unstaged' | 'staged' | 'head', signal: AbortSignal, ): Promise<GitDiffResult>",
            summary: 'Fetch a unified diff (and old/new content) for one path.',
            jsDoc: '/** Fetch a unified diff (and old/new content) for one path. */',
          },
        ],
        types: [
          {
            name: 'IdeSearchResult',
            declaration: 'export interface IdeSearchResult {\n    readonly matches: readonly IdeSearchMatch[];\n    readonly truncated: boolean;\n    readonly totalMatches: number;\n}',
          },
          {
            name: 'IdeTerminalOpenResult',
            declaration: 'export interface IdeTerminalOpenResult {\n    readonly terminalId: string;\n    readonly pid: number;\n}',
          },
          {
            name: 'IdeTerminalOutputFrame',
            declaration: 'export interface IdeTerminalOutputFrame {\n    readonly data: string;\n    readonly exit: boolean;\n}',
          },
        ],
      },
    ],
    events: [],
    objects: [],
  },
}
export default TYPERT
