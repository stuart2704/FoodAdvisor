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

function AppRoutes() {
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith("/admin/");

  return (
    <>
      {!isAdminRoute && <Navbar />}

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/restaurant/:id" element={<RestaurantDetail />} />
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