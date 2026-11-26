import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { dark } from "@mando/core/theme";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: dark.background } }} />
    </>
  );
}
