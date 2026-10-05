// Only loaded by the isolated browser check, never by the Android entry point.
export const localSettings = { readWallet: async () => null };
export const externalWallet = { read: async () => null };
export const pendingStore = { load: async () => null };
export const pickWallet = async () => null;
