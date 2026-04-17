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
import Inspections from './pages/Inspections';
import InspectionFlow from './pages/InspectionFlow';
import InspectionReview from './pages/InspectionReview';
import Maintenance from './pages/Maintenance';
import Team from './pages/Team';
import ResidentHome from './pages/ResidentHome';
import ResidentCheck from './pages/ResidentCheck';
import ResidentDone from './pages/ResidentDone';

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
              <Route path="/inspections" element={<Inspections />} />
              <Route path="/inspections/:id/review" element={<InspectionReview />} />
              <Route path="/maintenance" element={<Maintenance />} />
              <Route path="/team" element={<Team />} />
            </Route>

            {/* Full-screen inspection flow (no nav) */}
            <Route path="/inspections/:id" element={<InspectionFlow />} />

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
