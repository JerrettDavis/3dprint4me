export function createAuthClient({ client }) {
  if (!client) throw new Error("An auth client adapter is required.");
  return {
    signIn: provider => client.signIn.social({ provider, callbackURL: location.href }),
    getSession: () => client.getSession(), signOut: () => client.signOut(),
    subscribe: listener => client.$store?.listen?.("session", listener) ?? (() => {})
  };
}
