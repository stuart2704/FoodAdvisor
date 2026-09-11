import { Text, View } from 'react-native';
import { Link } from 'expo-router';
import { Screen, Section, ConceptButton, Notice, sharedStyles } from '@/components/FoodAdvisor';
import { useColors } from '@/hooks/useColors';

export default function ProfileScreen() {
  const colors = useColors();
  return <Screen><Text style={[sharedStyles.hero, { color: colors.foreground }]}>Your Profile</Text><View style={[styles.card, { backgroundColor: colors.primary }]}><Text style={{ color: '#FFE3D4', fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1 }}>TASTING PROFILE</Text><Text style={{ color: colors.primaryForeground, fontFamily: 'Inter_700Bold', fontSize: 25, marginTop: 8 }}>Saved places, your way.</Text><Text style={{ color: '#FFE3D4', marginTop: 4 }}>Personalisation is a concept preview.</Text></View>
    <Section title="Account">{['Saved Restaurants', 'Preferences', 'Notifications', 'Language', 'About', 'Support'].map(x => <View key={x} style={[sharedStyles.row, { borderBottomColor: colors.border }]}><Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{x}</Text></View>)}</Section>
    <Link href="/owner-entry" asChild><View><ConceptButton label="Switch to Owner Mode" /></View></Link><Notice>Owner tools are a concept preview. AI generation, uploads and account connections are not activated.</Notice>
  </Screen>;
}
const styles = { card: { borderRadius: 20, padding: 18, marginTop: 18 } };