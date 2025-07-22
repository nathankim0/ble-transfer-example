import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

type RootStackParamList = {
  Home: undefined;
  Tablet: undefined;
  Mobile: undefined;
};

type HomeScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'Home'
>;

const HomeScreen: React.FC = () => {
  const navigation = useNavigation<HomeScreenNavigationProp>();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>BLE IoT 등록 시스템</Text>
      <Text style={styles.subtitle}>디바이스 유형을 선택하세요</Text>
      
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[styles.button, styles.tabletButton]}
          onPress={() => navigation.navigate('Tablet')}
        >
          <Text style={styles.buttonIcon}>📱</Text>
          <Text style={styles.buttonTitle}>태블릿 모드</Text>
          <Text style={styles.buttonDescription}>
            IoT 기기로 사용 (BLE Peripheral)
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.button, styles.mobileButton]}
          onPress={() => navigation.navigate('Mobile')}
        >
          <Text style={styles.buttonIcon}>📲</Text>
          <Text style={styles.buttonTitle}>모바일 모드</Text>
          <Text style={styles.buttonDescription}>
            IoT 기기 등록용 (BLE Central)
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  subtitle: {
    fontSize: 18,
    color: '#666',
    marginBottom: 40,
  },
  buttonContainer: {
    width: '100%',
    maxWidth: 400,
  },
  button: {
    padding: 30,
    borderRadius: 20,
    marginBottom: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  tabletButton: {
    backgroundColor: '#007AFF',
  },
  mobileButton: {
    backgroundColor: '#34C759',
  },
  buttonIcon: {
    fontSize: 60,
    marginBottom: 15,
  },
  buttonTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 8,
  },
  buttonDescription: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
  },
});

export default HomeScreen;