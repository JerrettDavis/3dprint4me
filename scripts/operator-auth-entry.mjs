import { createInternalNeonAuth } from "@neondatabase/auth";

export function createNeonBrowserAuth(baseUrl) {
  const auth = createInternalNeonAuth(baseUrl);
  return { client: auth.adapter, getToken: auth.getJWTToken };
}
