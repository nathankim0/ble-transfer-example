import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Platform,
  TouchableOpacity,
  PermissionsAndroid,
  ScrollView,
} from 'react-native';
import { Device } from 'react-native-ble-plx';
import {
  BLE_SERVICE_UUID,
  BLE_CHARACTERISTICS,
} from '../constants/bleConstants';
import { getBleManager, centralMode, peripheralMode, bleCommon } from '../utils/bleManager';

const DEVICE_SERIAL_NUMBER = 'TAB-2024-001';
const BLUETOOTH_DEVICE_NAME = `IoT-${DEVICE_SERIAL_NUMBER}`;

interface ConnectedDevice {
  id: string;
  name: string;
  connectTime: Date;
  lastActivity: Date;
}

const TabletScreen: React.FC = () => {
  const [jwtToken, setJwtToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('초기화 중...');
  const [isAdvertising, setIsAdvertising] = useState(false);
  const [connectedDevices, setConnectedDevices] = useState<ConnectedDevice[]>([]);
  const [receivedData, setReceivedData] = useState<string>('');
  const [isConnected, setIsConnected] = useState(false);
  const [mobileDevice, setMobileDevice] = useState<Device | null>(null);
  const [waitingForJwt, setWaitingForJwt] = useState(false);
  
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    initializeBLE();
    
    return () => {
      console.debug('[TabletScreen] Cleaning up...');
      if (cleanupRef.current) {
        cleanupRef.current();
      }
      peripheralMode.stopAdvertising();
      bleCommon.cleanup();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initializeBLE = async () => {
    try {
      // Request permissions
      if (Platform.OS === 'android') {
        await requestAndroidPermissions();
      }

      // Check Bluetooth availability
      const isAvailable = await bleCommon.checkPermissions();
      if (!isAvailable) {
        throw new Error('Bluetooth not available');
      }
      console.log('Bluetooth is available');

      // Setup services and start peripheral mode
      await peripheralMode.setupService();
      await startPeripheralMode();
      
      setStatus('준비 완료 - 연결 대기 중');
    } catch (error) {
      console.error('BLE 초기화 오류:', error);
      setStatus('초기화 실패');
      Alert.alert('오류', 'Bluetooth를 초기화할 수 없습니다: ' + error);
    }
  };

  const requestAndroidPermissions = async () => {
    if (Platform.OS === 'android' && Platform.Version >= 31) {
      const permissions = [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ];
      
      const results = await PermissionsAndroid.requestMultiple(permissions);
      const allGranted = Object.values(results).every(
        result => result === PermissionsAndroid.RESULTS.GRANTED
      );
      
      if (!allGranted) {
        Alert.alert('권한 필요', 'BLE 기능을 사용하려면 모든 권한이 필요합니다.');
      }
    }
  };

  // 연결 코드 관련 기능 제거 (모바일에서 직접 전송하는 방식으로 변경)

  // setupBLEServices는 이제 peripheralMode.setupService()로 대체됨

  const startPeripheralMode = async () => {
    try {
      // 데이터 수신 이벤트 리스너 등록
      cleanupRef.current = peripheralMode.setupDataListener(onReceiveData);
      
      // Advertising 시작
      await peripheralMode.startAdvertising(BLUETOOTH_DEVICE_NAME);
      setIsAdvertising(true);
      
      console.log('Peripheral mode started successfully');
    } catch (error) {
      console.error('Start Peripheral mode error:', error);
      throw error;
    }
  };

  const onReceiveData = async (deviceId: string, receivedString: string) => {
    try {
      console.log('[TabletScreen] Received data from device:', deviceId, 'data:', receivedString);
      
      // JWT 토큰 확인
      if (receivedString.startsWith('eyJ')) { // JWT 형태 확인
        console.log('[TabletScreen] JWT Token received:', receivedString.substring(0, 50) + '...');
        setJwtToken(receivedString);
        setStatus('JWT 토큰 수신 완료!');
        setReceivedData('');
        
        Alert.alert(
          '✅ 등록 완료!',
          `IoT 기기가 성공적으로 등록되었습니다.\n\n수신된 JWT 토큰:\n${receivedString.substring(0, 50)}...`,
          [
            {
              text: '확인',
              onPress: () => {
                console.log('JWT Token received:', receivedString);
              }
            }
          ]
        );
        return;
      }
      
      // 연결 코드 수신 시 자동으로 JWT 요청 전송
      console.log('[TabletScreen] Received connection code:', receivedString);
      setReceivedData(`연결 코드 수신: ${receivedString}`);
      setStatus('연결 코드 확인됨 - JWT 토큰 요청 중...');
      setIsConnected(true);
      
      // 연결된 기기 정보 추가
      const newDevice: ConnectedDevice = {
        id: 'mobile-' + Date.now(),
        name: 'Mobile Device',
        connectTime: new Date(),
        lastActivity: new Date(),
      };
      setConnectedDevices(prev => [...prev, newDevice]);
      
      // 모바일을 찾아서 시리얼 번호 전송
      setTimeout(async () => {
        try {
          console.log('[TabletScreen] Waiting for mobile to setup peripheral mode...');
          setStatus('모바일이 수신 모드로 전환되기를 기다리는 중...');
          
          // 모바일이 peripheral 모드로 전환할 시간을 더 주기
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          console.log('[TabletScreen] Scanning for mobile device to send serial number...');
          setStatus('모바일 기기 검색 중...');
          
          const manager = getBleManager();
          let foundMobile = false;
          let scanAttempts = 0;
          const maxScanAttempts = 3;
          
          const scanForMobile = async () => {
            return new Promise<boolean>((resolve) => {
              manager.startDeviceScan(null, { allowDuplicates: false }, async (error, device) => {
                if (error) {
                  console.error('[TabletScreen] Scan error:', error);
                  resolve(false);
                  return;
                }
                
                // 디버깅을 위한 모든 기기 로그
                if (device && device.name) {
                  console.log('[TabletScreen] Found device:', device.name, device.id);
                }
                
                if (device && device.name && device.name.startsWith('Mobile-')) {
                  console.log('[TabletScreen] Found mobile device:', device.name);
                  manager.stopDeviceScan();
                  foundMobile = true;
              
              try {
                // 모바일에 연결
                const connected = await centralMode.connectToDevice(device);
                setMobileDevice(connected);
                
                // 시리얼 번호 전송
                console.log('[TabletScreen] Sending serial number to mobile...');
                await centralMode.writeToCharacteristic(
                  connected,
                  BLE_SERVICE_UUID,
                  BLE_CHARACTERISTICS.CODE_VERIFY,
                  DEVICE_SERIAL_NUMBER
                );
                
                setStatus('시리얼 번호 전송 완료 - JWT 대기 중...');
                setWaitingForJwt(true);
                
                // 연결 종료
                await connected.cancelConnection();
                setMobileDevice(null);
              } catch (connectError) {
                console.error('[TabletScreen] Failed to connect/send to mobile:', connectError);
                setStatus('모바일 연결 실패');
                  resolve(true);
                }
              });
              
              // 5초 후 스캔 중지
              setTimeout(() => {
                manager.stopDeviceScan();
                resolve(false);
              }, 5000);
            });
          };
          
          // 최대 3번까지 재시도
          while (!foundMobile && scanAttempts < maxScanAttempts) {
            scanAttempts++;
            console.log(`[TabletScreen] Scan attempt ${scanAttempts}/${maxScanAttempts}`);
            setStatus(`모바일 기기 검색 중... (시도 ${scanAttempts}/${maxScanAttempts})`);
            
            foundMobile = await scanForMobile();
            
            if (!foundMobile && scanAttempts < maxScanAttempts) {
              console.log('[TabletScreen] Mobile not found, waiting before retry...');
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }
          
          if (!foundMobile) {
            console.log('[TabletScreen] Mobile device not found after all attempts');
            setStatus('모바일 기기를 찾을 수 없음');
            Alert.alert(
              '연결 실패',
              '모바일 기기를 찾을 수 없습니다.\n\n모바일 앱에서 태블릿에 연결한 후\n시리얼 번호 수신을 기다려주세요.',
              [{ text: '확인' }]
            );
          }
          
        } catch (error) {
          console.error('[TabletScreen] Failed to send serial number:', error);
          setStatus('시리얼 번호 전송 실패');
        }
      }, 1000); // 연결 코드 전송 후 잠시 대기
      
    } catch (error) {
      console.error('OnReceiveData error:', error);
    }
  };

  const handleResendSerialNumber = async () => {
    try {
      setStatus('시리얼 번호 재전송 준비 중...');
      console.log('[TabletScreen] Preparing to resend serial number...');
      
      const manager = getBleManager();
      let foundMobile = false;
      
      // 모바일 기기 재스캔
      await manager.startDeviceScan(null, { allowDuplicates: false }, async (error, device) => {
        if (error) {
          console.error('[TabletScreen] Rescan error:', error);
          return;
        }
        
        if (device && device.name && device.name.startsWith('Mobile-')) {
          console.log('[TabletScreen] Found mobile device for resend:', device.name);
          manager.stopDeviceScan();
          foundMobile = true;
          
          try {
            const connected = await centralMode.connectToDevice(device);
            
            await centralMode.writeToCharacteristic(
              connected,
              BLE_SERVICE_UUID,
              BLE_CHARACTERISTICS.CODE_VERIFY,
              DEVICE_SERIAL_NUMBER
            );
            
            setStatus('시리얼 번호 재전송 완료 - JWT 대기 중...');
            await connected.cancelConnection();
          } catch (connectError) {
            console.error('[TabletScreen] Resend failed:', connectError);
            Alert.alert('오류', '시리얼 번호 전송에 실패했습니다.');
          }
        }
      });
      
      setTimeout(() => {
        manager.stopDeviceScan();
        if (!foundMobile) {
          Alert.alert('알림', '모바일 기기를 찾을 수 없습니다.\n모바일에서 다시 연결해주세요.');
        }
      }, 5000);
      
    } catch (error) {
      console.error('[TabletScreen] Failed to resend serial number:', error);
      Alert.alert('오류', '시리얼 번호 전송에 실패했습니다.');
    }
  };

  // stopAdvertising은 이제 peripheralMode.stopAdvertising()로 대체됨

  // 이제 리프레시 기능 불필요 (모바일에서 직접 연결)


  return (
    <View style={styles.container}>
      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>IoT 기기 (태블릿)</Text>
        
        <View style={styles.bluetoothNameContainer}>
          <Text style={styles.bluetoothNameLabel}>블루투스 기기명:</Text>
          <Text style={styles.bluetoothNameText}>{BLUETOOTH_DEVICE_NAME}</Text>
        </View>
        
        <View style={styles.serialContainer}>
          <Text style={styles.serialLabel}>기기 시리얼 번호:</Text>
          <Text style={styles.serialNumber}>{DEVICE_SERIAL_NUMBER}</Text>
        </View>
        
        <View style={styles.infoContainer}>
          <Text style={styles.infoTitle}>📱 모바일에서 연결하려면:</Text>
          <Text style={styles.infoText}>
            1. 모바일 앱에서 "주변 기기 스캔" 버튼 터치{'\n'}
            2. "{BLUETOOTH_DEVICE_NAME}" 기기 선택{'\n'}
            3. 아래 표시된 연결코드가 일치하는지 확인
          </Text>
        </View>
      
      {!jwtToken ? (
        <>
          <View style={styles.instructionContainer}>
            <Text style={styles.instructionTitle}>🔗 연결 대기 중</Text>
            <Text style={styles.instructionText}>
              모바일 앱에서 이 기기를 스캔하고 연결하세요
            </Text>
          </View>
          
          <View style={styles.statusContainer}>
            <Text style={styles.statusLabel}>상태: </Text>
            <Text style={styles.statusText}>{status}</Text>
          </View>
          
          {isAdvertising && (
            <View style={styles.advertisingContainer}>
              <View style={styles.advertisingDot} />
              <Text style={styles.advertisingText}>
                BLE 대기 중...
              </Text>
            </View>
          )}
          
          {receivedData && (
            <View style={styles.dataContainer}>
              <Text style={styles.dataLabel}>연결 진행 상황:</Text>
              <Text style={styles.dataText}>{receivedData}</Text>
            </View>
          )}
          
          {isConnected && !jwtToken && (
            <>
              <View style={styles.serialSentContainer}>
                <Text style={styles.serialSentLabel}>전송한 시리얼 번호:</Text>
                <Text style={styles.serialSentNumber}>{DEVICE_SERIAL_NUMBER}</Text>
              </View>
              
              {waitingForJwt && (
                <View style={styles.waitingContainer}>
                  <Text style={styles.waitingText}>
                    🕒 모바일에서 JWT 토큰을 생성 중입니다...
                  </Text>
                  <Text style={styles.waitingSubText}>
                    시리얼 번호를 기반으로 JWT 토큰을 생성합니다
                  </Text>
                </View>
              )}
              
              <TouchableOpacity
                style={styles.resendButton}
                onPress={handleResendSerialNumber}
              >
                <Text style={styles.resendButtonText}>🔄 시리얼 번호 다시 전송</Text>
              </TouchableOpacity>
            </>
          )}
          
          {/* 연결 대기 UI 제거 (모바일에서 직접 연결) */}
          
          {connectedDevices.length > 0 && (
            <View style={styles.devicesContainer}>
              <Text style={styles.devicesLabel}>연결된 모바일 기기들 ({connectedDevices.length}):</Text>
              {connectedDevices.map((device, index) => (
                <View key={index} style={styles.connectedDeviceItem}>
                  <Text style={styles.deviceName}>✓ {device.name}</Text>
                  <Text style={styles.deviceTime}>
                    {device.connectTime.toLocaleTimeString()}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </>
      ) : (
        <View style={styles.successContainer}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.successText}>등록 완료</Text>
          <Text style={styles.tokenLabel}>수신된 JWT 토큰:</Text>
          <View style={styles.tokenContainer}>
            <Text style={styles.tokenText}>
              {jwtToken.substring(0, 50)}...
            </Text>
          </View>
        </View>
      )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333',
  },
  bluetoothNameContainer: {
    backgroundColor: '#e1f5fe',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#0277bd',
  },
  bluetoothNameLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  bluetoothNameText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#0277bd',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    textAlign: 'center',
  },
  serialContainer: {
    backgroundColor: '#e3f2fd',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    alignItems: 'center',
  },
  serialLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  serialNumber: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1976d2',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  codeContainer: {
    backgroundColor: 'white',
    padding: 40,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
    minWidth: 300,
    minHeight: 120,
    justifyContent: 'center',
    alignItems: 'center',
  },
  connectionCode: {
    fontSize: 72,
    fontWeight: 'bold',
    letterSpacing: 8,
    color: '#007AFF',
  },
  instruction: {
    fontSize: 20,
    marginTop: 30,
    color: '#666',
  },
  refreshButton: {
    marginTop: 20,
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  refreshButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  statusContainer: {
    flexDirection: 'row',
    marginTop: 30,
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: 18,
    color: '#666',
  },
  statusText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#007AFF',
  },
  advertisingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
  },
  advertisingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4CAF50',
    marginRight: 8,
  },
  advertisingText: {
    fontSize: 16,
    color: '#666',
    fontStyle: 'italic',
  },
  dataContainer: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
  },
  dataLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  dataText: {
    fontSize: 16,
    color: '#333',
  },
  successContainer: {
    alignItems: 'center',
  },
  successIcon: {
    fontSize: 80,
    color: '#4CAF50',
    marginBottom: 20,
  },
  successText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#4CAF50',
    marginBottom: 30,
  },
  tokenLabel: {
    fontSize: 16,
    color: '#666',
    marginBottom: 10,
  },
  tokenContainer: {
    backgroundColor: '#f0f0f0',
    padding: 15,
    borderRadius: 10,
    maxWidth: 350,
  },
  tokenText: {
    fontSize: 12,
    color: '#333',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  devicesContainer: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    width: '100%',
    maxWidth: 350,
  },
  devicesLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  deviceItem: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
    paddingLeft: 10,
  },
  connectedDeviceItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#e8f5e9',
    borderRadius: 5,
    marginBottom: 5,
  },
  deviceName: {
    fontSize: 14,
    color: '#2e7d32',
    fontWeight: '500',
  },
  deviceTime: {
    fontSize: 12,
    color: '#666',
  },
  pendingContainer: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#fff3e0',
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#ff9800',
    alignItems: 'center',
  },
  pendingLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#e65100',
    marginBottom: 5,
  },
  pendingDevice: {
    fontSize: 14,
    color: '#bf360c',
    fontWeight: '500',
  },
  infoContainer: {
    backgroundColor: '#e8f5e9',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#4caf50',
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2e7d32',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#388e3c',
    lineHeight: 20,
  },
  instructionContainer: {
    backgroundColor: '#e3f2fd',
    padding: 20,
    borderRadius: 15,
    marginBottom: 20,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#1976d2',
  },
  instructionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1976d2',
    marginBottom: 8,
  },
  instructionText: {
    fontSize: 16,
    color: '#1565c0',
    textAlign: 'center',
  },
  buttonContainer: {
    marginTop: 20,
    gap: 15,
  },
  confirmButton: {
    backgroundColor: '#4caf50',
    paddingHorizontal: 30,
    paddingVertical: 20,
    borderRadius: 12,
    minHeight: 60,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  confirmButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  rejectButton: {
    backgroundColor: '#f44336',
    paddingHorizontal: 30,
    paddingVertical: 20,
    borderRadius: 12,
    minHeight: 60,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  rejectButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  jwtRequestButton: {
    backgroundColor: '#2196f3',
    paddingHorizontal: 25,
    paddingVertical: 18,
    borderRadius: 12,
    marginTop: 20,
    minHeight: 56,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  jwtRequestButtonText: {
    color: 'white',
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  waitingContainer: {
    backgroundColor: '#e3f2fd',
    padding: 20,
    borderRadius: 12,
    marginTop: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2196f3',
  },
  waitingText: {
    fontSize: 16,
    color: '#1976d2',
    fontWeight: '600',
    marginBottom: 8,
  },
  waitingSubText: {
    fontSize: 14,
    color: '#1565c0',
  },
  serialSentContainer: {
    backgroundColor: '#e8f5e9',
    padding: 15,
    borderRadius: 10,
    marginTop: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#4caf50',
  },
  serialSentLabel: {
    fontSize: 14,
    color: '#2e7d32',
    marginBottom: 5,
  },
  serialSentNumber: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1b5e20',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  resendButton: {
    backgroundColor: '#ff9800',
    paddingHorizontal: 25,
    paddingVertical: 15,
    borderRadius: 10,
    marginTop: 15,
    alignItems: 'center',
  },
  resendButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default TabletScreen;