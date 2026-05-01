import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import AuthLayout from './components/AuthLayout';
import ProtectedRoute from './components/ProtectedRoute';
import RoleRoute from './components/RoleRoute';
import AppLayout from './components/AppLayout';
import ResidentLayout from './components/ResidentLayout';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import Properties from './pages/Properties';
import PropertyDetail from './pages/PropertyDetail';
import PropertyOverview from './pages/PropertyOverview';
import Inspections from './pages/Inspections';
import InspectionFlow from './pages/InspectionFlow';
import InspectionReview from './pages/InspectionReview';
import QuarterlyFlow from './pages/QuarterlyFlow';
import QuarterlyReview from './pages/QuarterlyReview';
import CommonAreaFlow from './pages/CommonAreaFlow';
import Maintenance from './pages/Maintenance';
import Team from './pages/Team';
import Tasks from './pages/Tasks';
import MaintenanceToDoAll from './pages/MaintenanceToDoAll';
import Calendar from './pages/Calendar';
import Reports from './pages/Reports';
import Violations from './pages/Violations';
import PropertyHealth from './pages/PropertyHealth';
import Templates from './pages/Templates';
import More from './pages/More';
import Vendors from './pages/Vendors';
import Sharing from './pages/Sharing';
import Settings from './pages/Settings';
import Billing from './pages/Billing';
import Suggest from './pages/Suggest';
import VendorProfile from './pages/VendorProfile';
import ResidentHome from './pages/ResidentHome';
import ResidentCheck from './pages/ResidentCheck';
import ResidentDone from './pages/ResidentDone';
import JoinSlug from './pages/JoinSlug';
import PublicInspection from './pages/PublicInspection';
import PublicReport from './pages/PublicReport';
import Flyer from './pages/Flyer';
import Notifications from './pages/Notifications';
import NotificationSettings from './pages/NotificationSettings';
import Track from './pages/Track';
import Financials from './pages/Financials';

function DefaultRedirect() {
  const { user } = useAuth();
  const to = user?.role === 'RESIDENT' ? '/resident' : '/dashboard';
  return <Navigate to={to} replace />;
}

const ALL_STAFF = ['OWNER', 'PM', 'CLEANER', 'HANDYPERSON'];
const OWNER_PM = ['OWNER', 'PM'];
const OWNER_ONLY = ['OWNER'];
const WITH_MAINTENANCE = ['OWNER', 'PM', 'HANDYPERSON'];

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public routes (no auth) */}
          <Route path="/join/:slug" element={<JoinSlug />} />
          <Route path="/movein/:slug" element={<PublicInspection />} />
          <Route path="/selfcheck/:slug" element={<PublicInspection />} />
          <Route path="/report/:slug" element={<PublicReport />} />
          <Route path="/flyer/:slug/:kind" element={<Flyer />} />
          <Route path="/track/:token" element={<Track />} />

          {/* Auth pages — redirect to home if already logged in */}
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
          </Route>

          {/* Protected pages with full nav layout */}
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              {/* Dashboard — every logged-in role gets *some* dashboard */}
              <Route element={<RoleRoute allow={ALL_STAFF} />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/notifications/settings" element={<NotificationSettings />} />
              </Route>

              {/* Maintenance board — Owner / PM / Handyperson (not Cleaner) */}
              <Route element={<RoleRoute allow={WITH_MAINTENANCE} />}>
                <Route path="/maintenance" element={<Maintenance />} />
              </Route>

              {/* Inspection review surfaces — Owner / PM only */}
              <Route element={<RoleRoute allow={OWNER_PM} />}>
                <Route path="/properties" element={<PropertyHealth />} />
                <Route path="/properties/manage" element={<Properties />} />
                <Route path="/properties/:id" element={<PropertyDetail />} />
                <Route path="/properties/:id/overview" element={<PropertyOverview />} />
                <Route path="/inspections" element={<Inspections />} />
                <Route path="/inspections/:id/review" element={<InspectionReview />} />
                <Route path="/quarterly-review/:propertyId/:date" element={<QuarterlyReview />} />
                <Route path="/more" element={<More />} />
                <Route path="/team" element={<Team />} />
                <Route path="/vendors" element={<Vendors />} />
                <Route path="/sharing" element={<Sharing />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/suggest" element={<Suggest />} />
                <Route path="/todo" element={<Tasks />} />
                <Route path="/tasks" element={<Tasks />} />
                <Route path="/all" element={<MaintenanceToDoAll />} />
                <Route path="/calendar" element={<Calendar />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/financials" element={<Financials />} />
                <Route path="/violations" element={<Violations />} />
                <Route path="/health" element={<PropertyHealth />} />
                <Route path="/templates" element={<Templates />} />
                <Route path="/vendors/:id" element={<VendorProfile />} />
              </Route>

              {/* Billing / org-level surfaces — Owner only */}
              <Route element={<RoleRoute allow={OWNER_ONLY} />}>
                <Route path="/billing" element={<Billing />} />
              </Route>
            </Route>

            {/* Full-screen inspection flows (no nav) — Cleaners also run these */}
            <Route element={<RoleRoute allow={ALL_STAFF} />}>
              <Route path="/inspections/:id" element={<InspectionFlow />} />
              <Route path="/quarterly/:propertyId" element={<QuarterlyFlow />} />
              <Route path="/quarterly/:propertyId/:roomId" element={<QuarterlyFlow />} />
              <Route path="/common-area/:inspectionId" element={<CommonAreaFlow />} />
              <Route path="/room-turn/:inspectionId" element={<CommonAreaFlow />} />
            </Route>

            {/* Resident experience — minimal layout */}
            <Route element={<ResidentLayout />}>
              <Route path="/resident" element={<ResidentHome />} />
              <Route path="/resident/check/:id" element={<ResidentCheck />} />
              <Route path="/resident/done/:id" element={<ResidentDone />} />
            </Route>
          </Route>

          {/* Default redirect — role-aware */}
          <Route element={<ProtectedRoute />}>
            <Route path="*" element={<DefaultRedirect />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
