import { useEffect, useRef, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Dashboard from '@/pages/dashboard';
import ClaimRestaurant from '@/pages/claim';
import Unsubscribe from '@/pages/unsubscribe';
import Support from '@/pages/support';
import AdminLogin from '@/pages/admin-login';
import AdminPage from '@/pages/admin';
import AddRestaurantPage from '@/pages/admin-add-restaurant';
import ManageRestaurantsPage from '@/pages/admin-restaurants';
import EditRestaurantPage from '@/pages/admin-edit-restaurant';
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
import CountriesPage from '@/pages/countries';
import CountryPage from '@/pages/country';
import CityDirectoryPage from '@/pages/city-directory';
import CitiesPage from '@/pages/cities';
import RegionsPage from '@/pages/regions';
import RegionPage from '@/pages/region';
import OwnerDashboard from '@/pages/owner';
import OwnerClaimPage from '@/pages/owner-claim';
import OwnerManagePage from '@/pages/owner-manage';
import MatchPage from '@/pages/match';
import AdvancedSearchPage from '@/pages/advanced-search';
import AboutPage from '@/pages/about';
import ContactPage from '@/pages/contact';
import PricingPage from '@/pages/pricing';
import ChatPage from '@/pages/chat';
import PortalOnboardingPage from '@/pages/portal-onboarding';
import TrendsPage from '@/pages/trends';
import { NavBar } from '@/components/nav-bar';
import { Footer } from '@/components/footer';
import { AdminGate } from '@/components/admin-gate';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#D7263D',
    colorForeground: '#1A1A1A',
    colorMutedForeground: '#6b625e',
    colorDanger: '#D7263D',
    colorBackground: '#ffffff',
    colorInput: '#faf8f5',
    colorInputForeground: '#1A1A1A',
    colorNeutral: '#ded7d1',
    fontFamily: "'DM Sans', sans-serif",
    borderRadius: '0.75rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-white rounded-2xl w-[440px] max-w-full overflow-hidden border border-border',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-fa-black',
    headerSubtitle: 'text-gray-600',
    socialButtonsBlockButtonText: 'text-fa-black',
    formFieldLabel: 'text-fa-black',
    footerActionLink: 'text-fa-red font-semibold',
    footerActionText: 'text-gray-600',
    dividerText: 'text-gray-500',
    identityPreviewEditButton: 'text-fa-red',
    formFieldSuccessText: 'text-green-700',
    alertText: 'text-fa-black',
    logoBox: 'h-16',
    logoImage: 'h-14 w-14 rounded-full',
    socialButtonsBlockButton: 'border-border text-fa-black',
    formButtonPrimary: 'bg-fa-red hover:bg-fa-red/90',
    formFieldInput: 'bg-white text-fa-black border-border',
    footerAction: 'pt-4',
    dividerLine: 'bg-border',
    alert: 'border-border bg-muted',
    otpCodeFieldInput: 'border-border text-fa-black',
    formFieldRow: 'text-fa-black',
    main: 'text-fa-black',
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[70dvh] items-center justify-center bg-background px-4 py-10">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[70dvh] items-center justify-center bg-background px-4 py-10">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        previousUserId.current !== undefined &&
        previousUserId.current !== userId
      ) {
        client.clear();
      }
      previousUserId.current = userId;
    });
    return unsubscribe;
  }, [addListener, client]);
  return null;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/admin/login" component={AdminLogin} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route path="/admin/add-restaurant">
          <AdminGate><AddRestaurantPage /></AdminGate>
        </Route>
        <Route path="/admin/restaurants">
          <AdminGate><ManageRestaurantsPage /></AdminGate>
        </Route>
        <Route path="/admin/restaurants/:slug">
          <AdminGate><EditRestaurantPage /></AdminGate>
        </Route>
        <Route path="/admin">
          <AdminGate><AdminPage /></AdminGate>
        </Route>
        <Route path="/search" component={SearchPage} />
        <Route path="/city/:city" component={CityPage} />
        <Route path="/cities/:slug" component={CityDirectoryPage} />
        <Route path="/cities" component={CitiesPage} />
        <Route path="/regions/:slug" component={RegionPage} />
        <Route path="/regions" component={RegionsPage} />
        <Route path="/owner/claim" component={OwnerClaimPage} />
        <Route path="/owner/manage" component={OwnerManagePage} />
        <Route path="/owner" component={OwnerDashboard} />
        <Route path="/match" component={MatchPage} />
        <Route path="/advanced-search" component={AdvancedSearchPage} />
        <Route path="/about" component={AboutPage} />
        <Route path="/contact" component={ContactPage} />
        <Route path="/pricing" component={PricingPage} />
        <Route path="/chat" component={ChatPage} />
        <Route path="/trends" component={TrendsPage} />
        <Route path="/countries/:slug" component={CountryPage} />
        <Route path="/countries" component={CountriesPage} />
        <Route path="/cuisine/:cuisine" component={CuisinePage} />
        <Route path="/restaurants" component={DirectoryPage} />
        <Route path="/restaurant/:id" component={RestaurantPage} />
        <Route path="/restaurants/:slug" component={RestaurantPage} />
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
        <Route path="/portal/:token/onboarding" component={PortalOnboardingPage} />
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
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to your Food Advisor account' } },
        signUp: { start: { title: 'Create your account', subtitle: 'Join The Food Advisor' } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <ClerkQueryClientCacheInvalidator />
      <TooltipProvider>
          <div className="flex min-h-screen flex-col">
            <NavBar />
            <div className="flex-1">
              <Router />
            </div>
            <Footer />
          </div>
        <Toaster />
      </TooltipProvider>
    </ClerkProvider>
  );
}

function AppRoot() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={basePath}>
        <App />
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default AppRoot;
