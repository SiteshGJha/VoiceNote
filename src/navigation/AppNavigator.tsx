import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './routes';
import { HomeScreen } from '@/screens/HomeScreen';
import { ResultScreen } from '@/screens/ResultScreen';
import { HistoryScreen } from '@/screens/HistoryScreen';
import { ModelsScreen } from '@/screens/ModelsScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { PrivacyScreen } from '@/screens/PrivacyScreen';
import { ReportsScreen } from '@/screens/ReportsScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export const AppNavigator: React.FC = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Result" component={ResultScreen} />
        <Stack.Screen name="History" component={HistoryScreen} />
        <Stack.Screen name="Models" component={ModelsScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Privacy" component={PrivacyScreen} />
        <Stack.Screen name="Reports" component={ReportsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};
