import { lazy } from "react";
import { Routes, Route } from "react-router-dom";
import AppLayout from "./layouts/AppLayout";
import { LoginScreen } from "./components/LoginScreen";
import { useAuth } from "./hooks/useAuth";

// Route-level splitting: the shell plus the login screen are the only eager
// chunks. The layout's Suspense boundary covers the lazy pages.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const AllItems = lazy(() => import("./pages/AllItems"));
const TypeItems = lazy(() => import("./pages/TypeItems"));
const Favorites = lazy(() => import("./pages/Favorites"));
const Tags = lazy(() => import("./pages/Tags"));
const Archive = lazy(() => import("./pages/Archive"));
const Settings = lazy(() => import("./pages/Settings"));
const ItemDetail = lazy(() => import("./pages/ItemDetail"));

export default function App() {
  const { authed } = useAuth();

  // null = session check in flight; render nothing rather than flash the login.
  if (authed === null) return null;
  if (!authed) return <LoginScreen />;

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="items" element={<AllItems />} />
        <Route path="items/:id" element={<ItemDetail />} />
        <Route path="links" element={<TypeItems type="link" />} />
        <Route path="notes" element={<TypeItems type="note" />} />
        <Route path="snippets" element={<TypeItems type="snippet" />} />
        <Route path="credentials" element={<TypeItems type="credential" />} />
        <Route path="favorites" element={<Favorites />} />
        <Route path="tags" element={<Tags />} />
        <Route path="tags/:tag" element={<Tags />} />
        <Route path="archive" element={<Archive />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
