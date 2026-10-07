// Only loaded by the isolated browser check, never by the Android entry point.
let connection = null;
window.walletCalls = [];
export const externalWallet = {
  read: async () => connection,
  connect: async () => {
    window.walletCalls.push('connect');
    if (window.cancelNextWalletConnection) {
      window.cancelNextWalletConnection = false;
      throw new Error('Connection cancelled');
    }
    connection = { version: 1, address: '7YttLkHDoNj9wyDur5H7Myd5FWGaBMPLys5aeQ3dJKXS', authToken: 'test-token' };
    return connection;
  },
  disconnect: async () => { window.walletCalls.push('disconnect'); connection = null; },
};
export const pendingStore = { load: async () => null };
