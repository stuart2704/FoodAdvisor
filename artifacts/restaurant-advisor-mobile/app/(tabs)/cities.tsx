import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useListCities } from '@workspace/api-client-react';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/FoodAdvisor';
import { useColors } from '@/hooks/useColors';

export default function CitiesScreen() {
  const colors = useColors();
  const router = useRouter();
  const cities = useListCities();

  return (
    <Screen scroll={false}>
      <View style={styles.heading}>
        <Text style={[styles.title, { color: colors.foreground }]}>Explore cities</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Browse ranked restaurants in each destination.
        </Text>
      </View>
      {cities.isPending ? (
        <ActivityIndicator color={colors.primary} />
      ) : cities.isError ? (
        <Text style={{ color: colors.destructive }}>Cities are unavailable.</Text>
      ) : (
        <FlatList
          data={cities.data ?? []}
          keyExtractor={(item) => item.slug}
          scrollEnabled={(cities.data?.length ?? 0) > 0}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: '/search',
                  params: { city: item.city },
                })
              }
              style={[styles.row, { borderColor: colors.border, backgroundColor: colors.card }]}
            >
              <View style={styles.rowText}>
                <Text style={[styles.city, { color: colors.foreground }]}>{item.city}</Text>
                <Text style={[styles.count, { color: colors.mutedForeground }]}>
                  {item.count.toLocaleString()} restaurants
                </Text>
              </View>
              <Feather name="chevron-right" size={22} color={colors.primary} />
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={{ color: colors.mutedForeground }}>No cities are available yet.</Text>
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { marginBottom: 20 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 30, letterSpacing: -0.8 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, marginTop: 6 },
  list: { gap: 10, paddingBottom: 20 },
  row: {
    minHeight: 76,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowText: { flex: 1 },
  city: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  count: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 3 },
});