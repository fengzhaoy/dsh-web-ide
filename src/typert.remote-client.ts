/* Hand-written in the @deepseek-ai/dsh-typert-generator remote-client format
 * (see dsh-api-workspace-files/lib/typert.remote-client.js). Value-imported and
 * inlined by the package's own client bundle, then $mounted onto the browser's
 * Remote service. */
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
const _ide_tools_ideTools_gitCommit_result$schema = z.object({
  'committed': z.boolean().readonly(),
  'hash': z.string().optional().readonly(),
}).readonly()
const _ide_tools_ideTools_gitStageAll_result$schema = z.void()
const _ide_tools_ideTools_gitGenerateCommitMessage_result$schema = z.object({
  'message': z.string().readonly(),
}).readonly()

const _scope_parameter = (typeSymbol: string) => ({
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

export const TYPERT_REMOTE = {
  package: '@zhaoyang10/dsh-client-ui-ide',
  descriptors: [
    {
      id: '@zhaoyang10/dsh-client-ui-ide#ideTools/search',
      service: 'ideTools',
      namespace: 'ideTools',
      method: 'search',
      invocation: { kind: 'direct' },
      parameters: [
        _scope_parameter('@deepseek-ai/dsh-session/types#SessionId'),
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
        _scope_parameter('@deepseek-ai/dsh-session/types#SessionId'),
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
        _scope_parameter('@deepseek-ai/dsh-session/types#SessionId'),
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
        _scope_parameter('@deepseek-ai/dsh-session/types#SessionId'),
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
        _scope_parameter('@deepseek-ai/dsh-session/types#SessionId'),
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
        _scope_parameter('@deepseek-ai/dsh-session/types#SessionId'),
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
        _scope_parameter('@deepseek-ai/dsh-session/types#SessionId'),
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
        _scope_parameter('@deepseek-ai/dsh-session/types#SessionId'),
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
        _scope_parameter('@deepseek-ai/dsh-session/types#SessionId'),
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
        _scope_parameter('@deepseek-ai/dsh-session/types#SessionId'),
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
        _scope_parameter('@deepseek-ai/dsh-session/types#SessionId'),
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
      id: '@zhaoyang10/dsh-client-ui-ide#ideTools/gitGenerateCommitMessage',
      service: 'ideTools',
      namespace: 'ideTools',
      method: 'gitGenerateCommitMessage',
      invocation: { kind: 'direct' },
      parameters: [
        _scope_parameter('@deepseek-ai/dsh-session/types#SessionId'),
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
}
export default TYPERT_REMOTE
