import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Screen } from '@/components/FoodAdvisor';
import { useColors } from '@/hooks/useColors';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

export default function AssistantScreen() {
  const colors = useColors();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    const message = input.trim();
    if (!message || loading) return;
    setMessages((current) => [
      ...current,
      { id: `${Date.now()}-user`, role: 'user', text: message },
    ]);
    setInput('');
    setLoading(true);
    setError('');
    try {
      const response = await fetch(
        `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/chatbot`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        },
      );
      const payload = (await response.json()) as {
        success?: boolean;
        reply?: string;
        error?: string;
      };
      if (!response.ok || !payload.success || !payload.reply) {
        throw new Error(payload.error ?? 'The assistant is unavailable.');
      }
      setMessages((current) => [
        ...current,
        { id: `${Date.now()}-assistant`, role: 'assistant', text: payload.reply! },
      ]);
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : 'The assistant is unavailable.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <View style={styles.container}>
        <Text style={[styles.title, { color: colors.foreground }]}>Restaurant Assistant</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Ask for restaurants by cuisine or city.
        </Text>
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messages}
          ListEmptyComponent={
            <Text style={{ color: colors.mutedForeground }}>
              Try “Italian in Cardiff.”
            </Text>
          }
          renderItem={({ item }) => (
            <View
              style={[
                styles.message,
                {
                  alignSelf: item.role === 'user' ? 'flex-end' : 'flex-start',
                  backgroundColor:
                    item.role === 'user' ? colors.primary : colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text
                style={{
                  color:
                    item.role === 'user'
                      ? colors.primaryForeground
                      : colors.foreground,
                }}
              >
                {item.text}
              </Text>
            </View>
          )}
        />
        {error ? <Text style={{ color: colors.destructive }}>{error}</Text> : null}
        <View style={styles.composer}>
          <TextInput
            value={input}
            onChangeText={setInput}
            onSubmitEditing={send}
            placeholder="Cuisine or city…"
            placeholderTextColor={colors.mutedForeground}
            maxLength={500}
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.foreground },
            ]}
          />
          <Pressable
            onPress={send}
            disabled={loading || !input.trim()}
            style={[styles.button, { backgroundColor: colors.primary }]}
          >
            {loading ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Send</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingBottom: 110 },
  title: { fontSize: 30, fontWeight: '800' },
  subtitle: { marginTop: 8, fontSize: 16 },
  messages: { flexGrow: 1, gap: 12, paddingVertical: 24 },
  message: { maxWidth: '88%', borderRadius: 16, borderWidth: 1, padding: 14 },
  composer: { flexDirection: 'row', gap: 10 },
  input: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, minHeight: 48 },
  button: { minWidth: 72, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
});