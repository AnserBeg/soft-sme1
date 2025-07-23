import React from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';

export default function TimeTrackingScreen({ user, setUser }) {
  // You will fetch and display time tracking data here
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome, {user?.email}</Text>
      <Text style={{ marginBottom: 24 }}>Time Tracking Page (to be implemented)</Text>
      <Button title="Logout" onPress={() => setUser(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 24, marginBottom: 24, textAlign: 'center' },
}); 