import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
import { PutioError } from "./api/putio";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ComingUp } from "./pages/ComingUp";
import { Files } from "./pages/Files";
import { Browse, Home } from "./pages/Home";
import { Library } from "./pages/Library";
import { ListPage } from "./pages/ListPage";
import { Person } from "./pages/Person";
import { Surprise } from "./pages/Surprise";
import { Trash } from "./pages/Trash";
import { Search } from "./pages/Search";
import { Settings } from "./pages/Settings";
import { SignIn } from "./pages/SignIn";
import { Title } from "./pages/Title";
import { MyListProvider, ToastProvider, useAccount, useOldFolderMerge, usePositionChecks } from "./state/hooks";
import { SessionProvider, useSession } from "./state/session";

// The player brings hls.js: loaded only when something plays.
const Player = lazy(() => import("./pages/Player").then((m) => ({ default: m.Player })));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

function Routed() {
  const { putio, signOut } = useSession();
  const account = useAccount();
  useOldFolderMerge();
  usePositionChecks({ onFocus: true });
  // put.io no longer accepts the sign-in (revoked or expired): back to signing in.
  useEffect(() => {
    if (account.error instanceof PutioError && account.error.status === 401) signOut();
  }, [account.error, signOut]);
  if (!putio) return <SignIn />;
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/movies" element={<Browse key="movie" kind="movie" />} />
      <Route path="/tv" element={<Browse key="tv" kind="tv" />} />
      <Route path="/coming-up" element={<ComingUp />} />
      <Route path="/search" element={<Search />} />
      <Route path="/library" element={<Library />} />
      <Route path="/files" element={<Files />} />
      <Route path="/files/:folderID" element={<Files />} />
      <Route path="/title/:kind/:id" element={<Title />} />
      <Route path="/play/:fileID" element={<Suspense fallback={<div className="player" />}><Player /></Suspense>} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/person/:id" element={<Person />} />
      <Route path="/surprise" element={<Surprise />} />
      <Route path="/trash" element={<Trash />} />
      <Route path="/list/:source/:id" element={<ListPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <MyListProvider>
          <ToastProvider>
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <Routed />
            </BrowserRouter>
          </ToastProvider>
        </MyListProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
