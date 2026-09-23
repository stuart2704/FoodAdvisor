import React from 'react';
import { useSignIn } from '@clerk/expo';
import { type Href, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

export default function SignInScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn, errors, fetchStatus } = useSignIn();
  const [emailAddress, setEmailAddress] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [message, setMessage] = React.useState('');

  const submit = async () => {
    setMessage('');
    const { error } = await signIn.password({ emailAddress, password });
    if (error) return;
    if (signIn.status === 'complete') {
      await signIn.finalize({
        navigate: ({ session }) => {
          if (session?.currentTask) {
            setMessage('Please complete the additional account verification in your browser.');
            return;
          }
          router.replace('/(tabs)/profile' as Href);
        },
      });
    } else {
      setMessage('This account needs an additional verification step before it can sign in.');
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <Pressable onPress={() => router.back()}><Text style={[styles.back, { color: colors.primary }]}>Back</Text></Pressable>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Sign in for rewards</Text>
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>View your points and recent earnings from reviews and booking requests.</Text>
        <Text style={[styles.label, { color: colors.foreground }]}>Email address</Text>
        <TextInput testID="sign-in-email" autoCapitalize="none" keyboardType="email-address" value={emailAddress} onChangeText={setEmailAddress} placeholder="you@example.com" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.input }]} />
        {errors.fields.identifier ? <Text style={[styles.error, { color: colors.destructive }]}>{errors.fields.identifier.message}</Text> : null}
        <Text style={[styles.label, { color: colors.foreground }]}>Password</Text>
        <TextInput testID="sign-in-password" secureTextEntry value={password} onChangeText={setPassword} placeholder="Your password" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.input }]} />
        {errors.fields.password ? <Text style={[styles.error, { color: colors.destructive }]}>{errors.fields.password.message}</Text> : null}
        {message ? <Text style={[styles.error, { color: colors.destructive }]}>{message}</Text> : null}
        <Pressable testID="sign-in-submit" disabled={!emailAddress || !password || fetchStatus === 'fetching'} onPress={submit} style={({ pressed }) => [styles.button, { backgroundColor: colors.primary }, (!emailAddress || !password || fetchStatus === 'fetching') && styles.disabled, pressed && styles.pressed]}>
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>{fetchStatus === 'fetching' ? 'Signing in…' : 'Sign in'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  back: { fontFamily: 'Inter_600SemiBold', fontSize: 15, paddingVertical: 12 },
  card: { borderWidth: 1, borderRadius: 20, padding: 20, marginTop: 18 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 28 },
  intro: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 16 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 13, marginTop: 12 },
  input: { borderWidth: 1, borderRadius: 12, padding: 13, marginTop: 7, fontFamily: 'Inter_400Regular', fontSize: 15 },
  error: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17, marginTop: 7 },
  button: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  buttonText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.82 },
});