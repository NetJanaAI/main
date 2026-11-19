import { lazy, Suspense, type ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Landing from "./pages/Landing";
import AppLayout from "./layouts/AppLayout";
import Meta from "./components/Meta";
import RequireAuth from "./components/RequireAuth";
import { isFallbackAuthActive } from "./lib/auth";


// Pages load on demand so the landing page does not pay for the whole app.
const Login = lazy(() => import("./pages/Login"));
const SetupWizard = lazy(() => import("./pages/SetupWizard"));
const Help = lazy(() => import("./pages/Help"));
const Dashboard = lazy(() => import("./pages/app/Dashboard"));
const Signals = lazy(() => import("./pages/app/Signals"));
const Query = lazy(() => import("./pages/app/Query"));
const Reports = lazy(() => import("./pages/app/Reports"));
const ApiManager = lazy(() => import("./pages/app/ApiManager"));
const Profile = lazy(() => import("./pages/app/Profile"));
const ConvospanSync = lazy(() => import("./pages/app/ConvospanSync"));
const TenderWatch = lazy(() => import("./pages/app/TenderWatch"));
const WebsiteSignals = lazy(() => import("./pages/app/WebsiteSignals"));
const EntityIntelligence = lazy(() => import("./pages/app/EntityIntelligence"));
const KnowledgeBase = lazy(() => import("./pages/app/KnowledgeBase"));
const CompanyDossier = lazy(() => import("./pages/app/CompanyDossier"));
const CsvIngestion = lazy(() => import("./pages/app/CsvIngestion"));

const PageFallback = () => <div className="p-8 text-sm text-white/50" role="status">Loading…</div>;
const page = (node: ReactNode) => <Suspense fallback={<PageFallback />}>{node}</Suspense>;

export default function AppRoutes() {
  return (
    <>
      <Meta />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={page(<Login />)} />
        {/* Setup is the onboarding entry point — accessible without auth in fallback/demo mode */}
        <Route
          path="/setup"
          element={
            isFallbackAuthActive ? page(<SetupWizard />) : <RequireAuth>{page(<SetupWizard />)}</RequireAuth>
          }
        />
        <Route path="/help" element={page(<Help />)} />
        
        {/* Protected App Routes */}
        <Route path="/app" element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<Navigate to="/app/dashboard" />} />
          <Route path="dashboard" element={page(<Dashboard />)} />
          <Route path="signals" element={page(<Signals />)} />
          <Route path="query" element={page(<Query />)} />
          <Route path="dossier" element={page(<CompanyDossier />)} />
          <Route path="entities" element={page(<EntityIntelligence />)} />
          <Route path="csv-ingest" element={page(<CsvIngestion />)} />
          <Route path="ingest" element={page(<CsvIngestion />)} />
          <Route path="knowledge" element={page(<KnowledgeBase />)} />
          <Route path="reports" element={page(<Reports />)} />
          <Route path="api" element={page(<ApiManager />)} />
          <Route path="sync" element={page(<ConvospanSync />)} />
          <Route path="profile" element={page(<Profile />)} />
          <Route path="watch" element={page(<TenderWatch />)} />
          <Route path="website-signals" element={page(<WebsiteSignals />)} />
        </Route>


        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </>
  );
}
