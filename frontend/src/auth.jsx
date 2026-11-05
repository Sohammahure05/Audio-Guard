import { createContext, useContext, useEffect, useState } from "react";

const KEY = "mh-auth";
const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

function read() {
  try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; }
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(read);
  const signIn = (data) => { sessionStorage.setItem(KEY, JSON.stringify(data)); setAuth(data); };
  const signOut = () => { sessionStorage.removeItem(KEY); setAuth(null); };

  useEffect(() => {
    window.addEventListener("mh-signout", signOut);
    return () => window.removeEventListener("mh-signout", signOut);
  }, []);

  return <Ctx.Provider value={{ auth, signIn, signOut }}>{children}</Ctx.Provider>;
}
