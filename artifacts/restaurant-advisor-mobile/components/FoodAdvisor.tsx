import React, { ReactNode } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

export const logo = require('../assets/food-advisor-logo.png');
export const foodImages = [
  require('../assets/pasta.jpg'),
  require('../assets/sushi.jpg'),
  require('../assets/interior.jpg'),
];

export function Header({ owner = false }: { owner?: boolean }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === 'web' ? 12 : 8) }]}>
    <Link href="/(tabs)" asChild><Pressable style={styles.brand}>
      <Image source={logo} style={styles.logo} /><Text style={[styles.brandText, { color: colors.foreground }]}>THE FOOD ADVISOR</Text>
    </Pressable></Link>
    <Text style={[styles.tag, { color: colors.primary }]}>{owner ? 'OWNER · CONCEPT' : 'CONCEPT · SAMPLE'}</Text>
  </View>;
}

export function Screen({ children, owner = false, scroll = true }: { children: ReactNode; owner?: boolean; scroll?: boolean }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const content = <View style={[styles.screen, { paddingBottom: insets.bottom + 92 }]}>{children}</View>;
  return <View style={[styles.root, { backgroundColor: colors.background }]}><Header owner={owner} />{scroll ? <ScrollView contentContainerStyle={{ paddingBottom: 20 }} contentInsetAdjustmentBehavior="automatic">{content}</ScrollView> : content}</View>;
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: string }) {
  const colors = useColors();
  return <View style={styles.section}><View style={styles.sectionHead}><Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>{action && <Text style={[styles.small, { color: colors.primary }]}>{action}</Text>}</View>{children}</View>;
}

export function RestaurantCard({ name, cuisine, distance, rating, image = 0, onPress }: { name: string; cuisine: string; distance?: string; rating?: number | null; image?: number; onPress?: () => void }) {
  const colors = useColors();
  return <Pressable onPress={onPress} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <Image source={foodImages[image % foodImages.length]} style={styles.cardImage} />
    <View style={styles.cardBody}><Text style={[styles.cardName, { color: colors.foreground }]} numberOfLines={1}>{name}</Text><Text style={[styles.small, { color: colors.mutedForeground }]}>{cuisine}{distance ? ` · ${distance}` : ''}</Text><Text style={[styles.small, { color: colors.foreground }]}>{rating == null ? 'Rating unavailable' : `★ ${rating.toFixed(1)}`} · <Text style={{ color: colors.primary }}>Open now</Text></Text></View>
  </Pressable>;
}

export function Pill({ children, selected = false, onPress }: { children: ReactNode; selected?: boolean; onPress?: () => void }) {
  const colors = useColors();
  return <Pressable onPress={onPress} style={[styles.pill, { backgroundColor: selected ? colors.accent : colors.card, borderColor: selected ? colors.accent : colors.border }]}><Text style={[styles.pillText, { color: colors.foreground }]}>{children}</Text></Pressable>;
}

export function Notice({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <View style={[styles.notice, { backgroundColor: colors.secondary }]}><Feather name="info" size={16} color={colors.primary} /><Text style={[styles.small, { color: colors.foreground, flex: 1 }]}>{children}</Text></View>;
}

export function ConceptButton({ label, onPress }: { label: string; onPress?: () => void }) {
  const colors = useColors();
  return <Pressable onPress={onPress} style={[styles.button, { backgroundColor: colors.primary }]}><Text style={[styles.buttonText, { color: colors.primaryForeground }]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { width: 30, height: 30, borderRadius: 8 },
  brandText: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1 },
  tag: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 1 },
  screen: { paddingHorizontal: 20, paddingTop: 12 },
  hero: { fontFamily: 'Inter_700Bold', fontSize: 34, lineHeight: 38, letterSpacing: -1, marginTop: 10 },
  serif: { fontFamily: 'Inter_700Bold', fontSize: 25, letterSpacing: -0.5 },
  intro: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, marginTop: 8 },
  section: { marginTop: 24 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  small: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  cards: { flexDirection: 'row', gap: 10 },
  card: { width: 158, borderWidth: 1, borderRadius: 17, overflow: 'hidden' },
  cardImage: { width: '100%', height: 90 },
  cardBody: { padding: 10, gap: 3 },
  cardName: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  pillText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  button: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  buttonText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  notice: { marginTop: 14, borderRadius: 14, padding: 12, flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { borderWidth: 1, borderRadius: 12, padding: 13, marginTop: 8, fontFamily: 'Inter_400Regular', fontSize: 14 },
  row: { borderBottomWidth: 1, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
});
export const sharedStyles = styles;