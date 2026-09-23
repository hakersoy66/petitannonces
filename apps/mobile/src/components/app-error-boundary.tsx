import type { ErrorBoundaryProps } from 'expo-router';
import * as Linking from 'expo-linking';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PA } from '../constants/theme';
import { AppIcon } from './app-icon';

const SUPPORT_URL = 'https://petitannonces.fr/assistance';

export function AppErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <View style={s.icon} accessible={false}>
          <AppIcon name="triangle-exclamation" size={30} color={PA.primary} />
        </View>
        <Text accessibilityRole="header" style={s.title}>Un problème est survenu</Text>
        <Text style={s.text}>
          Petit Annonces n’a pas pu afficher cet écran. Vos brouillons enregistrés restent protégés. Vous pouvez réessayer immédiatement.
        </Text>
        {__DEV__ ? <Text selectable style={s.debug}>Erreur : {error.message}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Réessayer d’afficher l’écran"
          testID="app_error_retry"
          style={({ pressed }) => [s.primary, pressed && s.pressed]}
          onPress={() => void retry()}
        >
          <AppIcon name="rotate-right" size={14} color="#fff" />
          <Text style={s.primaryText}>Réessayer</Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Ouvrir l’assistance Petit Annonces"
          style={({ pressed }) => [s.secondary, pressed && s.pressed]}
          onPress={() => void Linking.openURL(SUPPORT_URL)}
        >
          <AppIcon name="circle-question" size={14} color={PA.primary} />
          <Text style={s.secondaryText}>Contacter l’assistance</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PA.bg },
  page: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 28, paddingBottom: 48 },
  icon: { width: 68, height: 68, borderRadius: 22, backgroundColor: PA.softPurple, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  title: { maxWidth: 420, textAlign: 'center', fontSize: 24, lineHeight: 30, fontWeight: '900', color: PA.ink },
  text: { maxWidth: 430, marginTop: 10, marginBottom: 22, textAlign: 'center', fontSize: 14, lineHeight: 21, color: PA.muted },
  debug: { width: '100%', maxWidth: 520, maxHeight: 110, marginBottom: 18, padding: 10, borderRadius: 12, backgroundColor: '#fff0f0', color: PA.danger, fontSize: 11 },
  primary: { width: '100%', maxWidth: 420, minHeight: 50, borderRadius: 15, backgroundColor: PA.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18 },
  primaryText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  secondary: { width: '100%', maxWidth: 420, minHeight: 48, marginTop: 10, borderRadius: 15, backgroundColor: '#fff', borderWidth: 1, borderColor: PA.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18 },
  secondaryText: { color: PA.primary, fontSize: 13, fontWeight: '900' },
  pressed: { opacity: 0.72 },
});
