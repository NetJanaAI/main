import { Routes, Route, Navigate } from "react-router-dom";
import Landing from "./pages/Landing";
import Help from "./pages/Help";
import AppLayout from "./layouts/AppLayout";
import Meta from "./components/Meta";

// App Pages
import Dashboard from "./pages/app/Dashboard";
import Signals from "./pages/app/Signals";
import Query from "./pages/app/Query";
import Reports from "./pages/app/Reports";
import ApiManager from "./pages/app/ApiManager";
import Profile from "./pages/app/Profile";
import ConvospanSync from "./pages/app/ConvospanSync";

export default function AppRoutes() {
  return (
    <>
      <Meta />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/help" element={<Help />} />
        
        {/* Protected App Routes */}
        <Route path="/app" element={<AppLayout />}>
          <Route index element={<Navigate to="/app/dashboard" />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="signals" element={<Signals />} />
          <Route path="query" element={<Query />} />
          <Route path="reports" element={<Reports />} />
          <Route path="api" element={<ApiManager />} />
          <Route path="sync" element={<ConvospanSync />} />
          <Route path="profile" element={<Profile />} />
        </Route>

        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </>
  );
}
