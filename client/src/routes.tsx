import { Routes, Route, Navigate } from "react-router-dom";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import SetupWizard from "./pages/SetupWizard";
import Help from "./pages/Help";
import AppLayout from "./layouts/AppLayout";
import Meta from "./components/Meta";
import RequireAuth from "./components/RequireAuth";

// App Pages
import Dashboard from "./pages/app/Dashboard";
import Signals from "./pages/app/Signals";
import Query from "./pages/app/Query";
import Reports from "./pages/app/Reports";
import ApiManager from "./pages/app/ApiManager";
import Profile from "./pages/app/Profile";
import ConvospanSync from "./pages/app/ConvospanSync";
import TenderWatch from "./pages/app/TenderWatch";

export default function AppRoutes() {
  return (
    <>
      <Meta />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/setup" element={<RequireAuth><SetupWizard /></RequireAuth>} />
        <Route path="/help" element={<Help />} />
        
        {/* Protected App Routes */}
        <Route path="/app" element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<Navigate to="/app/dashboard" />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="signals" element={<Signals />} />
          <Route path="query" element={<Query />} />
          <Route path="reports" element={<Reports />} />
          <Route path="api" element={<ApiManager />} />
          <Route path="sync" element={<ConvospanSync />} />
          <Route path="profile" element={<Profile />} />
          <Route path="watch" element={<TenderWatch />} />
        </Route>

        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </>
  );
}
