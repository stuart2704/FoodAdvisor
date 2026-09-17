import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetRestaurantImportStatusQueryKey,
  getListNearbyRestaurantsQueryKey,
  getListRestaurantsQueryKey,
  useCreateRestaurantImportPlan,
  useGetRestaurantImportStatus,
  useListNearbyRestaurants,
  useListRestaurants,
  useRunRestaurantImport,
} from '@workspace/api-client-react';
import { useRouter } from 'expo-router';
import {
  ConceptButton,
  foodImages,
  Notice,
  Pill,
  RestaurantCard,
  Screen,
  Section,
  sharedStyles,
} from '@/components/FoodAdvisor';
import { useColors } from '@/hooks/useColors';

const CITIES = [
  'London',
  'Cardiff',
  'Edinburgh',
  'Glasgow',
  'Manchester',
  'Liverpool',
  'Belfast',
];

export function ManagementScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const [selectedCities, setSelectedCities] = useState<string[]>(CITIES);
  const [budget, setBudget] = useState('25');
  const [limit, setLimit] = useState(10);
  const [radiusMiles, setRadiusMiles] = useState(5);
  const [nearbyCoords, setNearbyCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [nearbyRequested, setNearbyRequested] = useState(false);
  const [locationState, setLocationState] = useState<
    'idle' | 'requesting' | 'loading' | 'ready' | 'denied' | 'timeout' | 'error'
  >('idle');
  const [locationError, setLocationError] = useState<string | null>(null);
  const [permission, requestPermission] = Location.useForegroundPermissions();
  const status = useGetRestaurantImportStatus();
  const restaurants = useListRestaurants();
  const nearbyParams = {
    latitude: nearbyCoords?.latitude ?? 0,
    longitude: nearbyCoords?.longitude ?? 0,
    radiusMiles,
  };
  const nearby = useListNearbyRestaurants(
    nearbyParams,
    {
      query: {
        queryKey: getListNearbyRestaurantsQueryKey(nearbyParams),
        enabled: nearbyRequested && nearbyCoords !== null,
        retry: false,
      },
    },
  );
  const plan = useCreateRestaurantImportPlan();
  const run = useRunRestaurantImport();

  const input = useMemo(
    () => ({
      cities: selectedCities,
      perCityLimit: limit,
      monthlyBudgetCents: Math.max(1, Math.round(Number(budget || 0) * 100)),
    }),
    [budget, limit, selectedCities],
  );

  const toggleCity = (city: string) => {
    Haptics.selectionAsync();
    setSelectedCities((current) =>
      current.includes(city)
        ? current.filter((item) => item !== city)
        : [...current, city],
    );
    plan.reset();
  };

  const refresh = async () => {
    await Promise.all([
      status.refetch(),
      restaurants.refetch(),
      ...(nearbyCoords ? [nearby.refetch()] : []),
    ]);
  };

  const handleNearMe = async () => {
    Haptics.selectionAsync();
    setLocationError(null);
    setLocationState('requesting');

    try {
      if (Platform.OS !== 'web') {
        const currentPermission =
          permission?.granted ? permission : await requestPermission();
        if (!currentPermission.granted) {
          setLocationState('denied');
          setLocationError(
            currentPermission.canAskAgain
              ? 'Location permission is needed to find restaurants near you.'
              : 'Location permission is blocked. Open Settings to allow Near me.',
          );
          return;
        }
      }

      setLocationState('loading');
      const position =
        Platform.OS === 'web'
          ? await new Promise<{
              coords: { latitude: number; longitude: number };
            }>((resolve, reject) => {
              navigator.geolocation.getCurrentPosition(
                (result) => resolve(result),
                (error) => reject(new Error(error.message)),
                { enableHighAccuracy: false, timeout: 10_000, maximumAge: 0 },
              );
            })
          : await Promise.race([
              Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
              }),
              new Promise<never>((_, reject) => {
                setTimeout(
                  () => reject(new Error('LOCATION_TIMEOUT')),
                  10_000,
                );
              }),
            ]);

      setNearbyCoords({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      setNearbyRequested(true);
      setLocationState('ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'LOCATION_TIMEOUT') {
        setLocationState('timeout');
        setLocationError(
          'Location took too long to respond. Check your signal and try again.',
        );
      } else {
        setLocationState('error');
        setLocationError(
          'We could not read your location. Check device settings and try again.',
        );
      }
    }
  };

  const retryNearby = async () => {
    if (!nearbyCoords) {
      await handleNearMe();
      return;
    }
    setLocationError(null);
    setLocationState('loading');
    const result = await nearby.refetch();
    if (result.error) {
      setLocationState('error');
      setLocationError(
        'Nearby restaurants could not be loaded. Check your connection and try again.',
      );
    } else {
      setLocationState('ready');
    }
  };

  const openLocationSettings = () => {
    if (Platform.OS !== 'web') {
      Linking.openSettings().catch(() => {
        setLocationError('Open your device Settings to allow location access.');
      });
    }
  };

  const visibleRestaurants = nearbyRequested
    ? nearby.data ?? []
    : restaurants.data ?? [];
  const showingNearby = nearbyRequested;

  const runImport = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    run.mutate(
      { data: { ...input, confirm: true } },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          queryClient.invalidateQueries({
            queryKey: getGetRestaurantImportStatusQueryKey(),
          });
          queryClient.invalidateQueries({
            queryKey: getListRestaurantsQueryKey(),
          });
          queryClient.invalidateQueries({
            queryKey: getListNearbyRestaurantsQueryKey(),
          });
        },
      },
    );
  };

  const errorMessage =
    (run.error as { data?: { error?: string } } | null)?.data?.error ??
    (status.error ? 'The shared restaurant service is unavailable.' : null);

  return (
    <FlatList
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      data={visibleRestaurants}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={refresh} tintColor={colors.primary} />
      }
      ListHeaderComponent={
        <View>
          <View style={styles.eyebrowRow}>
            <View style={[styles.mark, { backgroundColor: colors.primary }]}>
              <Feather name="map-pin" size={18} color={colors.primaryForeground} />
            </View>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>
              THE FOOD ADVISOR
            </Text>
          </View>
          <Text style={[styles.hero, { color: colors.foreground }]}>
            Better tables,{'\n'}city by city.
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Grow the UK guide with a clear monthly spending ceiling.
          </Text>

          <View style={[styles.nearbyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.nearbyHeader}>
              <View style={[styles.nearbyIcon, { backgroundColor: colors.secondary }]}>
                <Feather name="navigation" size={18} color={colors.primary} />
              </View>
              <View style={styles.nearbyCopy}>
                <Text style={[styles.nearbyTitle, { color: colors.foreground }]}>Near me</Text>
                <Text style={[styles.nearbyDescription, { color: colors.mutedForeground }]}>
                  Use your device location to sort stored restaurant coordinates by distance.
                </Text>
              </View>
            </View>
            <View style={styles.radiusRow}>
              <Text style={[styles.radiusLabel, { color: colors.mutedForeground }]}>RADIUS</Text>
              {[1, 5, 10, 25].map((value) => (
                <Pressable
                  key={value}
                  testID={`radius-${value}`}
                  onPress={() => setRadiusMiles(value)}
                  style={[
                    styles.radiusChip,
                    {
                      backgroundColor: radiusMiles === value ? colors.accent : colors.background,
                      borderColor: radiusMiles === value ? colors.accent : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.radiusText, { color: colors.foreground }]}>{value} mi</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              testID="button-near-me"
              disabled={locationState === 'requesting' || locationState === 'loading'}
              onPress={handleNearMe}
              style={[styles.nearbyButton, { backgroundColor: colors.primary }]}
            >
              {locationState === 'requesting' || locationState === 'loading' ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <>
                  <Feather name="crosshair" size={17} color={colors.primaryForeground} />
                  <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>
                    {nearbyRequested ? 'Refresh near me' : 'Find near me'}
                  </Text>
                </>
              )}
            </Pressable>
            {locationError && (
              <View style={[styles.nearbyError, { backgroundColor: colors.secondary }]}>
                <Feather name="alert-circle" size={17} color={colors.destructive} />
                <Text style={[styles.nearbyErrorText, { color: colors.destructive }]}>
                  {locationError}
                </Text>
                {(locationState === 'denied' && permission?.canAskAgain === false) ? (
                  <Pressable testID="button-location-settings" onPress={openLocationSettings}>
                    <Text style={[styles.retryText, { color: colors.primary }]}>Settings</Text>
                  </Pressable>
                ) : (
                  <Pressable testID="button-nearby-retry" onPress={retryNearby}>
                    <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
                  </Pressable>
                )}
              </View>
            )}
            {nearby.isError && !locationError && (
              <View style={[styles.nearbyError, { backgroundColor: colors.secondary }]}>
                <Feather name="wifi-off" size={17} color={colors.destructive} />
                <Text style={[styles.nearbyErrorText, { color: colors.destructive }]}>
                  Nearby restaurants could not be loaded.
                </Text>
                <Pressable testID="button-nearby-retry" onPress={retryNearby}>
                  <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
                </Pressable>
              </View>
            )}
          </View>

          <View style={[styles.budgetCard, { backgroundColor: colors.primary }]}>
            <View>
              <Text style={[styles.cardLabel, { color: '#EBCFDA' }]}>BUDGET LEFT</Text>
              <Text style={[styles.budgetValue, { color: colors.primaryForeground }]}>
                £{((status.data?.remainingCents ?? input.monthlyBudgetCents) / 100).toFixed(2)}
              </Text>
            </View>
            <View style={styles.budgetMeta}>
              <Text style={[styles.metaStrong, { color: colors.primaryForeground }]}>
                {status.data?.restaurantsImported ?? 0}
              </Text>
              <Text style={[styles.metaLabel, { color: '#EBCFDA' }]}>restaurants</Text>
            </View>
          </View>

          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Choose cities</Text>
          <View style={styles.cityWrap}>
            {CITIES.map((city) => {
              const selected = selectedCities.includes(city);
              return (
                <Pressable
                  key={city}
                  testID={`city-${city}`}
                  onPress={() => toggleCity(city)}
                  style={[
                    styles.cityChip,
                    {
                      backgroundColor: selected ? colors.accent : colors.card,
                      borderColor: selected ? colors.accent : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.cityText, { color: colors.foreground }]}>{city}</Text>
                  {selected && <Feather name="check" size={15} color={colors.accentForeground} />}
                </Pressable>
              );
            })}
          </View>

          <View style={styles.controls}>
            <View style={[styles.inputCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>MONTHLY CAP</Text>
              <View style={styles.moneyRow}>
                <Text style={[styles.currency, { color: colors.foreground }]}>£</Text>
                <TextInput
                  testID="input-budget"
                  value={budget}
                  onChangeText={(value) => { setBudget(value.replace(/[^0-9.]/g, '')); plan.reset(); }}
                  keyboardType="decimal-pad"
                  style={[styles.input, { color: colors.foreground }]}
                />
              </View>
            </View>
            <View style={[styles.inputCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>PER CITY</Text>
              <View style={styles.stepper}>
                <Pressable testID="button-limit-down" onPress={() => setLimit((v) => Math.max(1, v - 1))}>
                  <Feather name="minus-circle" size={25} color={colors.primary} />
                </Pressable>
                <Text style={[styles.limitValue, { color: colors.foreground }]}>{limit}</Text>
                <Pressable testID="button-limit-up" onPress={() => setLimit((v) => Math.min(20, v + 1))}>
                  <Feather name="plus-circle" size={25} color={colors.primary} />
                </Pressable>
              </View>
            </View>
          </View>

          {errorMessage && (
            <View style={[styles.error, { backgroundColor: '#FCE8E6' }]}>
              <Feather name="alert-circle" size={18} color={colors.destructive} />
              <Text style={[styles.errorText, { color: colors.destructive }]}>{errorMessage}</Text>
            </View>
          )}

          {plan.data && (
            <View style={[styles.planCard, { backgroundColor: colors.secondary }]}>
              <Text style={[styles.planTitle, { color: colors.foreground }]}>
                {plan.data.totalRestaurants} places · {plan.data.totalApiCalls} calls
              </Text>
              <Text style={[styles.planNote, { color: colors.mutedForeground }]}>{plan.data.note}</Text>
            </View>
          )}

          <View style={styles.actions}>
            <Pressable
              testID="button-plan"
              disabled={!selectedCities.length || plan.isPending}
              onPress={() => plan.mutate({ data: input })}
              style={[styles.secondaryButton, { borderColor: colors.primary }]}
            >
              {plan.isPending ? <ActivityIndicator color={colors.primary} /> : <Text style={[styles.secondaryText, { color: colors.primary }]}>Check plan</Text>}
            </Pressable>
            <Pressable
              testID="button-import"
              disabled={!plan.data || run.isPending}
              onPress={runImport}
              style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: !plan.data ? 0.45 : 1 }]}
            >
              {run.isPending ? <ActivityIndicator color={colors.primaryForeground} /> : <>
                <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>Import safely</Text>
                <Feather name="arrow-up-right" size={19} color={colors.primaryForeground} />
              </>}
            </Pressable>
          </View>

          <View style={styles.listHeading}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              {showingNearby ? 'Nearby finds' : 'Latest finds'}
            </Text>
            <Text style={[styles.count, { color: colors.mutedForeground }]}>
              {visibleRestaurants.length}
            </Text>
          </View>
          {(restaurants.isLoading || nearby.isLoading) && (
            <ActivityIndicator color={colors.primary} style={styles.loader} />
          )}
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          testID={`restaurant-${item.id}`}
          onPress={() => Linking.openURL(item.googleMapsUrl)}
          style={[styles.restaurant, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={[styles.restaurantIcon, { backgroundColor: colors.secondary }]}>
            <Feather name="coffee" size={19} color={colors.primary} />
          </View>
          <View style={styles.restaurantCopy}>
            <Text numberOfLines={1} style={[styles.restaurantName, { color: colors.foreground }]}>{item.name}</Text>
            <Text numberOfLines={1} style={[styles.address, { color: colors.mutedForeground }]}>{item.city} · {item.address}</Text>
          </View>
          <View style={styles.restaurantMeta}>
            {typeof (item as { distanceMiles?: unknown }).distanceMiles === 'number' && (
              <Text style={[styles.distance, { color: colors.primary }]}>
                {(item as unknown as { distanceMiles: number }).distanceMiles.toFixed(1)} mi
              </Text>
            )}
            {item.rating !== null && (
              <Text style={[styles.rating, { color: colors.foreground }]}>
                {item.rating.toFixed(1)}
              </Text>
            )}
          </View>
        </Pressable>
      )}
      ListEmptyComponent={
        !restaurants.isLoading && !nearby.isLoading ? (
          <View style={styles.empty}>
            <Feather
              name={showingNearby ? 'map-pin' : 'compass'}
              size={30}
              color={colors.mutedForeground}
            />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {showingNearby
                ? `No nearby restaurants with stored coordinates were found within ${radiusMiles} miles. Imported listings without coordinates are not shown.`
                : 'Run your first safe import to fill the guide.'}
            </Text>
          </View>
        ) : null
      }
    />
  );
}

export default function DiscoverScreen() {
  const colors = useColors();
  const router = useRouter();
  const restaurants = useListRestaurants();
  const [radiusMiles, setRadiusMiles] = useState(5);
  const [nearbyCoords, setNearbyCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [nearbyRequested, setNearbyRequested] = useState(false);
  const [locationState, setLocationState] = useState<
    'idle' | 'requesting' | 'ready' | 'denied' | 'error'
  >('idle');
  const [locationError, setLocationError] = useState<string | null>(null);
  const [permission, requestPermission] = Location.useForegroundPermissions();
  const nearbyParams = {
    latitude: nearbyCoords?.latitude ?? 0,
    longitude: nearbyCoords?.longitude ?? 0,
    radiusMiles,
  };
  const nearby = useListNearbyRestaurants(nearbyParams, {
    query: {
      queryKey: getListNearbyRestaurantsQueryKey(nearbyParams),
      enabled: nearbyRequested && nearbyCoords !== null,
      retry: false,
    },
  });
  const directory = nearbyRequested ? nearby.data ?? [] : restaurants.data ?? [];

  const handleNearMe = async () => {
    Haptics.selectionAsync();
    setLocationError(null);
    setLocationState('requesting');

    try {
      if (Platform.OS !== 'web') {
        const currentPermission =
          permission?.granted ? permission : await requestPermission();
        if (!currentPermission.granted) {
          setLocationState('denied');
          setLocationError('Allow location access to find stored restaurants near you.');
          return;
        }
      }

      const position =
        Platform.OS === 'web'
          ? await new Promise<{ coords: { latitude: number; longitude: number } }>(
              (resolve, reject) => {
                navigator.geolocation.getCurrentPosition(
                  resolve,
                  (error) => reject(new Error(error.message)),
                  { enableHighAccuracy: false, timeout: 10_000, maximumAge: 0 },
                );
              },
            )
          : await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });

      setNearbyCoords({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      setNearbyRequested(true);
      setLocationState('ready');
    } catch {
      setLocationState('error');
      setLocationError('Your location could not be read. Check device settings and try again.');
    }
  };

  const openRestaurant = (id: string) => {
    router.push({ pathname: '/restaurant/[id]', params: { id } });
  };

  const restaurantRail = (items: typeof directory) => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={consumerStyles.rail}
    >
      {items.map((restaurant, index) => (
        <RestaurantCard
          key={restaurant.id}
          name={restaurant.name}
          cuisine={restaurant.city}
          rating={restaurant.rating}
          image={index}
          onPress={() => openRestaurant(restaurant.id)}
        />
      ))}
    </ScrollView>
  );

  return (
    <Screen>
      <View style={consumerStyles.hero}>
        <View style={consumerStyles.heroCopy}>
          <Text style={[sharedStyles.hero, { color: colors.foreground }]}>
            Discover restaurants near you
          </Text>
          <Text style={[sharedStyles.intro, { color: colors.mutedForeground }]}>
            Real places from the shared Food Advisor directory.
          </Text>
        </View>
        <Image source={foodImages[0]} style={consumerStyles.heroImage} />
      </View>

      <View style={consumerStyles.quickActions}>
        {[
          { label: 'Browse Cities', icon: 'map-pin' as const, path: '/cities' as const },
          { label: 'Search', icon: 'search' as const, path: '/search' as const },
          {
            label: 'Restaurant Assistant',
            icon: 'message-circle' as const,
            path: '/assistant' as const,
          },
        ].map((action) => (
          <Pressable
            key={action.path}
            accessibilityRole="button"
            onPress={() => {
              Haptics.selectionAsync();
              router.push(action.path);
            }}
            style={[
              consumerStyles.quickAction,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Feather name={action.icon} size={20} color={colors.primary} />
            <Text style={[consumerStyles.quickActionText, { color: colors.foreground }]}>
              {action.label}
            </Text>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
        ))}
      </View>

      <Pressable
        testID="discover-near-me"
        disabled={locationState === 'requesting'}
        onPress={handleNearMe}
        style={[consumerStyles.nearMe, { backgroundColor: colors.primary }]}
      >
        <View style={consumerStyles.nearMeIcon}>
          <Feather name="navigation" size={20} color={colors.primaryForeground} />
        </View>
        <View style={consumerStyles.nearMeCopy}>
          <Text style={[consumerStyles.nearMeTitle, { color: colors.primaryForeground }]}>
            {locationState === 'requesting'
              ? 'Finding your location…'
              : nearbyRequested
                ? 'Refresh places near me'
                : 'Find places near me'}
          </Text>
          <Text style={[consumerStyles.nearMeText, { color: colors.primaryForeground }]}>
            Uses your device’s live GPS with a 1, 5, 10 or 25 mile radius
          </Text>
        </View>
        {locationState === 'requesting' ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Feather name="crosshair" size={20} color={colors.primaryForeground} />
        )}
      </Pressable>
      <View style={consumerStyles.radiusRow}>
        <Text style={[consumerStyles.radiusLabel, { color: colors.mutedForeground }]}>
          RADIUS
        </Text>
        {[1, 5, 10, 25].map((radius) => (
          <Pill
            key={radius}
            selected={radiusMiles === radius}
            onPress={() => {
              setRadiusMiles(radius);
              if (nearbyRequested) setNearbyRequested(false);
            }}
          >
            {radius} mi
          </Pill>
        ))}
      </View>
      {locationError && (
        <Notice>
          {locationError}
          {locationState === 'denied' && permission?.canAskAgain === false
            ? ' Open device Settings to enable location.'
            : ''}
        </Notice>
      )}

      <Section title="Near you" action={`${directory.length} places`}>
        {restaurants.isLoading ? (
          <ActivityIndicator color={colors.primary} style={consumerStyles.loader} />
        ) : directory.length ? (
          restaurantRail(directory.slice(0, 6))
        ) : (
          <Notice>
            No restaurants are available yet. The directory never substitutes city-centre
            locations for missing coordinates.
          </Notice>
        )}
      </Section>

      <Section title="Popular cuisines" action="Explore">
        <View style={consumerStyles.cuisines}>
          {['British', 'Italian', 'Japanese', 'Indian', 'Mediterranean', 'Vegan'].map(
            (cuisine) => (
              <Pill key={cuisine} onPress={() => router.push('/search')}>
                {cuisine}
              </Pill>
            ),
          )}
        </View>
      </Section>

      {directory.length > 1 && (
        <Section title="Trending now" action="From the directory">
          {restaurantRail([...directory].reverse().slice(0, 6))}
        </Section>
      )}

      <Section title="Promotions & events">
        <View style={consumerStyles.conceptGrid}>
          <Pressable
            onPress={() => router.push('/search')}
            style={[consumerStyles.conceptCard, { backgroundColor: colors.secondary }]}
          >
            <Feather name="tag" size={21} color={colors.primary} />
            <Text style={[consumerStyles.conceptTitle, { color: colors.foreground }]}>
              Promotions
            </Text>
            <Text style={[sharedStyles.small, { color: colors.mutedForeground }]}>
              Browse future verified offers
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/search')}
            style={[consumerStyles.conceptCard, { backgroundColor: colors.secondary }]}
          >
            <Feather name="calendar" size={21} color={colors.primary} />
            <Text style={[consumerStyles.conceptTitle, { color: colors.foreground }]}>
              Events
            </Text>
            <Text style={[sharedStyles.small, { color: colors.mutedForeground }]}>
              Browse future restaurant events
            </Text>
          </Pressable>
        </View>
        <Notice>
          Promotion, event and recommendation labels remain concept previews until verified
          restaurant data is connected.
        </Notice>
      </Section>

      <View style={consumerStyles.ownerAction}>
        <Text style={[sharedStyles.serif, { color: colors.foreground }]}>
          Own a restaurant?
        </Text>
        <Text style={[sharedStyles.intro, { color: colors.mutedForeground }]}>
          Preview the owner setup and AI marketing dashboard.
        </Text>
        <ConceptButton label="Switch to Owner Mode" onPress={() => router.push('/owner-entry')} />
      </View>
    </Screen>
  );
}

const consumerStyles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'flex-end', gap: 14, marginTop: 4 },
  heroCopy: { flex: 1 },
  heroImage: { width: 104, height: 132, borderRadius: 24 },
  quickActions: { gap: 10, marginTop: 22 },
  quickAction: {
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  quickActionText: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 16 },
  nearMe: {
    minHeight: 78,
    borderRadius: 22,
    padding: 15,
    marginTop: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  nearMeIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nearMeCopy: { flex: 1 },
  nearMeTitle: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  nearMeText: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 15, opacity: 0.86 },
  radiusRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7, marginTop: 12 },
  radiusLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1, marginRight: 2 },
  rail: { gap: 10, paddingRight: 20 },
  loader: { marginVertical: 28 },
  cuisines: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  conceptGrid: { flexDirection: 'row', gap: 10 },
  conceptCard: { flex: 1, minHeight: 135, borderRadius: 18, padding: 15, gap: 8 },
  conceptTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, marginTop: 4 },
  ownerAction: { marginTop: 30, gap: 10 },
});

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: Platform.OS === 'web' ? 84 : 24, paddingBottom: 120 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 22 },
  mark: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 1.7 },
  hero: { fontFamily: 'Inter_700Bold', fontSize: 42, lineHeight: 46, letterSpacing: -1.5 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 24, marginTop: 12, marginBottom: 24 },
  nearbyCard: { borderWidth: 1, borderRadius: 22, padding: 16, marginBottom: 18 },
  nearbyHeader: { flexDirection: 'row', alignItems: 'center' },
  nearbyIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  nearbyCopy: { flex: 1, marginLeft: 11 },
  nearbyTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  nearbyDescription: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17, marginTop: 2 },
  radiusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 15 },
  radiusLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1, marginRight: 2 },
  radiusChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6 },
  radiusText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  nearbyButton: { height: 45, borderRadius: 14, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', marginTop: 15 },
  nearbyError: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, padding: 10, marginTop: 10 },
  nearbyErrorText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 16 },
  retryText: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  budgetCard: { borderRadius: 24, padding: 22, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 28 },
  cardLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.2 },
  budgetValue: { fontFamily: 'Inter_700Bold', fontSize: 35, marginTop: 4 },
  budgetMeta: { alignItems: 'flex-end', paddingBottom: 3 },
  metaStrong: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  metaLabel: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, marginBottom: 14 },
  cityWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 22 },
  cityChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 5 },
  cityText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  controls: { flexDirection: 'row', gap: 10 },
  inputCard: { flex: 1, borderWidth: 1, borderRadius: 18, padding: 14 },
  fieldLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1 },
  moneyRow: { flexDirection: 'row', alignItems: 'center', marginTop: 7 },
  currency: { fontFamily: 'Inter_700Bold', fontSize: 22 },
  input: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 22, paddingVertical: 0 },
  stepper: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 7 },
  limitValue: { fontFamily: 'Inter_700Bold', fontSize: 19 },
  error: { flexDirection: 'row', gap: 9, padding: 13, borderRadius: 14, marginTop: 12 },
  errorText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
  planCard: { borderRadius: 16, padding: 15, marginTop: 12 },
  planTitle: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  planNote: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12, marginBottom: 32 },
  secondaryButton: { flex: 1, height: 50, borderWidth: 1.5, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  primaryButton: { flex: 1.35, height: 50, borderRadius: 16, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  listHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  count: { fontFamily: 'Inter_600SemiBold', fontSize: 13, marginBottom: 14 },
  loader: { marginVertical: 20 },
  restaurant: { borderWidth: 1, borderRadius: 18, padding: 13, flexDirection: 'row', alignItems: 'center', marginBottom: 9 },
  restaurantIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  restaurantCopy: { flex: 1, marginHorizontal: 11 },
  restaurantName: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  address: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 3 },
  restaurantMeta: { alignItems: 'flex-end', gap: 4 },
  distance: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  rating: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  empty: { alignItems: 'center', paddingVertical: 34, gap: 10 },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center', maxWidth: 240 },
});
