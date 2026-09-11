import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useListRestaurants } from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import { Screen, Section, Pill, RestaurantCard, Notice } from '@/components/FoodAdvisor';
import { useColors } from '@/hooks/useColors';

export default function MapScreen() {
  const colors = useColors(); const [filter, setFilter] = useState('Open now'); const restaurants = useListRestaurants();
  return <Screen><Text style={[styles.title, { color: colors.foreground }]}>Explore on the map</Text><Text style={[styles.sub, { color: colors.mutedForeground }]}>Your GPS position is compared with stored restaurant coordinates</Text>
    <View style={styles.filters}>{['Open now', 'Cuisine', 'Price', 'Promotions', 'Events'].map(x => <Pill key={x} selected={filter === x} onPress={() => setFilter(x)}>{x}</Pill>)}</View>
    <View style={[styles.map, { backgroundColor: colors.secondary }]}><Feather name="map-pin" size={31} color={colors.primary} style={{ position: 'absolute', left: '25%', top: '28%' }} /><Feather name="map-pin" size={31} color={colors.primary} style={{ position: 'absolute', left: '63%', top: '53%' }} /><Text style={[styles.mapLabel, { color: colors.mutedForeground }]}>Illustrative sample map · no provider</Text></View>
    <Section title="Places on this area"><View>{(restaurants.data ?? []).slice(0, 3).map((r, i) => <RestaurantCard key={r.id} name={r.name} cuisine={r.city} distance="Stored coordinates" rating={r.rating} image={i} />)}</View></Section>
    {!restaurants.data?.length && <Notice>No mapped restaurants are available yet. Near me never substitutes city-centre results.</Notice>}
    <Pressable style={[styles.areaButton, { borderColor: colors.primary }]}><Text style={{ color: colors.primary, fontFamily: 'Inter_700Bold' }}>Search this area</Text></Pressable>
  </Screen>;
}
const styles = StyleSheet.create({ title: { fontFamily: 'Inter_700Bold', fontSize: 30 }, sub: { fontFamily: 'Inter_400Regular', marginTop: 5 }, filters: { flexDirection: 'row', gap: 7, marginTop: 18, flexWrap: 'wrap' }, map: { height: 270, borderRadius: 20, marginTop: 16, position: 'relative', overflow: 'hidden' }, mapLabel: { position: 'absolute', bottom: 12, left: 14, fontFamily: 'Inter_500Medium', fontSize: 11 }, mapPin: { position: 'absolute' }, areaButton: { marginTop: 14, borderWidth: 1, borderRadius: 14, minHeight: 46, alignItems: 'center', justifyContent: 'center' } });