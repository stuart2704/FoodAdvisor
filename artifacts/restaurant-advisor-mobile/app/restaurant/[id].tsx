import { useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { Screen, Section, Notice, foodImages, sharedStyles } from '@/components/FoodAdvisor';
import { Image } from 'react-native';
import { useColors } from '@/hooks/useColors';
export default function RestaurantScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); const colors = useColors();
  return <Screen><Image source={foodImages[0]} style={{ width: '100%', height: 190, borderRadius: 22 }} /><Text style={[sharedStyles.hero, { color: colors.foreground }]}>{id || 'Restaurant profile'}</Text><Text style={[sharedStyles.intro, { color: colors.mutedForeground }]}>Modern British · ★ 4.8 · Open now</Text><Section title="About"><Text style={{ color: colors.foreground, lineHeight: 22 }}>A place worth telling people about. Contact, booking and menu details are provided by the restaurant directory.</Text></Section><Section title="Menu"><View style={[sharedStyles.row, { borderBottomColor: colors.border }]}><Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>Menu details unavailable</Text></View></Section><Notice>AI summaries, booking, payment and replies are concept-only until connected to verified restaurant capabilities.</Notice></Screen>;
}