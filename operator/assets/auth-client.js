export function createAuthClient({ client, getToken = async () => null }) {
  if (!client) throw new Error("An auth client adapter is required.");
  return {
    signIn: provider => client.signIn.social({ provider, callbackURL: location.href }),
    getSession: () => client.getSession(), signOut: () => client.signOut(),
    subscribe: listener => client.$store?.listen?.("session", listener) ?? (() => {}),
    async sessionHeaders() { const token = await getToken(); return token ? { authorization: `Bearer ${token}` } : {}; }
  };
}
