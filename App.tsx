import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import HomeScreen from './src/screens/HomeScreen';
import TabletScreen from './src/screens/TabletScreen';
import MobileScreen from './src/screens/MobileScreen';

export type RootStackParamList = {
  Home: undefined;
  Tablet: undefined;
  Mobile: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Home"
          screenOptions={{
            headerStyle: {
              backgroundColor: '#007AFF',
            },
            headerTintColor: '#fff',
            headerTitleStyle: {
              fontWeight: 'bold',
            },
          }}
        >
          <Stack.Screen 
            name="Home" 
            component={HomeScreen}
            options={{ title: 'BLE IoT 등록' }}
          />
          <Stack.Screen 
            name="Tablet" 
            component={TabletScreen}
            options={{ title: '태블릿 모드' }}
          />
          <Stack.Screen 
            name="Mobile" 
            component={MobileScreen}
            options={{ title: '모바일 모드' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

export default App;
