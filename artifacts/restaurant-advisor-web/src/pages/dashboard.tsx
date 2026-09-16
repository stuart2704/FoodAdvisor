import { useState, useMemo, useRef, useEffect } from 'react';
import './live-events.css';
import { LiveEvents } from '@/components/live-events';
import HealthPanel from '@/components/health-panel';
import StatusPanel from '@/components/status-panel';
import ErrorPanel from '@/components/error-panel';
import SummaryPanel from '@/components/summary-panel';
import { DarkModeToggle } from '@/components/dark-mode-toggle';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetRestaurantImportStatus,
  getGetRestaurantImportStatusQueryKey,
  useCreateRestaurantImportPlan,
  useRunRestaurantImport,
  useHealthCheck,
  Restaurant,
  RestaurantImportPlan
} from '@workspace/api-client-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
 import { Check, Info, LayoutDashboard, MapPin, AlertCircle, Play, Presentation, UtensilsCrossed, RefreshCw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'wouter';

const DEFAULT_CITIES = ['London', 'Cardiff', 'Edinburgh', 'Glasgow', 'Manchester', 'Liverpool', 'Belfast'];

export default function Dashboard() {
  const queryClient = useQueryClient();
  
  // Queries
  const { data: healthData, isLoading: healthLoading, isError: healthError } = useHealthCheck();
  const { data: statusData, isLoading: statusLoading, isError: statusError, error: statusErrorObj } = useGetRestaurantImportStatus({
    query: {
      enabled: !healthError,
      queryKey: getGetRestaurantImportStatusQueryKey()
    }
  });

  // Mutations
  const createPlan = useCreateRestaurantImportPlan();
  const runImport = useRunRestaurantImport();

  // State
  const [selectedCities, setSelectedCities] = useState<string[]>(DEFAULT_CITIES);
  const [perCityLimit, setPerCityLimit] = useState<string>('10');
  const [budgetString, setBudgetString] = useState<string>('25'); // £25
  const [planResult, setPlanResult] = useState<RestaurantImportPlan | null>(null);
  const [latestRestaurants, setLatestRestaurants] = useState<Restaurant[]>([]);

  // Computed
  const budgetCents = Math.floor(parseFloat(budgetString || '0') * 100);
  const apiNotConfigured = statusErrorObj?.message?.includes('API') || statusErrorObj?.message?.includes('configure') || (healthData && healthData.status !== 'ok');

  const handleToggleCity = (city: string) => {
    setSelectedCities(prev => 
      prev.includes(city) 
        ? prev.filter(c => c !== city)
        : [...prev, city]
    );
  };

  const handleGeneratePlan = () => {
    if (selectedCities.length === 0) {
      toast.error('Please select at least one city');
      return;
    }
    
    if (budgetCents < 100) {
      toast.error('Budget must be at least £1.00');
      return;
    }

    createPlan.mutate({
      data: {
        cities: selectedCities,
        perCityLimit: parseInt(perCityLimit, 10) || 10,
        monthlyBudgetCents: budgetCents
      }
    }, {
      onSuccess: (plan) => {
        setPlanResult(plan);
        toast.success('Import plan generated successfully');
      },
      onError: (err) => {
        toast.error('Failed to generate plan: ' + (err.message || 'Unknown error'));
      }
    });
  };

  const handleRunImport = () => {
    if (!planResult) return;
    
    runImport.mutate({
      data: {
        cities: selectedCities,
        perCityLimit: parseInt(perCityLimit, 10) || 10,
        monthlyBudgetCents: budgetCents,
        confirm: true
      }
    }, {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getGetRestaurantImportStatusQueryKey() });
        setLatestRestaurants(result.restaurants);
        setPlanResult(null); // Reset plan
        toast.success(`Import complete! Added ${result.imported} restaurants.`);
        
        if (result.stoppedBecause) {
          toast.warning(`Import stopped early: ${result.stoppedBecause}`);
        }
      },
      onError: (err) => {
        toast.error('Failed to run import: ' + (err.message || 'Unknown error'));
      }
    });
  };

  if (healthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <RefreshCw className="h-8 w-8 animate-spin text-primary" />
          <p className="font-serif text-xl text-foreground">Warming up the kitchens...</p>
        </div>
      </div>
    );
  }

  if (apiNotConfigured || healthError || statusError) {
    return (
      <div className="min-h-screen bg-background p-6 md:p-12 font-sans">
        <div className="max-w-2xl mx-auto mt-12">
          <Card className="border-destructive/20 shadow-lg">
            <CardHeader className="bg-destructive/5 rounded-t-xl border-b border-destructive/10 pb-8 pt-8">
              <div className="flex items-center gap-3 mb-2 text-destructive">
                <AlertCircle className="h-6 w-6" />
                <CardTitle className="text-2xl">API Not Configured</CardTitle>
              </div>
              <CardDescription className="text-base">
                The restaurant discovery API cannot be reached. 
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <p className="text-foreground mb-4">
                This operator dashboard requires a backend connection to fetch real-time restaurant data. Ensure your environment variables and Google Places API keys are correctly configured.
              </p>
              <Button 
                onClick={() => window.location.reload()}
                variant="outline" 
                data-testid="button-retry-connection"
                className="mt-4"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry Connection
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/20 selection:text-primary">
      {/* Header */}
      <DarkModeToggle />
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border pl-6 pr-32 py-4 md:pl-12 md:pr-36 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-primary text-primary-foreground p-2 rounded-lg shadow-sm">
            <UtensilsCrossed className="h-5 w-5" />
          </div>
          <h1 className="font-serif text-xl md:text-3xl font-semibold tracking-tight">The Food Advisor</h1>
        </div>
        <div className="hidden md:flex items-center gap-5 text-sm font-medium text-muted-foreground">
          <a
            href="/food-advisor-project-deck/"
            className="flex items-center gap-2 transition-colors hover:text-primary"
          >
            <Presentation className="h-4 w-4" />
            Project Presentation
          </a>
          <Link href="/support" className="transition-colors hover:text-primary">
            Support
          </Link>
          <span className="flex items-center gap-2">
            <LayoutDashboard className="h-4 w-4" />
            Operator Dashboard
          </span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 md:px-12 md:py-12 space-y-8">
        
        {/* Top Stats Row */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="md:col-span-2 bg-card overflow-hidden relative shadow-sm border-card-border hover:shadow-md transition-shadow">
            <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
              <UtensilsCrossed className="w-48 h-48" />
            </div>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                Monthly Budget Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              {statusLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-10 w-48" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex flex-col gap-1">
                    <span className="text-4xl font-serif font-semibold text-foreground tracking-tight" data-testid="text-spent-cents">
                      {formatCurrency(statusData?.spentCents || 0)}
                    </span>
                    <span className="text-sm text-muted-foreground font-medium">
                      spent of {formatCurrency(statusData?.monthlyBudgetCents || 0)} limit
                    </span>
                  </div>
                  
                  {/* Progress bar */}
                  <div className="h-3 w-full bg-secondary rounded-full overflow-hidden shadow-inner">
                    <div 
                      className={cn(
                        "h-full rounded-full transition-all duration-1000 ease-out",
                        ((statusData?.spentCents || 0) / (statusData?.monthlyBudgetCents || 1)) > 0.9 ? "bg-destructive" : "bg-primary"
                      )}
                      style={{ width: `${Math.min(100, ((statusData?.spentCents || 0) / (statusData?.monthlyBudgetCents || 1)) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card shadow-sm border-card-border hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Database Health</CardTitle>
            </CardHeader>
            <CardContent>
              {statusLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-8 w-24" />
                  <Skeleton className="h-4 w-32" />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-3xl font-serif font-semibold text-foreground" data-testid="text-imported-count">
                      {statusData?.restaurantsImported.toLocaleString() || 0}
                    </span>
                    <span className="text-sm text-muted-foreground font-medium">
                      total restaurants imported
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5 bg-secondary/50 p-2 rounded-md">
                    <Check className="h-3 w-3 text-primary" />
                    Last run: {statusData?.lastRunAt ? formatDate(statusData.lastRunAt) : 'Never'}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Import Controls */}
          <section className="lg:col-span-5 space-y-6">
            <Card className="shadow-sm border-card-border">
              <CardHeader className="border-b border-border/50 bg-secondary/20 pb-5">
                <CardTitle className="text-xl">Plan Next Import</CardTitle>
                <CardDescription>Target specific cities while staying within your budget cap.</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-8">
                
                {/* Budget Control */}
                <div className="space-y-3">
                  <Label htmlFor="budget-input" className="text-base font-semibold">Monthly Budget Cap</Label>
                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-muted-foreground font-medium">£</span>
                    <Input
                      id="budget-input"
                      type="number"
                      min="1"
                      step="1"
                      value={budgetString}
                      onChange={(e) => setBudgetString(e.target.value)}
                      className="pl-8 text-lg font-medium h-12 bg-background shadow-sm"
                      data-testid="input-budget"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Caps the maximum API spend for this month.</p>
                </div>

                {/* Cities Control */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-base font-semibold">Target Cities</Label>
                    <span className="text-xs font-medium bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">
                      {selectedCities.length} selected
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1" data-testid="container-cities">
                    {DEFAULT_CITIES.map(city => {
                      const isSelected = selectedCities.includes(city);
                      return (
                        <button
                          key={city}
                          onClick={() => handleToggleCity(city)}
                          className={cn(
                            "px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200 border shadow-sm",
                            isSelected 
                              ? "bg-primary text-primary-foreground border-primary" 
                              : "bg-background text-foreground border-border hover:border-primary/50 hover:bg-secondary"
                          )}
                          data-testid={`button-city-${city}`}
                        >
                          {city}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Per City Limit */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="limit-input" className="text-base font-semibold">Restaurants per City</Label>
                    <span className="text-sm font-medium text-muted-foreground">{perCityLimit}</span>
                  </div>
                  <input
                    type="range"
                    id="limit-input"
                    min="1"
                    max="20"
                    step="1"
                    value={perCityLimit}
                    onChange={(e) => setPerCityLimit(e.target.value)}
                    className="w-full accent-primary"
                    data-testid="input-city-limit"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground font-medium px-1">
                    <span>1</span>
                    <span>10</span>
                    <span>20</span>
                  </div>
                </div>

              </CardContent>
              <CardFooter className="pt-0 pb-6 px-6">
                <Button 
                  className="w-full h-12 text-base font-semibold shadow-md active:scale-[0.98] transition-transform" 
                  onClick={handleGeneratePlan}
                  disabled={createPlan.isPending || selectedCities.length === 0}
                  data-testid="button-generate-plan"
                >
                  {createPlan.isPending ? (
                    <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
                  ) : (
                    <LayoutDashboard className="mr-2 h-5 w-5" />
                  )}
                  Preview Import Plan
                </Button>
              </CardFooter>
            </Card>
          </section>

          {/* Right Column: Preview & Results */}
          <section className="lg:col-span-7 space-y-6">
            
            {/* Plan Preview */}
            {planResult ? (
              <Card className="border-primary/20 shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500 overflow-hidden">
                <div className="bg-primary/5 p-6 border-b border-primary/10">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-serif text-xl font-semibold text-foreground">Import Plan Ready</h3>
                      <p className="text-sm text-muted-foreground mt-1">Review the estimates before executing the import.</p>
                    </div>
                    {planResult.withinBudget ? (
                      <Badge variant="success" className="px-3 py-1 text-sm shadow-sm">Within Budget</Badge>
                    ) : (
                      <Badge variant="warning" className="px-3 py-1 text-sm shadow-sm">Budget Exceeded</Badge>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-background rounded-lg shadow-sm border border-border/50">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Est. Cost</p>
                      <p className="text-lg font-serif font-semibold">{formatCurrency(planResult.estimatedCostCents)}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Restaurants</p>
                      <p className="text-lg font-serif font-semibold">{planResult.totalRestaurants}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">API Calls</p>
                      <p className="text-lg font-serif font-semibold">{planResult.totalApiCalls}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Cities</p>
                      <p className="text-lg font-serif font-semibold">{planResult.cities.length}</p>
                    </div>
                  </div>
                </div>

                <div className="p-0">
                  <Table>
                    <TableHeader className="bg-secondary/30">
                      <TableRow>
                        <TableHead className="py-3 px-6 text-foreground font-semibold">City</TableHead>
                        <TableHead className="text-right text-foreground font-semibold">Target</TableHead>
                        <TableHead className="text-right text-foreground font-semibold">Cost</TableHead>
                        <TableHead className="text-right px-6 text-foreground font-semibold">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {planResult.cities.map((cityRow) => (
                        <TableRow key={cityRow.city} className="hover:bg-secondary/20">
                          <TableCell className="py-3 px-6 font-medium">{cityRow.city}</TableCell>
                          <TableCell className="text-right">{cityRow.requested}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(cityRow.estimatedCostCents)}</TableCell>
                          <TableCell className="text-right px-6">
                            <Badge 
                              variant="outline" 
                              className={cn(
                                "capitalize text-[10px] tracking-wide",
                                cityRow.status === 'ready' && "border-green-200 text-green-700 bg-green-50",
                                cityRow.status === 'capped' && "border-yellow-200 text-yellow-700 bg-yellow-50",
                                cityRow.status === 'skipped' && "border-red-200 text-red-700 bg-red-50"
                              )}
                            >
                              {cityRow.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="p-6 bg-secondary/10 border-t border-border/50 flex flex-col sm:flex-row gap-4 items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Info className="h-4 w-4" />
                    <span>{planResult.note}</span>
                  </div>
                  <Button 
                    onClick={handleRunImport}
                    disabled={runImport.isPending || !planResult.withinBudget}
                    size="lg"
                    className="w-full sm:w-auto shadow-md"
                    data-testid="button-execute-import"
                  >
                    {runImport.isPending ? (
                      <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
                    ) : (
                      <Play className="mr-2 h-5 w-5 fill-current" />
                    )}
                    Execute Import
                  </Button>
                </div>
              </Card>
            ) : (
              !latestRestaurants.length && (
                <div className="h-64 flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl bg-secondary/10 text-muted-foreground p-8 text-center animate-in fade-in duration-500">
                  <MapPin className="h-10 w-10 mb-4 opacity-50" />
                  <p className="font-serif text-lg font-medium text-foreground mb-1">No Plan Generated</p>
                  <p className="text-sm max-w-sm">Adjust your settings and click "Preview Import Plan" to see estimated costs and coverage before executing.</p>
                </div>
              )
            )}

            {/* Latest Imports */}
            {latestRestaurants.length > 0 && (
              <Card className="shadow-sm border-card-border animate-in fade-in slide-in-from-bottom-4 duration-500 delay-150 fill-mode-both">
                <CardHeader className="border-b border-border/50 bg-primary/5 pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-xl flex items-center gap-2">
                        <Check className="h-5 w-5 text-green-600" />
                        Recently Added
                      </CardTitle>
                      <CardDescription className="mt-1">
                        Successfully imported {latestRestaurants.length} new locations.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader className="bg-secondary/20">
                      <TableRow>
                        <TableHead className="px-6 py-3 font-semibold text-foreground">Name</TableHead>
                        <TableHead className="font-semibold text-foreground">City</TableHead>
                        <TableHead className="font-semibold text-foreground">Rating</TableHead>
                        <TableHead className="px-6 text-right font-semibold text-foreground">Type</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {latestRestaurants.slice(0, 5).map(restaurant => (
                        <TableRow key={restaurant.id} className="hover:bg-secondary/30 transition-colors">
                          <TableCell className="px-6 py-3">
                            <div className="font-medium text-foreground">{restaurant.name}</div>
                            <div className="text-xs text-muted-foreground truncate max-w-[200px]">{restaurant.address}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="font-medium">{restaurant.city}</Badge>
                          </TableCell>
                          <TableCell>
                            {restaurant.rating ? (
                              <div className="flex items-center gap-1 font-medium">
                                <span className="text-yellow-600">★</span>
                                {restaurant.rating}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs italic">N/A</span>
                            )}
                          </TableCell>
                          <TableCell className="px-6 text-right">
                            {restaurant.types[0] ? (
                              <span className="text-xs capitalize text-muted-foreground bg-secondary/50 px-2 py-1 rounded-md">
                                {restaurant.types[0].replace(/_/g, ' ')}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {latestRestaurants.length > 5 && (
                    <div className="p-3 text-center border-t border-border bg-secondary/10">
                      <span className="text-xs font-medium text-muted-foreground">
                        + {latestRestaurants.length - 5} more restaurants imported
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

          </section>
        </div>
        <section id="scraper-operations" className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3" aria-label="Scraper operations">
          <div className="lg:col-span-2"><SummaryPanel /></div>
          <StatusPanel />
        <Card className="panel shadow-sm border-card-border" aria-labelledby="live-events-title">
          <CardHeader>
            <CardTitle id="live-events-title" className="text-xl">Live Events</CardTitle>
            <CardDescription>Recent reply and delivery activity.</CardDescription>
          </CardHeader>
          <CardContent>
            <LiveEvents />
          </CardContent>
        </Card>
          <HealthPanel />
          <ErrorPanel />
        </section>
      </main>
    </div>
  );
}
