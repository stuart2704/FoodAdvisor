import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Screen, Section, Pill, Notice, sharedStyles } from '@/components/FoodAdvisor';
import { useColors } from '@/hooks/useColors';

export default function SearchScreen() {
  const colors = useColors(); const [query, setQuery] = useState('');
  return <Screen><Text style={[sharedStyles.hero, { color: colors.foreground }]}>Search</Text><TextInput value={query} onChangeText={setQuery} placeholder="Search restaurants, dishes, cuisines…" placeholderTextColor={colors.mutedForeground} style={[sharedStyles.input, { borderColor: colors.border, color: colors.foreground }]} />
    <Section title="Quick filters"><View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{['Near me', 'Open now', 'Delivery', 'Bookings', 'Promotions', 'Events'].map(x => <Pill key={x}>{x}</Pill>)}</View></Section>
    <Section title="Popular searches">{['Sushi near me', 'Indian food near me', 'Romantic restaurants', 'Halal restaurants', 'Breakfast near me'].map((x, i) => <View key={x} style={[sharedStyles.row, { borderBottomColor: colors.border }]}><Text style={{ color: colors.primary, fontFamily: 'Inter_700Bold', width: 25 }}>{i + 1}</Text><Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{x}</Text></View>)}</Section>
    {query.length > 0 && <Notice>Search is connected to the shared restaurant directory. Matching filters will be introduced as the directory grows.</Notice>}
  </Screen>;
}