import { StyleSheet, Text, View } from "react-native";
import { dark } from "@mando/core/theme";

// Pantalla de arranque provisional de la app (Etapa 2). El ingreso con código llega en el siguiente paso.
export default function Inicio() {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>MANDO</Text>
      <Text style={styles.body}>La app del equipo de campo está en construcción.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: dark.background },
  title: { fontSize: 32, fontWeight: "600", color: dark.accent, letterSpacing: 4 },
  body: { marginTop: 12, fontSize: 16, color: dark.inkMuted, textAlign: "center" },
});
