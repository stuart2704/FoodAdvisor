import { AuthenticateWithRedirectCallback } from "@clerk/react";
import { BrowserRouter, Navigate, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Navbar from "./components/Navbar";
import RestaurantDetail from "./components/RestaurantDetail";
import Trending from "./components/Trending";
import Home from "./components/Home";
import CityGuide from "./components/CityGuide";
import AdminDashboard from "./admin/AdminDashboard";
import AdminGitHubComplete from "./admin/AdminGitHubComplete";
import AdminGitHubSignIn from "./admin/AdminGitHubSignIn";
import AdminLogin from "./admin/AdminLogin";
import AdminErrors from "./pages/admin/errors";
import AdminLogs from "./pages/admin/logs";
import SocialAutomationPage from "./pages/admin/social-automation";
import AdminOperations from "./pages/admin/operations";
import AdminLogout from "./pages/admin/logout";
import AdminOutreach from "./pages/admin/outreach";
import AdminOwnerContacts from "./pages/admin/owner-contacts";
import AdminPerformance from "./pages/admin/performance";
import AdminIngestion from "./pages/admin/ingestion";
import ManageRestaurantsPage from "./pages/admin-restaurants";
import AdminChefReviewPage from "./pages/admin-chef-review";
import AdminRestaurantPhotosPage from "./pages/admin-restaurant-photos";
import ClaimRestaurant from "./pages/claim";
import ClaimSuccessPage from "./pages/claim-success";
import PortalPage from "./pages/portal";
import PortalAnalyticsPage from "./pages/portal-analytics";
import PortalMenuPage from "./pages/portal-menu";
import PortalOnboardingPage from "./pages/portal-onboarding";
import PortalPhotosPage from "./pages/portal-photos";
import PortalUpgradePage from "./pages/portal-upgrade";
import RewardsPage from "./pages/rewards";
import AboutPage from "./pages/AboutPage";
import ContactPage from "./pages/ContactPage";
import TermsPage from "./pages/TermsPage";
import PrivacyPage from "./pages/PrivacyPage";
import OwnerPage from "./pages/OwnerPage";
import RestaurantsPage from "./pages/RestaurantsPage";
import NotFoundPage from "./pages/NotFoundPage";
import CityHighlights from "./components/CityHighlights";
import CollectionManagement from "./pages/collection-management";
import AdminCandidatesPage from "./pages/admin/candidates";
import { RequireAdmin } from "./components/admin/RequireAdmin";
import OsmClaimPage from "./pages/osm-claim";
import OsmOwnerPage from "./pages/osm-owner";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

function AppRoutes() {
  const location = useLocation();
  const isAdminRoute = location.pathname === "/admin" || location.pathname.startsWith("/admin/");

  return (
    <>
      {!isAdminRoute && <Navbar />}

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/restaurants" element={<RestaurantsPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/owner" element={<OwnerPage />} />
        <Route path="/owner/claim" element={<OsmOwnerPage />} />
        <Route path="/restaurant/:id" element={<RestaurantDetail />} />
        <Route path="/claim/:placeId" element={<ClaimRestaurant />} />
        <Route path="/claim/:candidateId/:token" element={<OsmClaimPage />} />
        <Route path="/claim/:id/success" element={<ClaimSuccessPage />} />
        <Route path="/portal" element={<PortalPage />} />
        <Route path="/portal/analytics" element={<PortalAnalyticsPage />} />
        <Route path="/portal/menu" element={<PortalMenuPage />} />
        <Route path="/portal/onboarding" element={<PortalOnboardingPage />} />
        <Route path="/portal/photos" element={<PortalPhotosPage />} />
        <Route path="/portal/upgrade" element={<PortalUpgradePage />} />
        <Route path="/portal/upgrade/success" element={<PortalUpgradePage />} />
        <Route path="/portal/upgrade/cancel" element={<PortalUpgradePage />} />
        <Route path="/trending" element={<Trending />} />
        <Route path="/city-guide" element={<CityGuide />} />
        <Route path="/highlights" element={<CityHighlights />} />
        <Route path="/highlights/manage" element={<CollectionManagement />} />
        <Route path="/rewards" element={<RewardsPage />} />
        <Route path="/admin" element={<Navigate to="/admin/login" replace />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route
          path="/admin/github/sso-callback"
          element={<AuthenticateWithRedirectCallback />}
        />
        <Route path="/admin/github/*" element={<AdminGitHubSignIn />} />
        <Route
          path="/admin/github-complete"
          element={<AdminGitHubComplete />}
        />
        <Route path="/admin/logout" element={<AdminLogout />} />
        <Route path="/admin/dashboard" element={<AdminDashboard />} />
        <Route path="/admin/performance" element={<AdminPerformance />} />
        <Route path="/admin/ingestion" element={<AdminIngestion />} />
        <Route path="/admin/errors" element={<AdminErrors />} />
        <Route path="/admin/outreach" element={<AdminOutreach />} />
        <Route path="/admin/owner-contacts" element={<AdminOwnerContacts />} />
        <Route path="/admin/restaurants" element={<ManageRestaurantsPage />} />
        <Route path="/admin/candidates" element={<RequireAdmin><AdminCandidatesPage /></RequireAdmin>} />
        <Route path="/admin/chef-review" element={<AdminChefReviewPage />} />
        <Route path="/admin/restaurant-photos" element={<AdminRestaurantPhotosPage />} />
        <Route path="/admin/logs" element={<AdminLogs />} />
        <Route path="/admin/automation/social" element={<SocialAutomationPage />} />
        <Route path="/admin/automation/social/logs" element={<SocialAutomationPage />} />
        <Route path="/admin/automation/social/error-intelligence" element={<SocialAutomationPage />} />
        <Route path="/admin/queue" element={<AdminOperations view="queue" />} />
        <Route path="/admin/engines" element={<AdminOperations view="engines" />} />
        <Route path="/admin/health" element={<AdminOperations view="health" />} />
        <Route path="/admin/*" element={null} />
        <Route path="/portal/*" element={null} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}