import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Dashboard from '@/pages/dashboard';
import ClaimRestaurant from '@/pages/claim';
import Unsubscribe from '@/pages/unsubscribe';
import Support from '@/pages/support';
import AdminLogin from '@/pages/admin-login';
import PortalPage from '@/pages/portal';
import PortalMenuPage from '@/pages/portal-menu';
import PortalPhotosPage from '@/pages/portal-photos';
import PortalAnalyticsPage from '@/pages/portal-analytics';
import PortalUpgradePage from '@/pages/portal-upgrade';
import SearchPage from '@/pages/search';
import HomePage from '@/pages/home';
import CityPage from '@/pages/city';
import CuisinePage from '@/pages/cuisine';
import DirectoryPage from '@/pages/directory';
import RestaurantPage from '@/pages/restaurant';
import ClaimSuccessPage from '@/pages/claim-success';
import { AdminGate } from '@/components/admin-gate';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/admin/login" component={AdminLogin} />
        <Route path="/search" component={SearchPage} />
        <Route path="/city/:city" component={CityPage} />
        <Route path="/cuisine/:cuisine" component={CuisinePage} />
        <Route path="/restaurants" component={DirectoryPage} />
        <Route path="/restaurant/:id" component={RestaurantPage} />
        <Route path="/claim/:id/success" component={ClaimSuccessPage} />
        <Route path="/admin/dashboard">
          <AdminGate><Dashboard /></AdminGate>
        </Route>
        <Route path="/">
          <HomePage />
        </Route>
        <Route path="/claim/:placeId" component={ClaimRestaurant} />
        <Route path="/portal/:token/menu" component={PortalMenuPage} />
        <Route path="/portal/:token/photos" component={PortalPhotosPage} />
        <Route path="/portal/:token/analytics" component={PortalAnalyticsPage} />
        <Route path="/portal/:token/upgrade" component={PortalUpgradePage} />
        <Route path="/portal/:token" component={PortalPage} />
        <Route path="/unsubscribe/:token" component={Unsubscribe} />
        <Route path="/support" component={Support} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
