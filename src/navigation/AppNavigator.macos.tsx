import React from 'react';
import { StyleSheet, View } from 'react-native';
import {
  NavigationContainer,
  createNavigatorFactory,
  useNavigationBuilder,
  StackRouter,
  DefaultNavigatorOptions,
  StackNavigationState,
  StackRouterOptions,
  ParamListBase,
} from '@react-navigation/native';
import { RootStackParamList } from './routes';
import { HomeScreen } from '@/screens/HomeScreen';
import { ResultScreen } from '@/screens/ResultScreen';
import { HistoryScreen } from '@/screens/HistoryScreen';
import { ModelsScreen } from '@/screens/ModelsScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { PrivacyScreen } from '@/screens/PrivacyScreen';

interface StackNavigationOptions {
  headerShown?: boolean;
  animation?: string;
}

type Props = DefaultNavigatorOptions<
  ParamListBase,
  StackNavigationState<ParamListBase>,
  StackNavigationOptions,
  {}
> &
  StackRouterOptions;

function MacStackNavigator({
  initialRouteName,
  children,
  screenOptions,
}: Props) {
  const { state, descriptors, NavigationContent } = useNavigationBuilder<
    StackNavigationState<ParamListBase>,
    StackRouterOptions,
    {},
    StackNavigationOptions,
    {}
  >(StackRouter, {
    ...(initialRouteName !== undefined ? { initialRouteName } : {}),
    children,
    ...(screenOptions !== undefined ? { screenOptions } : {}),
  });

  const activeRoute = state.routes[state.index] ?? state.routes[0];
  const descriptor = activeRoute ? descriptors[activeRoute.key] : undefined;

  if (!descriptor) {
    return null;
  }

  return (
    <NavigationContent>
      <View style={styles.container}>
        {descriptor.render()}
      </View>
    </NavigationContent>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

const Stack = createNavigatorFactory<
  StackNavigationState<ParamListBase>,
  StackNavigationOptions,
  {},
  typeof MacStackNavigator
>(MacStackNavigator)<RootStackParamList>();

export const AppNavigator: React.FC = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Result" component={ResultScreen} />
        <Stack.Screen name="History" component={HistoryScreen} />
        <Stack.Screen name="Models" component={ModelsScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Privacy" component={PrivacyScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};
