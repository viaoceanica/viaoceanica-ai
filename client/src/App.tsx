import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";

// Pages
import Home from "./pages/Home";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import Dashboard from "./pages/Dashboard";
import TeamManagement from "./pages/TeamManagement";
import Modules from "./pages/Modules";
import Tokens from "./pages/Tokens";
import CompanyProfile from "./pages/CompanyProfile";
import SettingsPage from "./pages/SettingsPage";

// Admin pages
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminCompanies from "./pages/admin/AdminCompanies";
import AdminTokens from "./pages/admin/AdminTokens";
import AdminModules from "./pages/admin/AdminModules";
import AdminPlans from "./pages/admin/AdminPlans";

function CompanyDashboardRoutes() {
  return (
    <DashboardLayout variant="company">
      <Switch>
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/dashboard/team" component={TeamManagement} />
        <Route path="/dashboard/modules" component={Modules} />
        <Route path="/dashboard/tokens" component={Tokens} />
        <Route path="/dashboard/company" component={CompanyProfile} />
        <Route path="/dashboard/settings" component={SettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function AdminRoutes() {
  return (
    <DashboardLayout variant="admin">
      <Switch>
        <Route path="/admin" component={AdminDashboard} />
        <Route path="/admin/companies" component={AdminCompanies} />
        <Route path="/admin/tokens" component={AdminTokens} />
        <Route path="/admin/modules" component={AdminModules} />
        <Route path="/admin/plans" component={AdminPlans} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/dashboard/:rest*" component={CompanyDashboardRoutes} />
      <Route path="/dashboard" component={CompanyDashboardRoutes} />
      <Route path="/admin/:rest*" component={AdminRoutes} />
      <Route path="/admin" component={AdminRoutes} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
