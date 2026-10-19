import React from "react";
import { Routes, Route } from "react-router-dom";
import AppLayout from "./layouts/AppLayout";
import { LoginScreen } from "./components/LoginScreen";
import { useAuth } from "./hooks/useAuth";
import Dashboard from "./pages/Dashboard";
import AllItems from "./pages/AllItems";
import Links from "./pages/Links";
import Notes from "./pages/Notes";
import Snippets from "./pages/Snippets";
import Credentials from "./pages/Credentials";
import Favorites from "./pages/Favorites";
import Tags from "./pages/Tags";
import Archive from "./pages/Archive";
import Settings from "./pages/Settings";
import ItemDetail from "./pages/ItemDetail";

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
        <Route path="links" element={<Links />} />
        <Route path="notes" element={<Notes />} />
        <Route path="snippets" element={<Snippets />} />
        <Route path="credentials" element={<Credentials />} />
        <Route path="favorites" element={<Favorites />} />
        <Route path="tags" element={<Tags />} />
        <Route path="tags/:tag" element={<Tags />} />
        <Route path="archive" element={<Archive />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
