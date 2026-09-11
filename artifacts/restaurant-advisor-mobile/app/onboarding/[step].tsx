import { useLocalSearchParams, Link } from 'expo-router';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Screen, ConceptButton, Notice, Pill, sharedStyles } from '@/components/FoodAdvisor';
import { useColors } from '@/hooks/useColors';
const steps: Record<string, { title: string; body: string }> = {
 welcome: { title: 'Grow your restaurant with AI', body: 'Daily content, enhanced photos, videos, promotions, and instant replies.' },
 details: { title: 'Restaurant details', body: 'Add the information customers need to find you.' },
 'brand-style': { title: 'Choose your brand style', body: 'Set a direction for future content.' },
 photos: { title: 'Upload your photos', body: 'Add 3–5 photos for future enhancement.' },
 goals: { title: 'What are your goals?', body: 'Choose what you want to improve.' },
 subscription: { title: 'Activate your AI marketing', body: 'Daily content, enhanced photos, videos, promotions, and instant replies.' },
};
const next: Record<string, string> = { welcome: 'details', details: 'brand-style', 'brand-style': 'photos', photos: 'goals', goals: 'subscription', subscription: 'dashboard' };
export default function Onboarding() { const { step = 'welcome' } = useLocalSearchParams<{ step: string }>(); const data = steps[step] ?? steps.welcome; const colors = useColors(); const options = ['Friendly', 'Luxury', 'Bold', 'Traditional', 'Playful', 'Modern'];
  return <Screen owner><Text style={[sharedStyles.tag, { color: colors.primary }]}>SETUP · {Object.keys(steps).indexOf(step) + 1} OF 6</Text><Text style={[sharedStyles.hero, { color: colors.foreground }]}>{data.title}</Text><Text style={[sharedStyles.intro, { color: colors.mutedForeground }]}>{data.body}</Text>{step === 'details' && ['Restaurant name', 'Location / address', 'Cuisine', 'Opening hours', 'Delivery platforms', 'Social media links'].map(x => <TextInput key={x} placeholder={x} placeholderTextColor={colors.mutedForeground} style={[sharedStyles.input, { borderColor: colors.border, color: colors.foreground }]} />)}{step === 'brand-style' && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>{options.map(x => <Pill key={x}>{x}</Pill>)}</View>}{step === 'photos' && <Notice>Upload is unavailable in this concept flow. No files are sent or stored.</Notice>}{step === 'subscription' && <><Text style={[sharedStyles.serif, { color: colors.foreground, marginTop: 24 }]}>£99/month</Text><Notice>Concept only — checkout unavailable. No payment will be taken.</Notice></>}<Link href={`/onboarding/${next[step] ?? 'welcome'}`} asChild><View style={{ marginTop: 24 }}><ConceptButton label={step === 'subscription' ? 'View dashboard' : step === 'welcome' ? 'Start setup' : 'Continue'} /></View></Link></Screen>;
}