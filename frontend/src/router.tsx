import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, Outlet, useLocation, type RouteObject } from "react-router-dom";
import { useAuth } from "@/stores/auth";
import { Spinner } from "@/components/ui";
import { AppLayout } from "@/layouts/AppLayout";
import { LoginPage } from "@/pages/LoginPage";
import { RegisterPage } from "@/pages/RegisterPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { NotFoundPage } from "@/pages/NotFoundPage";

/*
 * Home and the auth screens ship in the main bundle; everything else is split
 * per page so the first paint stays light. Named exports are adapted to
 * React.lazy's default-export contract here, in one place.
 */
const page = <K extends string>(loader: () => Promise<Record<K, () => JSX.Element>>, name: K) =>
  lazy(async () => ({ default: (await loader())[name] }));

const AiAssistantPage = page(() => import("@/pages/AiAssistantPage"), "AiAssistantPage");
const ActivityPage = page(() => import("@/pages/ActivityPage"), "ActivityPage");
const ErrorsPage = page(() => import("@/pages/ErrorsPage"), "ErrorsPage");
const ProfilesPage = page(() => import("@/pages/ProfilesPage"), "ProfilesPage");
const ProfileDetailPage = page(() => import("@/pages/ProfileDetailPage"), "ProfileDetailPage");
const PersonalisePage = page(() => import("@/pages/PersonalisePage"), "PersonalisePage");
const CredentialsPage = page(() => import("@/pages/CredentialsPage"), "CredentialsPage");
const IntegrationsPage = page(() => import("@/pages/IntegrationsPage"), "IntegrationsPage");
const IntegrationDetailPage = page(() => import("@/pages/IntegrationDetailPage"), "IntegrationDetailPage");
const AutomationsPage = page(() => import("@/pages/AutomationsPage"), "AutomationsPage");
const AutomationBuilderPage = page(() => import("@/pages/AutomationBuilderPage"), "AutomationBuilderPage");
const AutomationDetailPage = page(() => import("@/pages/AutomationDetailPage"), "AutomationDetailPage");
const SystemAutomationPage = page(() => import("@/pages/AutomationDetailPage"), "SystemAutomationPage");
const ExecutionPage = page(() => import("@/pages/AutomationDetailPage"), "ExecutionPage");
const MonitoringPage = page(() => import("@/pages/MonitoringPage"), "MonitoringPage");
const LogsPage = page(() => import("@/pages/LogsPage"), "LogsPage");
const SettingsPage = page(() => import("@/pages/SettingsPage"), "SettingsPage");
const InboxPage = page(() => import("@/pages/InboxPage"), "InboxPage");
const CalendarPage = page(() => import("@/pages/CalendarPage"), "CalendarPage");
const TasksPage = page(() => import("@/pages/TasksPage"), "TasksPage");
const EnginePage = page(() => import("@/pages/EnginePage"), "EnginePage");
const PresentationPage = page(() => import("@/pages/PresentationPage"), "PresentationPage");
const OnboardingPage = page(() => import("@/pages/OnboardingPage"), "OnboardingPage");
const AdminUsersPage = page(() => import("@/pages/AdminPages"), "AdminUsersPage");
const AdminSystemPage = page(() => import("@/pages/AdminPages"), "AdminSystemPage");
const AdminSecurityPage = page(() => import("@/pages/AdminPages"), "AdminSecurityPage");

function FullScreenLoader() {
  return (
    <div className="flex h-screen items-center justify-center bg-bg text-brand">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center text-brand">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

const s = (el: ReactNode) => <Suspense fallback={<PageLoader />}>{el}</Suspense>;

export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <FullScreenLoader />;
  if (status === "anonymous") return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

export function RequireAdmin() {
  const { isAdmin, status } = useAuth();
  if (status === "loading") return <FullScreenLoader />;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

export function PublicOnly() {
  const { status } = useAuth();
  if (status === "loading") return <FullScreenLoader />;
  if (status === "authenticated") return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

export const routes: RouteObject[] = [
  {
    element: <PublicOnly />,
    children: [
      { path: "/login", element: <LoginPage /> },
      { path: "/register", element: <RegisterPage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      { path: "presentation", element: s(<PresentationPage />) },
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: "dashboard", element: <DashboardPage /> },
          { path: "home", element: <Navigate to="/dashboard" replace /> },
          { path: "onboarding", element: s(<OnboardingPage />) },
          { path: "assistant", element: s(<AiAssistantPage />) },
          { path: "inbox", element: s(<InboxPage />) },
          { path: "calendar", element: s(<CalendarPage />) },
          { path: "tasks", element: s(<TasksPage />) },
          { path: "engine", element: s(<EnginePage />) },
          { path: "automations", element: s(<AutomationsPage />) },
          { path: "automations/new", element: s(<AutomationBuilderPage />) },
          { path: "automations/system/:id", element: s(<SystemAutomationPage />) },
          { path: "automations/:id", element: s(<AutomationDetailPage />) },
          { path: "automations/:id/edit", element: s(<AutomationBuilderPage />) },
          { path: "integrations", element: s(<IntegrationsPage />) },
          { path: "integrations/:key", element: s(<IntegrationDetailPage />) },
          { path: "activity", element: s(<ActivityPage />) },
          { path: "errors", element: s(<ErrorsPage />) },
          { path: "executions", element: <Navigate to="/activity" replace /> },
          { path: "executions/:id", element: s(<ExecutionPage />) },
          { path: "profiles", element: s(<ProfilesPage />) },
          { path: "profiles/:id", element: s(<ProfileDetailPage />) },
          { path: "profiles/:id/personalise", element: s(<PersonalisePage />) },
          { path: "settings", element: s(<SettingsPage />) },
          { path: "settings/vault", element: s(<CredentialsPage />) },
          { path: "settings/:section", element: s(<SettingsPage />) },
          { path: "monitoring", element: s(<MonitoringPage />) },
          { path: "logs", element: s(<LogsPage />) },
          // v0.5 addresses, kept working
          { path: "ai", element: <Navigate to="/settings/ai" replace /> },
          { path: "services", element: <Navigate to="/settings/advanced" replace /> },
          { path: "credentials", element: <Navigate to="/integrations" replace /> },
          { path: "setup", element: <Navigate to="/onboarding" replace /> },
          {
            path: "admin",
            element: <RequireAdmin />,
            children: [
              { index: true, element: <Navigate to="/admin/users" replace /> },
              { path: "users", element: s(<AdminUsersPage />) },
              { path: "system", element: s(<AdminSystemPage />) },
              { path: "security", element: s(<AdminSecurityPage />) },
            ],
          },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
