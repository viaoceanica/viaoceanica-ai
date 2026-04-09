import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";

// Pages
import Home from "./pages/Home";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import TeamManagement from "./pages/TeamManagement";
import Modules from "./pages/Modules";
import Tokens from "./pages/Tokens";
import CompanyProfile from "./pages/CompanyProfile";
import SettingsPage from "./pages/SettingsPage";
import UserProfile from "./pages/UserProfile";
import ModulePage from "./pages/ModulePage";
import Billing from "./pages/Billing";

// Admin pages
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminCompanies from "./pages/admin/AdminCompanies";
import AdminTokens from "./pages/admin/AdminTokens";
import AdminModules from "./pages/admin/AdminModules";
import AdminPlans from "./pages/admin/AdminPlans";

function CompanyDashboardContent() {
  const [location] = useLocation();
  
  // Match module/:slug pattern
  const moduleMatch = location.match(/^\/dashboard\/module\/(.+)$/);
  
  let content;
  if (location === "/dashboard") {
    content = <Dashboard />;
  } else if (location === "/dashboard/team") {
    content = <TeamManagement />;
  } else if (location === "/dashboard/modules") {
    content = <Modules />;
  } else if (location === "/dashboard/tokens") {
    content = <Tokens />;
  } else if (location === "/dashboard/company") {
    content = <CompanyProfile />;
  } else if (location === "/dashboard/profile") {
    content = <UserProfile />;
  } else if (location === "/dashboard/settings") {
    content = <SettingsPage />;
  } else if (location === "/dashboard/billing") {
    content = <Billing />;
  } else if (moduleMatch) {
    content = <ModulePage />;
  } else {
    content = <NotFound />;
  }

  return (
    <DashboardLayout variant="company">
      {content}
    </DashboardLayout>
  );
}

function AdminContent() {
  const [location] = useLocation();
  
  let content;
  if (location === "/admin") {
    content = <AdminDashboard />;
  } else if (location === "/admin/companies") {
    content = <AdminCompanies />;
  } else if (location === "/admin/tokens") {
    content = <AdminTokens />;
  } else if (location === "/admin/modules") {
    content = <AdminModules />;
  } else if (location === "/admin/plans") {
    content = <AdminPlans />;
  } else {
    content = <NotFound />;
  }

  return (
    <DashboardLayout variant="admin">
      {content}
    </DashboardLayout>
  );
}

function Router() {
  const [location] = useLocation();
  
  // Route based on location prefix
  if (location === "/") return <Home />;
  if (location === "/login") return <Login />;
  if (location === "/register") return <Register />;
  if (location === "/forgot-password") return <ForgotPassword />;
  if (location.startsWith("/reset-password/")) return <ResetPassword />;
  if (location.startsWith("/dashboard")) return <CompanyDashboardContent />;
  if (location.startsWith("/admin")) return <AdminContent />;
  return <NotFound />;
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
