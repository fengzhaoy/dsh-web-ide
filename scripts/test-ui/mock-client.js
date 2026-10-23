// Mock ideTools client for smoke test — verifies bridge methods exist on the remote face
window.__DSH_BOOT__ = {
  slots: {},
  services: {},
}
const mockIdeTools = {
  hostPlatform: async () => ({ ok: true, value: 'darwin' }),
  search: async () => ({ ok: true, value: { matches: [], truncated: false, totalMatches: 0 } }),
  gitStatus: async () => ({ ok: true, value: { branch: 'main', ahead: 0, behind: 0, entries: [] } }),
  bridgePublishState: async () => ({ ok: true, value: 1 }),
  bridgeClearState: async () => ({ ok: true, value: undefined }),
  bridgeDrainEvents: async () => ({ ok: true, value: { events: [], now: Date.now() } }),
  bridgeAsk: async () => ({ ok: true, value: { ok: true, sessionId: 'test' } }),
  bridgeFollow: async function* () {},
  bridgeThreadSnapshot: async () => ({ ok: true, value: { unchanged: true } }),
  bridgeSetDialogOpen: async () => ({ ok: true, value: undefined }),
  bridgeApprovals: async () => ({ ok: true, value: { items: [], rev: 0 } }),
  bridgeApprove: async () => ({ ok: true, value: true }),
  bridgeFimComplete: async () => ({ ok: true, value: { ok: false, error: 'no key' } }),
  bridgeStatus: async () => ({ ok: true, value: { toolsRegistered: true, observations: true, fim: false, sessionsBridged: 0, pendingApprovals: 0 } }),
}
window.mockIdeTools = mockIdeTools
console.log('mock ideTools ready, bridge methods:', Object.keys(mockIdeTools).filter(k => k.startsWith('bridge')).join(', '))
