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
import LeadLists from "@/pages/LeadLists";
import CampaignWizard from "@/pages/CampaignWizard";
import Cadences from "@/pages/Cadences";
import CadencesDashboard from "@/pages/CadencesDashboard";
import Scripts from "@/pages/Scripts";
import Conversations from "@/pages/Conversations";
import Inbox from "@/pages/Inbox";

import Reports from "@/pages/Reports";
import Knowledge from "@/pages/Knowledge";
import AgentRuns from "@/pages/AgentRuns";
import Approvals from "@/pages/Approvals";
import Annotations from "@/pages/Annotations";
import MasterDashboard from "@/pages/master/MasterDashboard";
import Companies from "@/pages/master/Companies";
import PlatformSettings from "@/pages/master/PlatformSettings";
import Team from "@/pages/settings/Team";
import Integrations from "@/pages/settings/Integrations";
import SettingsPage from "@/pages/settings/Settings";
import Intents from "@/pages/settings/Intents";
import CalcomSettings from "@/pages/settings/CalcomSettings";
import Bookings from "@/pages/Bookings";
import Unsubscribe from "@/pages/Unsubscribe";
import ResetPassword from "@/pages/ResetPassword";
import Onboarding from "@/pages/Onboarding";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
    },
  },
});

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
            <Route path="/onboarding" element={<Onboarding />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/leads" element={<Leads />} />
              <Route path="/leads/lists" element={<LeadLists />} />
              <Route path="/leads/lists/:listId/launch" element={<CampaignWizard />} />
              <Route path="/cadences" element={<Cadences />} />
              <Route path="/cadences/dashboard" element={<CadencesDashboard />} />
              <Route path="/scripts" element={<Scripts />} />
              <Route path="/conversations" element={<Conversations />} />
              <Route path="/inbox" element={<Inbox />} />

              <Route path="/reports" element={<Reports />} />
              <Route path="/knowledge" element={<Knowledge />} />
              <Route path="/agent-runs" element={<AgentRuns />} />
              <Route path="/approvals" element={<Approvals />} />
              <Route path="/annotations" element={<Annotations />} />
              <Route element={<RequireMasterAdmin />}>
                <Route path="/master" element={<MasterDashboard />} />
                <Route path="/master/companies" element={<Companies />} />
                <Route path="/master/platform-settings" element={<PlatformSettings />} />
              </Route>
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/team" element={<Team />} />
              <Route path="/settings/integrations" element={<Integrations />} />
              <Route path="/settings/intents" element={<Intents />} />
              <Route path="/settings/calcom" element={<CalcomSettings />} />
              <Route path="/bookings" element={<Bookings />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
