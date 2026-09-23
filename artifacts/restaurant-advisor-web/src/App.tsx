import { AuthenticateWithRedirectCallback } from "@clerk/react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Navbar from "./components/Navbar";
import RestaurantDetail from "./components/RestaurantDetail";
import OwnerDashboard from "./components/OwnerDashboard";
import Trending from "./components/Trending";
import Home from "./components/Home";
import CityGuide from "./components/CityGuide";
import AdminDashboard from "./admin/AdminDashboard";
import AdminGitHubComplete from "./admin/AdminGitHubComplete";
import AdminGitHubSignIn from "./admin/AdminGitHubSignIn";
import AdminLogin from "./admin/AdminLogin";
import AdminErrors from "./pages/admin/errors";
import AdminLogs from "./pages/admin/logs";
import AdminLogout from "./pages/admin/logout";
import AdminOutreach from "./pages/admin/outreach";
import AdminPerformance from "./pages/admin/performance";
import ManageRestaurantsPage from "./pages/admin-restaurants";
import ClaimRestaurant from "./pages/claim";
import ClaimSuccessPage from "./pages/claim-success";
import PortalPage from "./pages/portal";
import PortalAnalyticsPage from "./pages/portal-analytics";
import PortalMenuPage from "./pages/portal-menu";
import PortalOnboardingPage from "./pages/portal-onboarding";
import PortalPhotosPage from "./pages/portal-photos";
import PortalUpgradePage from "./pages/portal-upgrade";

function AppRoutes() {
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith("/admin/");

  return (
    <>
      {!isAdminRoute && <Navbar />}

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/restaurant/:id" element={<RestaurantDetail />} />
        <Route path="/claim/:placeId" element={<ClaimRestaurant />} />
        <Route path="/claim/:id/success" element={<ClaimSuccessPage />} />
        <Route path="/portal/:token" element={<PortalPage />} />
        <Route path="/portal/:token/analytics" element={<PortalAnalyticsPage />} />
        <Route path="/portal/:token/menu" element={<PortalMenuPage />} />
        <Route path="/portal/:token/onboarding" element={<PortalOnboardingPage />} />
        <Route path="/portal/:token/photos" element={<PortalPhotosPage />} />
        <Route path="/portal/:token/upgrade" element={<PortalUpgradePage />} />
        <Route path="/portal/upgrade/success" element={<PortalUpgradePage />} />
        <Route path="/portal/upgrade/cancel" element={<PortalUpgradePage />} />
        <Route path="/portal/:token/upgrade/success" element={<PortalUpgradePage />} />
        <Route path="/portal/:token/upgrade/cancel" element={<PortalUpgradePage />} />
        <Route path="/trending" element={<Trending />} />
        <Route path="/city-guide" element={<CityGuide />} />
        <Route path="/owner" element={<OwnerDashboard />} />
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
        <Route path="/admin/errors" element={<AdminErrors />} />
        <Route path="/admin/outreach" element={<AdminOutreach />} />
        <Route path="/admin/restaurants" element={<ManageRestaurantsPage />} />
        <Route path="/admin/logs" element={<AdminLogs />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}