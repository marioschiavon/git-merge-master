import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import { RequireMasterAdmin } from "@/components/RequireMasterAdmin";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import Leads from "@/pages/Leads";
import Cadences from "@/pages/Cadences";
import CadencesDashboard from "@/pages/CadencesDashboard";
import Scripts from "@/pages/Scripts";
import Conversations from "@/pages/Conversations";
import Reports from "@/pages/Reports";
import Knowledge from "@/pages/Knowledge";
import MasterDashboard from "@/pages/master/MasterDashboard";
import Companies from "@/pages/master/Companies";
import Team from "@/pages/settings/Team";
import Integrations from "@/pages/settings/Integrations";
import SettingsPage from "@/pages/settings/Settings";
import Unsubscribe from "@/pages/Unsubscribe";
import ResetPassword from "@/pages/ResetPassword";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/unsubscribe" element={<Unsubscribe />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/leads" element={<Leads />} />
              <Route path="/cadences" element={<Cadences />} />
              <Route path="/cadences/dashboard" element={<CadencesDashboard />} />
              <Route path="/scripts" element={<Scripts />} />
              <Route path="/conversations" element={<Conversations />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/knowledge" element={<Knowledge />} />
              <Route element={<RequireMasterAdmin />}>
                <Route path="/master" element={<MasterDashboard />} />
                <Route path="/master/companies" element={<Companies />} />
              </Route>
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/team" element={<Team />} />
              <Route path="/settings/integrations" element={<Integrations />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
