import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { type Href, Link, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import { getGetRewardsQueryKey, useGetRewards } from '@workspace/api-client-react';
import { Screen, Section, ConceptButton, Notice, sharedStyles } from '@/components/FoodAdvisor';
import { useColors } from '@/hooks/useColors';

export default function ProfileScreen() {
  const colors = useColors();
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const rewards = useGetRewards({
    query: {
      enabled: isLoaded && isSignedIn,
      queryKey: getGetRewardsQueryKey(),
    },
  });

  return <Screen><Text style={[sharedStyles.hero, { color: colors.foreground }]}>Your Profile</Text>
    <Section title="Rewards">
      {!isLoaded ? <ActivityIndicator color={colors.primary} /> : !isSignedIn ? (
        <View style={[styles.signInCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="award" size={28} color={colors.primary} />
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>See your reward points</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>Sign in to view your balance and recent points from reviews and booking requests.</Text>
          <Pressable testID="rewards-sign-in" onPress={() => router.push('/sign-in' as Href)} style={[styles.button, { backgroundColor: colors.primary }]}>
            <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Sign in</Text>
          </Pressable>
        </View>
      ) : rewards.isLoading ? <ActivityIndicator color={colors.primary} /> : rewards.isError ? (
        <Notice>Rewards are temporarily unavailable. Pull down or return shortly to try again.</Notice>
      ) : (
        <>
          <View style={[styles.balanceCard, { backgroundColor: colors.primary }]}>
            <Text style={[styles.eyebrow, { color: colors.primaryForeground }]}>CURRENT BALANCE</Text>
            <Text style={[styles.balance, { color: colors.primaryForeground }]}>{rewards.data?.data.points ?? 0}</Text>
            <Text style={[styles.pointsLabel, { color: colors.primaryForeground }]}>points</Text>
          </View>
          <View style={[styles.activityCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.activityTitle, { color: colors.foreground }]}>Recent earnings</Text>
            {rewards.data?.data.activity.length ? rewards.data.data.activity.map((item) => (
              <View key={item.id} style={[styles.activityRow, { borderBottomColor: colors.border }]}>
                <View style={[styles.icon, { backgroundColor: colors.secondary }]}>
                  <Feather name={item.action === 'review' ? 'star' : 'calendar'} size={17} color={colors.primary} />
                </View>
                <View style={styles.activityCopy}>
                  <Text style={[styles.action, { color: colors.foreground }]}>{item.action === 'review' ? 'Restaurant review' : 'Booking request'}</Text>
                  <Text style={[styles.date, { color: colors.mutedForeground }]}>{new Date(item.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                </View>
                <Text style={[styles.earned, { color: colors.primary }]}>+{item.points}</Text>
              </View>
            )) : <Text style={[styles.empty, { color: colors.mutedForeground }]}>Your review and booking points will appear here.</Text>}
          </View>
        </>
      )}
    </Section>
    <View style={[styles.card, { backgroundColor: colors.primary }]}><Text style={[styles.eyebrow, { color: colors.primaryForeground }]}>TASTING PROFILE</Text><Text style={{ color: colors.primaryForeground, fontFamily: 'Inter_700Bold', fontSize: 25, marginTop: 8 }}>Saved places, your way.</Text><Text style={[styles.body, { color: colors.primaryForeground }]}>Personalisation is a concept preview.</Text></View>
    <Section title="Account">{['Saved Restaurants', 'Preferences', 'Notifications', 'Language', 'About', 'Support'].map(x => <View key={x} style={[sharedStyles.row, { borderBottomColor: colors.border }]}><Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{x}</Text></View>)}</Section>
    <Link href="/owner-entry" asChild><View><ConceptButton label="Switch to Owner Mode" /></View></Link><Notice>Owner tools are a concept preview. AI generation, uploads and account connections are not activated.</Notice>
  </Screen>;
}
const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: 18, marginTop: 18 },
  signInCard: { borderRadius: 18, borderWidth: 1, padding: 20, alignItems: 'flex-start', gap: 8 },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, marginTop: 4 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginTop: 4 },
  button: { borderRadius: 14, minHeight: 46, paddingHorizontal: 20, justifyContent: 'center', marginTop: 8 },
  buttonText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  balanceCard: { borderRadius: 20, padding: 20 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1, opacity: 0.82 },
  balance: { fontFamily: 'Inter_700Bold', fontSize: 52, lineHeight: 58, marginTop: 4 },
  pointsLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14, opacity: 0.88 },
  activityCard: { borderRadius: 18, borderWidth: 1, paddingHorizontal: 16, marginTop: 12 },
  activityTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, paddingTop: 16, paddingBottom: 8 },
  activityRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, gap: 11 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  activityCopy: { flex: 1 },
  action: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  date: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  earned: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  empty: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, paddingVertical: 18 },
});