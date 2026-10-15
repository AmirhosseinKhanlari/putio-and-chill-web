import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { ChillClient } from "../api/chill";
import { PutioClient } from "../api/putio";
import { library } from "../lib/library";
import { keys, readString, writeString } from "../lib/storage";

interface Session {
  putio?: PutioClient;
  chill?: ChillClient;
  setPutioToken: (token: string | null) => void;
  setChillToken: (token: string | null) => void;
  signOut: () => void;
}

const SessionContext = createContext<Session | null>(null);

/** chill.institute sends people back with #auth_token=… on the address they started from. */
function takeChillTokenFromAddress(): string | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token = hash.get("auth_token")?.trim();
  if (!token) return null;
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  writeString(keys.chillToken, token);
  return token;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [putioToken, setPutio] = useState(() => readString(keys.putioToken));
  const [chillToken, setChill] = useState(() => takeChillTokenFromAddress() ?? readString(keys.chillToken));

  const setPutioToken = useCallback((token: string | null) => {
    writeString(keys.putioToken, token);
    setPutio(token);
  }, []);
  const setChillToken = useCallback((token: string | null) => {
    writeString(keys.chillToken, token);
    setChill(token);
  }, []);
  const signOut = useCallback(() => {
    setPutioToken(null);
    setChillToken(null);
    // Another account must never see this one's library.
    library.clear();
  }, [setPutioToken, setChillToken]);

  const value = useMemo<Session>(() => ({
    putio: putioToken ? new PutioClient(putioToken) : undefined,
    chill: chillToken ? new ChillClient(chillToken) : undefined,
    setPutioToken, setChillToken, signOut,
  }), [putioToken, chillToken, setPutioToken, setChillToken, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside SessionProvider");
  return session;
}

/** For screens shown only when signed in. */
export function usePutio(): PutioClient {
  const { putio } = useSession();
  if (!putio) throw new Error("Not signed in to put.io");
  return putio;
}
