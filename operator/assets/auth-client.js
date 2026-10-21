export function createAuthClient({ client, getToken = async () => null }) {
  if (!client) throw new Error("An auth client adapter is required.");
  return {
    signIn: provider => client.signIn.social({ provider, callbackURL: location.href }),
    getSession: () => client.getSession(), signOut: () => client.signOut(),
    subscribe: listener => client.$store?.listen?.("session", listener) ?? (() => {}),
    async sessionHeaders() { const token = await getToken(); return token ? { authorization: `Bearer ${token}` } : {}; }
  };
}

export function createCookieAuthClient({apiBase,navigate=url=>location.assign(url),fetchImpl=fetch}) {
  if(apiBase!=='https://api.3dprint4.me')throw new Error('Invalid sign-in endpoint.');
  return {
    signIn:async()=>navigate(apiBase+'/api/auth/login'),
    sessionHeaders:async()=>({}),
    async signOut() {
      const response=await fetchImpl(apiBase+'/api/auth/logout',{method:'POST',credentials:'include',cache:'no-store',redirect:'error'});
      if(!response.ok)throw new Error('Sign-out could not be completed.');
    }
  };
}
