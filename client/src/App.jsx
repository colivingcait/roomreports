import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import AuthLayout from './components/AuthLayout';
import ProtectedRoute from './components/ProtectedRoute';
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
import Calendar from './pages/Calendar';
import Reports from './pages/Reports';
import Violations from './pages/Violations';
import PropertyHealth from './pages/PropertyHealth';
import VendorProfile from './pages/VendorProfile';
import ResidentHome from './pages/ResidentHome';
import ResidentCheck from './pages/ResidentCheck';
import ResidentDone from './pages/ResidentDone';
import JoinSlug from './pages/JoinSlug';
import PublicInspection from './pages/PublicInspection';
import PublicReport from './pages/PublicReport';
import Flyer from './pages/Flyer';

function DefaultRedirect() {
  const { user } = useAuth();
  const to = user?.role === 'RESIDENT' ? '/resident' : '/dashboard';
  return <Navigate to={to} replace />;
}

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

          {/* Auth pages — redirect to home if already logged in */}
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
          </Route>

          {/* Protected pages with full nav layout (PM/Owner/Cleaner) */}
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/properties" element={<Properties />} />
              <Route path="/properties/:id" element={<PropertyDetail />} />
              <Route path="/properties/:id/overview" element={<PropertyOverview />} />
              <Route path="/inspections" element={<Inspections />} />
              <Route path="/inspections/:id/review" element={<InspectionReview />} />
              <Route path="/quarterly-review/:propertyId/:date" element={<QuarterlyReview />} />
              <Route path="/maintenance" element={<Maintenance />} />
              <Route path="/team" element={<Team />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/violations" element={<Violations />} />
              <Route path="/health" element={<PropertyHealth />} />
              <Route path="/vendors/:id" element={<VendorProfile />} />
            </Route>

            {/* Full-screen inspection flows (no nav) */}
            <Route path="/inspections/:id" element={<InspectionFlow />} />
            <Route path="/quarterly/:propertyId" element={<QuarterlyFlow />} />
            <Route path="/quarterly/:propertyId/:roomId" element={<QuarterlyFlow />} />
            <Route path="/common-area/:inspectionId" element={<CommonAreaFlow />} />
            <Route path="/room-turn/:inspectionId" element={<CommonAreaFlow />} />

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
